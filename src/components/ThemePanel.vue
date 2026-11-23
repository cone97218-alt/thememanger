<script setup lang="ts">
import { computed, ref, watch } from 'vue';
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
  reorderTags,
  selectTheme,
  setThemeBackgroundBinding,
  syncThemesWithDisk,
  toggleFavorite,
  toggleThemeTag,
} from '../store/appStore';
import { captureCurrentThemeSnapshot, saveThemeToDisk } from '../bridge/st-api';
import { getMainDoc, showToast } from '../bridge/host';
import { quickToggleDayNight } from '../features/autoTheme';
import { startBackgroundBinding } from '../features/bgBinding';
import type { ThemeObject } from '../types';

const searchQuery = ref('');
const onlyFavorites = ref(false);
const showDisplayBar = ref(false);
const activeTagId = ref<string>('');
const editingTagTheme = ref<string | null>(null);
const newTagInput = ref('');
const fileInputRef = ref<HTMLInputElement | null>(null);

// 分页状态
const currentPage = ref(1);

// 批量编辑状态
const isBatchMode = ref(false);
const selectedNames = ref<string[]>([]);
const batchTagAction = ref<'add' | 'remove' | null>(null);
const batchNewTagInput = ref('');
const isBatchBusy = ref(false);

// 标签拖拽排序状态
const draggingTagId = ref<string | null>(null);
const dragOverTagId = ref<string | null>(null);

const rootTags = computed(() => getRootTags());
const flattenedTags = computed(() => getFlattenedTagTree());
const selectedSet = computed(() => new Set(selectedNames.value));

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
  const usageMap = appStore.settings.usageCounts;

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

  const mode = appStore.settings.sortBy || 'favorite-first';

  return [...list].sort((a, b) => {
    const aRec = recentSet.has(a.name) ? 1 : 0;
    const bRec = recentSet.has(b.name) ? 1 : 0;
    if (aRec !== bRec) return bRec - aRec;

    if (mode === 'favorite-first') {
      const aFav = favSet.has(a.name) ? 1 : 0;
      const bFav = favSet.has(b.name) ? 1 : 0;
      if (aFav !== bFav) return bFav - aFav;
      return a.name.localeCompare(b.name, 'zh-CN');
    }
    if (mode === 'name-desc') {
      return b.name.localeCompare(a.name, 'zh-CN');
    }
    if (mode === 'usage-desc') {
      const diff = (usageMap[b.name] || 0) - (usageMap[a.name] || 0);
      return diff !== 0 ? diff : a.name.localeCompare(b.name, 'zh-CN');
    }
    if (mode === 'usage-asc') {
      const diff = (usageMap[a.name] || 0) - (usageMap[b.name] || 0);
      return diff !== 0 ? diff : a.name.localeCompare(b.name, 'zh-CN');
    }
    return a.name.localeCompare(b.name, 'zh-CN');
  });
});

const totalPages = computed(() => {
  if (appStore.settings.listMode !== 'page') return 1;
  const size = Math.max(1, Number(appStore.settings.pageSize) || 50);
  return Math.max(1, Math.ceil(filteredThemes.value.length / size));
});

const displayedThemes = computed(() => {
  if (appStore.settings.listMode !== 'page') return filteredThemes.value;
  const size = Math.max(1, Number(appStore.settings.pageSize) || 50);
  const page = Math.min(Math.max(1, currentPage.value), totalPages.value);
  const start = (page - 1) * size;
  return filteredThemes.value.slice(start, start + size);
});

watch([searchQuery, onlyFavorites, activeTagId, () => appStore.settings.pageSize], () => {
  currentPage.value = 1;
});

watch(totalPages, (tp) => {
  if (currentPage.value > tp) currentPage.value = tp;
});

function toggleCollapse() {
  appStore.settings.collapsed = !appStore.settings.collapsed;
}

function handleManualSync() {
  syncThemesWithDisk({ silent: false });
}

async function flushActiveEditor(): Promise<void> {
  const doc = getMainDoc();
  const active = doc.activeElement as HTMLElement | null;
  if (active && typeof active.blur === 'function') {
    active.blur();
    await new Promise((r) => setTimeout(r, 80));
  }
}

async function handleSaveCurrentTheme() {
  await flushActiveEditor();
  const currentName = appStore.activeTheme;
  if (!currentName) {
    showToast('warning', '当前未选中任何美化');
    return;
  }
  try {
    const baseObj = appStore.themes.find((t) => t.name === currentName);
    const snapshot = captureCurrentThemeSnapshot(currentName, baseObj);
    await saveThemeToDisk(snapshot);
    ingestTheme(snapshot);
    showToast('success', `已保存「${currentName}」`);
  } catch (err: any) {
    showToast('error', `保存失败：${err?.message || err}`);
  }
}

async function handleSaveAsNewTheme() {
  await flushActiveEditor();
  const baseName = appStore.activeTheme || '新美化';
  const inputName = window.prompt('另存为新美化', `${baseName} (副本)`);
  if (!inputName || !inputName.trim()) return;
  const finalName = inputName.trim();
  if (appStore.themes.some((t) => t.name === finalName)) {
    showToast('warning', `「${finalName}」已存在`);
    return;
  }
  try {
    const baseObj = appStore.themes.find((t) => t.name === baseName);
    const snapshot = captureCurrentThemeSnapshot(finalName, baseObj);
    await saveThemeToDisk(snapshot);
    ingestTheme(snapshot);
    selectTheme(finalName);
    showToast('success', `已另存为「${finalName}」`);
  } catch (err: any) {
    showToast('error', `另存为失败：${err?.message || err}`);
  }
}

function handleRandomTheme() {
  const pool = filteredThemes.value;
  if (pool.length === 0) return;
  const others = pool.length > 1 ? pool.filter((t) => t.name !== appStore.activeTheme) : pool;
  const picked = others[Math.floor(Math.random() * others.length)];
  if (picked) selectTheme(picked.name);
}

// ==========================================================
// 标签拖拽排序
// ==========================================================

function onTagDragStart(tagId: string, ev: DragEvent) {
  draggingTagId.value = tagId;
  if (ev.dataTransfer) {
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', tagId);
  }
}

function onTagDragOver(tagId: string) {
  if (draggingTagId.value && draggingTagId.value !== tagId) {
    dragOverTagId.value = tagId;
  }
}

function onTagDrop(targetTagId: string) {
  if (draggingTagId.value && draggingTagId.value !== targetTagId) {
    reorderTags(draggingTagId.value, targetTagId);
  }
  draggingTagId.value = null;
  dragOverTagId.value = null;
}

function onTagDragEnd() {
  draggingTagId.value = null;
  dragOverTagId.value = null;
}

// ==========================================================
// 批量编辑操作：全选 / 连选 / 反选 / 加标签 / 删标签 / 删除
// ==========================================================

function toggleBatchMode() {
  isBatchMode.value = !isBatchMode.value;
  selectedNames.value = [];
  batchTagAction.value = null;
  batchNewTagInput.value = '';
  editingTagTheme.value = null;
}

function handleRowClick(themeName: string) {
  if (isBatchMode.value) {
    const idx = selectedNames.value.indexOf(themeName);
    if (idx >= 0) {
      selectedNames.value.splice(idx, 1);
    } else {
      selectedNames.value.push(themeName);
    }
    return;
  }
  selectTheme(themeName);
}

function batchSelectAll() {
  const all = displayedThemes.value.map((t) => t.name);
  if (all.length > 0 && all.every((n) => selectedSet.value.has(n))) {
    selectedNames.value = [];
  } else {
    selectedNames.value = all;
  }
}

function batchSelectRange() {
  const list = displayedThemes.value.map((t) => t.name);
  const indices: number[] = [];
  list.forEach((n, idx) => {
    if (selectedSet.value.has(n)) indices.push(idx);
  });
  if (indices.length < 2) {
    showToast('info', '请先勾选首尾两项');
    return;
  }
  const start = indices[0];
  const end = indices[indices.length - 1];
  const merged = new Set(selectedNames.value);
  for (let i = start; i <= end; i++) {
    merged.add(list[i]);
  }
  selectedNames.value = Array.from(merged);
}

function batchInvertSelect() {
  const cur = selectedSet.value;
  selectedNames.value = displayedThemes.value
    .map((t) => t.name)
    .filter((n) => !cur.has(n));
}

function toggleBatchTagAction(mode: 'add' | 'remove') {
  if (selectedNames.value.length === 0) {
    showToast('warning', '请先选择美化');
    return;
  }
  batchTagAction.value = batchTagAction.value === mode ? null : mode;
  batchNewTagInput.value = '';
}

function applyBatchTag(tagId: string) {
  const tag = appStore.settings.tags.find((t) => t.id === tagId);
  if (!tag || selectedNames.value.length === 0) return;

  if (batchTagAction.value === 'add') {
    let count = 0;
    selectedNames.value.forEach((name) => {
      if (!tag.themes.includes(name)) {
        tag.themes.push(name);
        count++;
      }
    });
    showToast('success', `已为 ${count} 项添加「${tag.name}」`);
  } else if (batchTagAction.value === 'remove') {
    const sel = selectedSet.value;
    const before = tag.themes.length;
    tag.themes = tag.themes.filter((n) => !sel.has(n));
    showToast('success', `已移除 ${before - tag.themes.length} 项的「${tag.name}」`);
  }
  batchTagAction.value = null;
}

function applyBatchNewTag() {
  const tag = createTag(batchNewTagInput.value);
  if (!tag) return;
  applyBatchTag(tag.id);
  batchNewTagInput.value = '';
}

async function handleBatchDelete() {
  const targets = [...selectedNames.value];
  if (targets.length === 0) {
    showToast('warning', '请先选择美化');
    return;
  }
  if (!window.confirm(`确定删除选中的 ${targets.length} 个美化？`)) {
    return;
  }
  isBatchBusy.value = true;
  let ok = 0;
  for (const name of targets) {
    try {
      await deleteTheme(name);
      ok++;
    } catch (_) {}
  }
  isBatchBusy.value = false;
  selectedNames.value = [];
  batchTagAction.value = null;
  if (ok > 0) {
    showToast('success', `已删除 ${ok} 个美化`);
  }
}

function handleClickRootTag(tagId: string) {
  activeTagId.value = activeTagId.value === tagId ? '' : tagId;
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
    <!-- 顶部标题栏 -->
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
        <button
          type="button"
          class="tc-icon-btn"
          title="保存当前美化"
          @click="handleSaveCurrentTheme"
        >
          <i class="fa-solid fa-floppy-disk"></i>
        </button>
        <button
          type="button"
          class="tc-icon-btn"
          title="另存为新美化"
          @click="handleSaveAsNewTheme"
        >
          <i class="fa-solid fa-file-circle-plus"></i>
        </button>
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
        <button
          type="button"
          class="tc-icon-btn"
          title="展开/收起"
          @click="toggleCollapse"
        >
          <i
            class="fa-solid fa-chevron-down tc-chevron"
            :class="{ collapsed: appStore.settings.collapsed }"
          ></i>
        </button>
      </div>
    </div>

    <!-- 面板主体 -->
    <div v-show="!appStore.settings.collapsed" class="tc-body">
      <!-- 搜索与快捷操作行 -->
      <div class="tc-toolbar">
        <div class="tc-search-box">
          <i class="fa-solid fa-magnifying-glass tc-search-icon"></i>
          <input
            v-model="searchQuery"
            type="text"
            class="tc-search-input"
            placeholder="搜索美化"
          />
          <button
            v-if="searchQuery"
            type="button"
            class="tc-search-clear"
            title="清空"
            @click="searchQuery = ''"
          >
            <i class="fa-solid fa-xmark"></i>
          </button>
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
          :class="{ active: showDisplayBar }"
          title="排序与分页"
          @click="showDisplayBar = !showDisplayBar"
        >
          <i class="fa-solid fa-arrow-up-wide-short"></i>
        </button>
        <button
          type="button"
          class="tc-tool-btn"
          :class="{ active: isBatchMode }"
          title="批量编辑"
          @click="toggleBatchMode"
        >
          <i class="fa-solid fa-pen-to-square"></i>
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

      <!-- 排序 / 分页 / 使用次数显示控制栏 -->
      <div v-if="showDisplayBar" class="tc-display-bar">
        <select v-model="appStore.settings.sortBy" class="tc-mini-select" title="排序规则">
          <option value="favorite-first">收藏优先</option>
          <option value="name-asc">名称 A-Z</option>
          <option value="name-desc">名称 Z-A</option>
          <option value="usage-desc">次数 多→少</option>
          <option value="usage-asc">次数 少→多</option>
        </select>
        <select v-model="appStore.settings.listMode" class="tc-mini-select" title="显示模式">
          <option value="scroll">滚动全部</option>
          <option value="page">分页显示</option>
        </select>
        <select
          v-if="appStore.settings.listMode === 'page'"
          v-model.number="appStore.settings.pageSize"
          class="tc-mini-select"
          title="每页条数"
        >
          <option :value="30">30/页</option>
          <option :value="50">50/页</option>
          <option :value="100">100/页</option>
          <option :value="200">200/页</option>
        </select>
        <button
          type="button"
          class="tc-tool-btn tc-mini-btn"
          :class="{ active: appStore.settings.showUsageCount }"
          title="显示使用次数"
          @click="appStore.settings.showUsageCount = !appStore.settings.showUsageCount"
        >
          <i class="fa-solid fa-chart-simple"></i>
        </button>
      </div>

      <!-- 批量编辑工具栏 -->
      <div v-if="isBatchMode" class="tc-batch-wrap">
        <div class="tc-batch-bar">
          <span class="tc-batch-count">{{ selectedNames.length }}</span>
          <button type="button" class="tc-batch-btn" title="全选" @click="batchSelectAll">
            <i class="fa-solid fa-check-double"></i>
          </button>
          <button type="button" class="tc-batch-btn" title="连选" @click="batchSelectRange">
            <i class="fa-solid fa-arrows-left-right-to-line"></i>
          </button>
          <button type="button" class="tc-batch-btn" title="反选" @click="batchInvertSelect">
            <i class="fa-solid fa-repeat"></i>
          </button>
          <span class="tc-batch-sep"></span>
          <button
            type="button"
            class="tc-batch-btn"
            :class="{ active: batchTagAction === 'add' }"
            title="加标签"
            @click="toggleBatchTagAction('add')"
          >
            <i class="fa-solid fa-tag"></i>
          </button>
          <button
            type="button"
            class="tc-batch-btn"
            :class="{ active: batchTagAction === 'remove' }"
            title="删标签"
            @click="toggleBatchTagAction('remove')"
          >
            <i class="fa-solid fa-minus"></i>
          </button>
          <button
            type="button"
            class="tc-batch-btn tc-danger"
            :disabled="isBatchBusy"
            title="删除选中"
            @click="handleBatchDelete"
          >
            <i class="fa-solid fa-trash"></i>
          </button>
          <button
            type="button"
            class="tc-batch-btn tc-batch-close"
            title="退出批量"
            @click="toggleBatchMode"
          >
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div v-if="batchTagAction" class="tc-tag-popover">
          <div v-if="flattenedTags.length > 0" class="tc-tag-popover-chips">
            <button
              v-for="node in flattenedTags"
              :key="node.tag.id"
              type="button"
              class="tc-tag-chip small"
              @click="applyBatchTag(node.tag.id)"
            >
              <span v-if="node.depth > 0" class="tc-tag-indent">{{ '› '.repeat(node.depth) }}</span>
              <span>{{ node.tag.name }}</span>
            </button>
          </div>
          <div v-if="batchTagAction === 'add'" class="tc-tag-add-row">
            <input
              v-model="batchNewTagInput"
              type="text"
              class="tc-input-sm"
              placeholder="新建并添加（支持 父/子）"
              @keyup.enter="applyBatchNewTag"
            />
            <button type="button" class="tc-btn-sm" title="添加" @click="applyBatchNewTag">
              <i class="fa-solid fa-plus"></i>
            </button>
          </div>
        </div>
      </div>

      <!-- N 级层级标签栏（支持同级拖拽排序） -->
      <div v-if="rootTags.length > 0" class="tc-tags-section">
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
            :class="{
              active: activeRootId === tag.id,
              'drag-over': dragOverTagId === tag.id,
            }"
            draggable="true"
            @dragstart="onTagDragStart(tag.id, $event)"
            @dragover.prevent="onTagDragOver(tag.id)"
            @drop.prevent="onTagDrop(tag.id)"
            @dragend="onTagDragEnd"
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

        <div
          v-if="activeAncestry.length > 0 && (currentSubtags.length > 0 || activeAncestry.length > 1)"
          class="tc-breadcrumb"
        >
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

        <div v-if="currentSubtags.length > 0" class="tc-tags-row tc-subtags-row">
          <button
            v-for="sub in currentSubtags"
            :key="sub.id"
            type="button"
            class="tc-tag-chip sub"
            :class="{
              active: activeTagId === sub.id,
              'drag-over': dragOverTagId === sub.id,
            }"
            draggable="true"
            @dragstart="onTagDragStart(sub.id, $event)"
            @dragover.prevent="onTagDragOver(sub.id)"
            @drop.prevent="onTagDrop(sub.id)"
            @dragend="onTagDragEnd"
            @click="handleClickSubTag(sub.id)"
          >
            <span>{{ sub.name }}</span>
            <span class="tc-tag-num">{{ getTagThemeCount(sub.id) }}</span>
          </button>
        </div>
      </div>

      <!-- 主题列表 -->
      <div class="tc-theme-list">
        <div v-if="displayedThemes.length === 0" class="tc-empty">
          暂无匹配美化
        </div>

        <div
          v-for="theme in displayedThemes"
          :key="theme.name"
          class="tc-theme-item"
          :class="{
            active: appStore.activeTheme === theme.name,
            recent: appStore.recentlyAdded.includes(theme.name),
            'batch-selected': isBatchMode && selectedSet.has(theme.name),
          }"
        >
          <div class="tc-theme-row" @click="handleRowClick(theme.name)">
            <i
              v-if="isBatchMode"
              :class="
                selectedSet.has(theme.name)
                  ? 'fa-solid fa-square-check tc-batch-chk checked'
                  : 'fa-regular fa-square tc-batch-chk'
              "
            ></i>

            <div class="tc-theme-info">
              <div class="tc-theme-name-line">
                <span class="tc-theme-name" :title="theme.name">{{ theme.name }}</span>
                <span
                  v-if="appStore.settings.showUsageCount && (appStore.settings.usageCounts[theme.name] || 0) > 0"
                  class="tc-usage-badge"
                >
                  {{ appStore.settings.usageCounts[theme.name] }}
                </span>
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

            <div v-if="!isBatchMode" class="tc-theme-actions" @click.stop>
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

          <div v-if="!isBatchMode && editingTagTheme === theme.name" class="tc-tag-popover" @click.stop>
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

      <!-- 分页栏 -->
      <div v-if="appStore.settings.listMode === 'page' && totalPages > 1" class="tc-pagination">
        <button
          type="button"
          class="tc-icon-btn"
          :disabled="currentPage <= 1"
          title="首页"
          @click="currentPage = 1"
        >
          <i class="fa-solid fa-angles-left"></i>
        </button>
        <button
          type="button"
          class="tc-icon-btn"
          :disabled="currentPage <= 1"
          title="上一页"
          @click="currentPage--"
        >
          <i class="fa-solid fa-chevron-left"></i>
        </button>
        <span class="tc-page-text">{{ currentPage }} / {{ totalPages }}</span>
        <button
          type="button"
          class="tc-icon-btn"
          :disabled="currentPage >= totalPages"
          title="下一页"
          @click="currentPage++"
        >
          <i class="fa-solid fa-chevron-right"></i>
        </button>
        <button
          type="button"
          class="tc-icon-btn"
          :disabled="currentPage >= totalPages"
          title="末页"
          @click="currentPage = totalPages"
        >
          <i class="fa-solid fa-angles-right"></i>
        </button>
      </div>
    </div>
  </div>
</template>
