<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  appStore,
  createTag,
  deleteTheme,
  getTagsForTheme,
  ingestTheme,
  isFavorite,
  renameTheme,
  selectTheme,
  syncThemesWithDisk,
  toggleFavorite,
  toggleThemeTag,
} from '../store/appStore';
import { saveThemeToDisk } from '../bridge/st-api';
import { showToast } from '../bridge/host';
import { quickToggleDayNight } from '../features/autoTheme';
import type { ThemeObject } from '../types';

const searchQuery = ref('');
const onlyFavorites = ref(false);
const activeTagId = ref<string>(''); // '' = 全部, '__untagged__' = 未分类
const editingTagTheme = ref<string | null>(null);
const newTagInput = ref('');
const fileInputRef = ref<HTMLInputElement | null>(null);

const filteredThemes = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  const favSet = new Set(appStore.settings.favorites);
  const recentSet = new Set(appStore.recentlyAdded);

  const taggedSet = new Set<string>();
  appStore.settings.tags.forEach((t) => t.themes.forEach((n) => taggedSet.add(n)));

  let list = appStore.themes.filter((t) => {
    if (q && !t.name.toLowerCase().includes(q)) return false;
    if (onlyFavorites.value && !favSet.has(t.name)) return false;
    if (activeTagId.value === '__untagged__') {
      if (taggedSet.has(t.name)) return false;
    } else if (activeTagId.value) {
      const tag = appStore.settings.tags.find((x) => x.id === activeTagId.value);
      if (!tag || !tag.themes.includes(t.name)) return false;
    }
    return true;
  });

  // 排序：新推送 > 收藏 > 名称
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

function handleRename(themeName: string) {
  const next = window.prompt(`重命名美化「${themeName}」为：`, themeName);
  if (next && next.trim() && next.trim() !== themeName) {
    renameTheme(themeName, next.trim());
  }
}

async function handleDelete(themeName: string) {
  if (!window.confirm(`确定要删除美化「${themeName}」吗？此操作将删除磁盘上的主题文件。`)) {
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
        item.name = (typeof item.name === 'string' && item.name.trim()) || (list.length > 1 ? `${baseName}_${i + 1}` : baseName);
        await saveThemeToDisk(item);
        ingestTheme(item);
        okCount++;
      }
    } catch (err: any) {
      showToast('error', `导入 ${file.name} 失败：${err?.message || err}`);
    }
  }
  if (okCount > 0) {
    showToast('success', `成功导入 ${okCount} 个美化`);
  }
}
</script>

<template>
  <div id="tc-panel" class="tc-panel">
    <!-- 顶部标题栏 -->
    <div class="tc-header" @click="toggleCollapse">
      <div class="tc-header-left">
        <i class="fa-solid fa-palette tc-accent-icon"></i>
        <span class="tc-title">美化管理伴侣</span>
        <span class="tc-count-badge">{{ appStore.themes.length }}</span>
        <span v-if="appStore.recentlyAdded.length > 0" class="tc-new-dot" title="有新同步的美化">
          +{{ appStore.recentlyAdded.length }}
        </span>
      </div>

      <div class="tc-header-right" @click.stop>
        <button
          type="button"
          class="tc-icon-btn"
          title="一键切换日/夜配对美化"
          @click="quickToggleDayNight"
        >
          <i class="fa-solid fa-circle-half-stroke"></i>
        </button>
        <button
          type="button"
          class="tc-icon-btn"
          :class="{ 'tc-spinning': appStore.isSyncing }"
          title="同步磁盘/酒馆匣最新美化"
          @click="handleManualSync"
        >
          <i class="fa-solid fa-rotate"></i>
        </button>
        <button
          type="button"
          class="tc-icon-btn"
          title="头像管理（替换/大小/位置裁剪）"
          @click="appStore.showAvatarModal = true"
        >
          <i class="fa-solid fa-user-pen"></i>
        </button>
        <button
          type="button"
          class="tc-icon-btn"
          title="设置（日夜切换 / 绑定 / 标签 / 迁移）"
          @click="appStore.showSettingsModal = true"
        >
          <i class="fa-solid fa-sliders"></i>
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
      <!-- 搜索与快捷工具行 -->
      <div class="tc-toolbar">
        <div class="tc-search-wrap">
          <i class="fa-solid fa-magnifying-glass tc-search-icon"></i>
          <input
            v-model="searchQuery"
            type="search"
            class="tc-search-input"
            placeholder="搜索美化名称..."
          />
        </div>
        <button
          type="button"
          class="tc-tool-btn"
          :class="{ active: onlyFavorites }"
          title="只看收藏"
          @click="onlyFavorites = !onlyFavorites"
        >
          <i :class="onlyFavorites ? 'fa-solid fa-star' : 'fa-regular fa-star'"></i>
        </button>
        <button
          type="button"
          class="tc-tool-btn"
          title="导入 JSON 美化文件"
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

      <!-- 轻量标签筛选栏 -->
      <div v-if="appStore.settings.tags.length > 0" class="tc-tags-bar">
        <button
          type="button"
          class="tc-tag-chip"
          :class="{ active: activeTagId === '' }"
          @click="activeTagId = ''"
        >
          全部
        </button>
        <button
          v-for="tag in appStore.settings.tags"
          :key="tag.id"
          type="button"
          class="tc-tag-chip"
          :class="{ active: activeTagId === tag.id }"
          @click="activeTagId = activeTagId === tag.id ? '' : tag.id"
        >
          {{ tag.name }}
          <span class="tc-tag-num">{{ tag.themes.length }}</span>
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

      <!-- 主题列表 -->
      <div class="tc-theme-list">
        <div v-if="filteredThemes.length === 0" class="tc-empty">
          没有匹配的美化，试试清空搜索或点击右上角同步按钮
        </div>

        <div
          v-for="theme in filteredThemes"
          :key="theme.name"
          class="tc-theme-card"
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
                <i
                  v-if="appStore.settings.backgroundBindings[theme.name]"
                  class="fa-regular fa-image tc-bound-indicator"
                  :title="`已绑定背景：${appStore.settings.backgroundBindings[theme.name]}`"
                ></i>
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
                :class="{ starred: isFavorite(theme.name) }"
                title="收藏 / 取消收藏"
                @click="toggleFavorite(theme.name)"
              >
                <i :class="isFavorite(theme.name) ? 'fa-solid fa-star' : 'fa-regular fa-star'"></i>
              </button>
              <button
                type="button"
                class="tc-row-btn"
                title="管理标签"
                @click="openTagEditor(theme.name)"
              >
                <i class="fa-solid fa-tag"></i>
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
                title="删除美化"
                @click="handleDelete(theme.name)"
              >
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </div>

          <!-- 内联快速打标签抽屉 -->
          <div v-if="editingTagTheme === theme.name" class="tc-tag-popover" @click.stop>
            <div class="tc-tag-popover-chips">
              <button
                v-for="tag in appStore.settings.tags"
                :key="tag.id"
                type="button"
                class="tc-tag-chip small"
                :class="{ active: tag.themes.includes(theme.name) }"
                @click="toggleThemeTag(theme.name, tag.id)"
              >
                {{ tag.name }}
              </button>
            </div>
            <div class="tc-tag-add-row">
              <input
                v-model="newTagInput"
                type="text"
                class="tc-input-sm"
                placeholder="新建标签名..."
                @keyup.enter="handleCreateAndAssignTag(theme.name)"
              />
              <button
                type="button"
                class="tc-btn-sm"
                @click="handleCreateAndAssignTag(theme.name)"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
