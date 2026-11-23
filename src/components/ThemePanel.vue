<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  appStore,
  createTag,
  deleteTheme,
  getChildTags,
  getFlattenedTagTree,
  getRootTags,
  getTagAncestry,
  getTagsForTheme,
  getTagThemeCount,
  getTagThemeSet,
  ingestTheme,
  isFavorite,
  renameTheme,
  selectTheme,
  setThemeBackgroundBinding,
  syncThemesWithDisk,
  toggleFavorite,
  toggleThemeTag,
} from '../store/appStore';
import { saveThemeToDisk } from '../bridge/st-api';
import { showToast } from '../bridge/host';
import { quickToggleDayNight } from '../features/autoTheme';
import { startBackgroundBinding } from '../features/bgBinding';
import type { ThemeObject } from '../types';

const searchQuery = ref('');
const onlyFavorites = ref(false);
const activeTagId = ref<string>(''); // '' = 全部, '__untagged__' = 未分类, 或任意层级 tag.id
const editingTagTheme = ref<string | null>(null);
const newTagInput = ref('');
const fileInputRef = ref<HTMLInputElement | null>(null);

const rootTags = computed(() => getRootTags());
const flattenedTags = computed(() => getFlattenedTagTree());

const activeAncestry = computed(() => {
  if (!activeTagId.value || activeTagId.value === '__untagged__') return [];
  return getTagAncestry(activeTagId.value);
});

const activeRootId = computed(() => activeAncestry.value[0]?.id || '');

const currentSubtags = computed(() => {
  if (!activeTagId.value || activeTagId.value === '__untagged__') return [];
  return getChildTags(activeTagId.value);
});

const filteredThemes = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  const favSet = new Set(appStore.settings.favorites);
  const recentSet = new Set(appStore.recentlyAdded);

  const taggedSet = new Set<string>();
  appStore.settings.tags.forEach((t) => t.themes.forEach((n) => taggedSet.add(n)));

  const activeDescSet =
    activeTagId.value && activeTagId.value !== '__untagged__'
      ? getTagThemeSet(activeTagId.value)
      : null;

  const list = appStore.themes.filter((t) => {
    if (q && !t.name.toLowerCase().includes(q)) return false;
    if (onlyFavorites.value && !favSet.has(t.name)) return false;
    if (activeTagId.value === '__untagged__') {
      if (taggedSet.has(t.name)) return false;
    } else if (activeDescSet) {
      if (!activeDescSet.has(t.name)) return false;
    }
    return true;
  });

  return [...list].sort((a, b) => {
    const aRec = recentSet.has(a.name) ? 1 : 0;
    const bRec = recentSet.has(b.name) ? 1 : 0;
    if (aRec !== bRec) return bRec - aRec;

    const aFav = favSet.has(a.name) ? 1 : 0;
    const bFav = favSet.has(b.name) ? 1 : 0;
    if (aFav !== bFav) return bFav - aFav;

    return a.name.localeCompare(b.name, 'zh-CN');
  });
});

function toggleCollapse() {
  appStore.settings.collapsed = !appStore.settings.collapsed;
}

function handleManualSync() {
  syncThemesWithDisk({ silent: false });
}

function handleRandomTheme() {
  const pool = filteredThemes.value;
  if (pool.length === 0) return;
  const others = pool.length > 1 ? pool.filter((t) => t.name !== appStore.activeTheme) : pool;
  const picked = others[Math.floor(Math.random() * others.length)];
  if (picked) selectTheme(picked.name);
}

function handleClickRootTag(tagId: string) {
  if (activeTagId.value === tagId) {
    activeTagId.value = '';
  } else {
    activeTagId.value = tagId;
  }
}

function handleClickSubTag(tagId: string) {
  if (activeTagId.value === tagId) {
    const chain = activeAncestry.value;
    activeTagId.value = chain.length > 1 ? chain[chain.length - 2].id : '';
  } else {
    activeTagId.value = tagId;
  }
}

function handleBgLinkClick(themeName: string) {
  if (appStore.settings.backgroundBindings[themeName]) {
    setThemeBackgroundBinding(themeName, '');
    showToast('info', '已解除背景绑定');
  } else {
    startBackgroundBinding(themeName);
  }
}

function handleRename(themeName: string) {
  const next = window.prompt('重命名', themeName);
  if (next && next.trim() && next.trim() !== themeName) {
    renameTheme(themeName, next.trim());
  }
}

async function handleDelete(themeName: string) {
  if (!window.confirm(`确定删除「${themeName}」？`)) {
    return;
  }
  try {
    await deleteTheme(themeName);
  } catch (err: any) {
    showToast('error', `删除失败：${err?.message || err}`);
  }
}

function openTagEditor(themeName: string) {
  editingTagTheme.value = editingTagTheme.value === themeName ? null : themeName;
  newTagInput.value = '';
}

function handleCreateAndAssignTag(themeName: string) {
  const tag = createTag(newTagInput.value);
  if (tag) {
    if (!tag.themes.includes(themeName)) {
      tag.themes.push(themeName);
    }
    newTagInput.value = '';
  }
}

function triggerQuickImport() {
  fileInputRef.value?.click();
}

async function handleFileImport(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  input.value = '';
  if (files.length === 0) return;

  let okCount = 0;
  for (const file of files) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const list: ThemeObject[] = Array.isArray(parsed) ? parsed : [parsed];
      const baseName = file.name.replace(/\.json$/i, '').trim();
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        if (!item || typeof item !== 'object') continue;
        item.name =
          (typeof item.name === 'string' && item.name.trim()) ||
          (list.length > 1 ? `${baseName}_${i + 1}` : baseName);
        await saveThemeToDisk(item);
        ingestTheme(item);
        okCount++;
      }
    } catch (err: any) {
      showToast('error', `导入失败：${err?.message || err}`);
    }
  }
  if (okCount > 0) {
    showToast('success', `已导入 ${okCount} 个美化`);
  }
}
</script>

<template>
  <div id="tc-panel" class="tc-panel">
    <!-- 顶部标题栏（对齐原版结构） -->
    <div class="tc-header" @click="toggleCollapse">
      <div class="tc-header-left">
        <i class="fa-solid fa-palette tc-accent-icon"></i>
        <span class="tc-title">美化管理</span>
        <span class="tc-count-badge">{{ appStore.themes.length }}</span>
        <span v-if="appStore.recentlyAdded.length > 0" class="tc-new-dot">
          +{{ appStore.recentlyAdded.length }}
        </span>
      </div>

      <div class="tc-header-right" @click.stop>
        <div id="tc-native-buttons-slot" class="tc-native-slot"></div>
        <button
          type="button"
          class="tc-icon-btn"
          title="日夜切换"
          @click="quickToggleDayNight"
        >
          <i class="fa-solid fa-circle-half-stroke"></i>
        </button>
        <button
          type="button"
          class="tc-icon-btn"
          :class="{ 'tc-spinning': appStore.isSyncing }"
          title="同步"
          @click="handleManualSync"
        >
          <i class="fa-solid fa-rotate"></i>
        </button>
        <button
          type="button"
          class="tc-icon-btn"
          title="设置"
          @click="appStore.showSettingsModal = true"
        >
          <i class="fa-solid fa-gear"></i>
        </button>
        <i
          class="fa-solid fa-chevron-down tc-chevron"
          :class="{ collapsed: appStore.settings.collapsed }"
          @click="toggleCollapse"
        ></i>
      </div>
    </div>

    <!-- 面板主体 -->
    <div v-show="!appStore.settings.collapsed" class="tc-body">
      <!-- 搜索与快捷操作行（纯图标，无冗余文字） -->
      <div class="tc-toolbar">
        <div class="tc-search-wrap">
          <i class="fa-solid fa-magnifying-glass tc-search-icon"></i>
          <input
            v-model="searchQuery"
            type="search"
            class="tc-search-input"
            placeholder="搜索美化..."
          />
        </div>
        <button
          type="button"
          class="tc-tool-btn"
          :class="{ active: onlyFavorites }"
          title="收藏"
          @click="onlyFavorites = !onlyFavorites"
        >
          <i :class="onlyFavorites ? 'fa-solid fa-star' : 'fa-regular fa-star'"></i>
        </button>
        <button
          type="button"
          class="tc-tool-btn"
          title="随机"
          @click="handleRandomTheme"
        >
          <i class="fa-solid fa-dice"></i>
        </button>
        <button
          type="button"
          class="tc-tool-btn"
          title="导入"
          @click="triggerQuickImport"
        >
          <i class="fa-solid fa-file-import"></i>
        </button>
        <input
          ref="fileInputRef"
          type="file"
          accept=".json,application/json"
          multiple
          style="display: none"
          @change="handleFileImport"
        />
      </div>

      <!-- N 级层级标签栏 -->
      <div v-if="rootTags.length > 0" class="tc-tags-section">
        <!-- 一级标签 -->
        <div class="tc-tags-row">
          <button
            type="button"
            class="tc-tag-chip"
            :class="{ active: activeTagId === '' }"
            @click="activeTagId = ''"
          >
            全部
          </button>
          <button
            v-for="tag in rootTags"
            :key="tag.id"
            type="button"
            class="tc-tag-chip"
            :class="{ active: activeRootId === tag.id }"
            @click="handleClickRootTag(tag.id)"
          >
            <span>{{ tag.name }}</span>
            <span class="tc-tag-num">{{ getTagThemeCount(tag.id) }}</span>
          </button>
          <button
            type="button"
            class="tc-tag-chip"
            :class="{ active: activeTagId === '__untagged__' }"
            @click="activeTagId = activeTagId === '__untagged__' ? '' : '__untagged__'"
          >
            未分类
          </button>
        </div>

        <!-- 面包屑导航（存在子级或处于深层时显示） -->
        <div v-if="activeAncestry.length > 0 && (currentSubtags.length > 0 || activeAncestry.length > 1)" class="tc-breadcrumb">
          <button type="button" class="tc-crumb" @click="activeTagId = ''">
            <i class="fa-solid fa-house"></i>
          </button>
          <template v-for="(node, idx) in activeAncestry" :key="node.id">
            <i class="fa-solid fa-angle-right tc-crumb-sep"></i>
            <button
              type="button"
              class="tc-crumb"
              :class="{ active: idx === activeAncestry.length - 1 }"
              @click="activeTagId = node.id"
            >
              {{ node.name }}
            </button>
          </template>
        </div>

        <!-- 当前层级子标签 -->
        <div v-if="currentSubtags.length > 0" class="tc-tags-row tc-subtags-row">
          <button
            v-for="sub in currentSubtags"
            :key="sub.id"
            type="button"
            class="tc-tag-chip sub"
            :class="{ active: activeTagId === sub.id }"
            @click="handleClickSubTag(sub.id)"
          >
            <span>{{ sub.name }}</span>
            <span class="tc-tag-num">{{ getTagThemeCount(sub.id) }}</span>
          </button>
        </div>
      </div>

      <!-- 主题列表（原版紧凑扁平风格） -->
      <div class="tc-theme-list">
        <div v-if="filteredThemes.length === 0" class="tc-empty">
          暂无匹配美化
        </div>

        <div
          v-for="theme in filteredThemes"
          :key="theme.name"
          class="tc-theme-item"
          :class="{
            active: appStore.activeTheme === theme.name,
            recent: appStore.recentlyAdded.includes(theme.name),
          }"
        >
          <div class="tc-theme-row" @click="selectTheme(theme.name)">
            <div class="tc-theme-info">
              <div class="tc-theme-name-line">
                <span class="tc-theme-name" :title="theme.name">{{ theme.name }}</span>
                <span v-if="appStore.recentlyAdded.includes(theme.name)" class="tc-pill-new">新</span>
              </div>
              <div v-if="getTagsForTheme(theme.name).length > 0" class="tc-inline-tags">
                <span
                  v-for="tag in getTagsForTheme(theme.name)"
                  :key="tag.id"
                  class="tc-mini-tag"
                >
                  {{ tag.name }}
                </span>
              </div>
            </div>

            <div class="tc-theme-actions" @click.stop>
              <button
                type="button"
                class="tc-row-btn"
                title="标签"
                @click="openTagEditor(theme.name)"
              >
                <i class="fa-solid fa-tag"></i>
              </button>
              <button
                type="button"
                class="tc-row-btn"
                :class="{ linked: Boolean(appStore.settings.backgroundBindings[theme.name]) }"
                :title="
                  appStore.settings.backgroundBindings[theme.name]
                    ? `解绑背景：${appStore.settings.backgroundBindings[theme.name]}`
                    : '绑定背景'
                "
                @click="handleBgLinkClick(theme.name)"
              >
                <i
                  :class="
                    appStore.settings.backgroundBindings[theme.name]
                      ? 'fa-solid fa-link-slash'
                      : 'fa-solid fa-link'
                  "
                ></i>
              </button>
              <button
                type="button"
                class="tc-row-btn"
                :class="{ starred: isFavorite(theme.name) }"
                title="收藏"
                @click="toggleFavorite(theme.name)"
              >
                <i :class="isFavorite(theme.name) ? 'fa-solid fa-star' : 'fa-regular fa-star'"></i>
              </button>
              <button
                type="button"
                class="tc-row-btn"
                title="重命名"
                @click="handleRename(theme.name)"
              >
                <i class="fa-solid fa-pen"></i>
              </button>
              <button
                type="button"
                class="tc-row-btn tc-danger"
                title="删除"
                @click="handleDelete(theme.name)"
              >
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </div>

          <!-- 内联快速打标签抽屉（支持层级缩进） -->
          <div v-if="editingTagTheme === theme.name" class="tc-tag-popover" @click.stop>
            <div v-if="flattenedTags.length > 0" class="tc-tag-popover-chips">
              <button
                v-for="node in flattenedTags"
                :key="node.tag.id"
                type="button"
                class="tc-tag-chip small"
                :class="{ active: node.tag.themes.includes(theme.name) }"
                @click="toggleThemeTag(theme.name, node.tag.id)"
              >
                <span v-if="node.depth > 0" class="tc-tag-indent">{{ '› '.repeat(node.depth) }}</span>
                <span>{{ node.tag.name }}</span>
              </button>
            </div>
            <div class="tc-tag-add-row">
              <input
                v-model="newTagInput"
                type="text"
                class="tc-input-sm"
                placeholder="新标签（支持 父/子）"
                @keyup.enter="handleCreateAndAssignTag(theme.name)"
              />
              <button
                type="button"
                class="tc-btn-sm"
                title="添加"
                @click="handleCreateAndAssignTag(theme.name)"
              >
                <i class="fa-solid fa-plus"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
