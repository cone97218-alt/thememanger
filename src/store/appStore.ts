import { reactive, watch } from 'vue';
import type { CompanionSettings, DayNightPair, TagItem, ThemeObject } from '../types';
import {
  applyBackground,
  applyTheme,
  deleteThemeFromDisk,
  fetchThemesFromDisk,
  getActiveThemeName,
  getMemoryThemes,
  loadExtensionSettings,
  saveExtensionSettings,
  saveThemeToDisk,
  upsertThemeInSTMemory,
} from '../bridge/st-api';
import { notifyTagsChanged } from '../bridge/public-api';
import { showToast } from '../bridge/host';

export function createDefaultSettings(): CompanionSettings {
  return {
    version: 3,
    collapsed: false,
    favorites: [],
    tags: [],
    backgroundBindings: {},
    characterBindings: {},
    dayNightPairs: [],
    autoTheme: {
      enabled: false,
      mode: 'system',
      dayStart: '07:00',
      nightStart: '19:00',
      dayTarget: '',
      nightTarget: '',
    },
    avatar: {
      enabled: false,
      sizePx: 0,
      aspectRatio: 'auto',
      borderRadiusPx: -1,
      enableReplaceButton: true,
      disableAvatarZoom: false,
      defaultCrop: { posX: 50, posY: 50, scale: 1 },
      perCharacterCrop: {},
      perCharacterGallery: {},
      userGallery: [],
      perCharUserGallery: {},
      avatarOverrides: {},
    },
    autoSyncOnFocus: true,
    sortBy: 'favorite-first',
    listMode: 'scroll',
    pageSize: 50,
    usageCounts: {},
    showUsageCount: false,
  };
}

function mergeSettings(saved: Partial<CompanionSettings> | null): CompanionSettings {
  const def = createDefaultSettings();
  if (!saved) return def;
  return {
    ...def,
    ...saved,
    favorites: Array.isArray(saved.favorites) ? saved.favorites : def.favorites,
    tags: Array.isArray(saved.tags)
      ? saved.tags.map((t) => ({
          id: t.id,
          name: t.name,
          parentId: t.parentId ?? null,
          themes: Array.isArray(t.themes) ? [...t.themes] : [],
        }))
      : def.tags,
    backgroundBindings: saved.backgroundBindings ? { ...saved.backgroundBindings } : {},
    characterBindings: saved.characterBindings ? { ...saved.characterBindings } : {},
    dayNightPairs: Array.isArray(saved.dayNightPairs) ? saved.dayNightPairs : [],
    autoTheme: { ...def.autoTheme, ...(saved.autoTheme || {}) },
    avatar: {
      ...def.avatar,
      ...(saved.avatar || {}),
      defaultCrop: { ...def.avatar.defaultCrop, ...(saved.avatar?.defaultCrop || {}) },
      perCharacterCrop: { ...(saved.avatar?.perCharacterCrop || {}) },
      perCharacterGallery: { ...(saved.avatar?.perCharacterGallery || {}) },
      userGallery: Array.isArray(saved.avatar?.userGallery) ? [...saved.avatar.userGallery] : [],
      perCharUserGallery: { ...(saved.avatar?.perCharUserGallery || {}) },
      avatarOverrides: { ...(saved.avatar?.avatarOverrides || {}) },
    },
    usageCounts: saved.usageCounts ? { ...saved.usageCounts } : {},
  };
}

export const appStore = reactive({
  settings: createDefaultSettings(),
  themes: [] as ThemeObject[],
  activeTheme: '' as string,
  /** 最近从酒馆匣或磁盘新收到的主题名集合（用于徽章高亮） */
  recentlyAdded: [] as string[],
  isSyncing: false,
  lastSyncAt: 0,
  /** 弹窗开关状态 */
  showSettingsModal: false,
  showAvatarModal: false,
  /** 当前正在通过酒馆背景抽屉选择背景图的主题名 */
  bgBindingTheme: null as string | null,
  /** 图库 Blob URL 缓存版本号（变更时触发依赖视图刷新） */
  galleryCacheVersion: 0,
});

let _saveTimer: ReturnType<typeof setTimeout> | null = null;

export function persistSettingsDebounced(): void {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    saveExtensionSettings(appStore.settings);
  }, 250);
}

export function initStore(): void {
  const saved = loadExtensionSettings<CompanionSettings>();
  appStore.settings = mergeSettings(saved);
  appStore.themes = getMemoryThemes();
  appStore.activeTheme = getActiveThemeName();

  // 监听配置变化自动持久化
  watch(
    () => appStore.settings,
    () => {
      persistSettingsDebounced();
    },
    { deep: true },
  );

  // 标签变化时通知外部插件
  watch(
    () => appStore.settings.tags,
    (tags) => {
      notifyTagsChanged(tags);
    },
    { deep: true },
  );
}

export function markRecentlyAdded(themeName: string): void {
  if (!themeName) return;
  if (!appStore.recentlyAdded.includes(themeName)) {
    appStore.recentlyAdded.unshift(themeName);
    if (appStore.recentlyAdded.length > 20) {
      appStore.recentlyAdded.pop();
    }
  }
}

export function clearRecentlyAdded(themeName?: string): void {
  if (!themeName) {
    appStore.recentlyAdded = [];
  } else {
    appStore.recentlyAdded = appStore.recentlyAdded.filter((n) => n !== themeName);
  }
}

/**
 * 接收单个主题（如来自酒馆匣实时推送），立即更新内存、下拉框与 UI
 */
export function ingestTheme(
  theme: ThemeObject,
  meta?: { tags?: string[]; category?: string; bg?: string; autoApply?: boolean },
): void {
  const name = theme?.name?.trim();
  if (!name) return;

  upsertThemeInSTMemory(theme);
  const idx = appStore.themes.findIndex((t) => t.name === name);
  if (idx >= 0) {
    appStore.themes[idx] = theme;
  } else {
    appStore.themes.unshift(theme);
    markRecentlyAdded(name);
  }

  // 自动承接酒馆匣推送的分类/标签（支持 "一级/二级/三级" 层级路径）
  const incomingTags = new Set<string>();
  if (Array.isArray(meta?.tags)) meta.tags.forEach((t) => t && incomingTags.add(String(t).trim()));
  if (meta?.category && meta.category.trim()) incomingTags.add(meta.category.trim());
  if (Array.isArray(theme._xia?.tags)) theme._xia.tags.forEach((t) => t && incomingTags.add(String(t).trim()));
  if (theme._xia?.category && theme._xia.category.trim()) incomingTags.add(theme._xia.category.trim());

  incomingTags.forEach((tagPath) => {
    assignThemeToTagByName(name, tagPath);
  });

  // 自动承接预设背景图绑定
  const incomingBg = meta?.bg || theme._xia?.bg;
  if (incomingBg && !appStore.settings.backgroundBindings[name]) {
    appStore.settings.backgroundBindings[name] = incomingBg;
  }

  if (meta?.autoApply) {
    selectTheme(name);
  }
}

/**
 * 与磁盘做增量 Diff 同步，不重建整个 UI，只合并增删项
 */
export async function syncThemesWithDisk(options: { silent?: boolean } = {}): Promise<{
  added: string[];
  removed: string[];
}> {
  if (appStore.isSyncing) return { added: [], removed: [] };
  appStore.isSyncing = true;
  try {
    const diskThemes = await fetchThemesFromDisk();
    const prevNames = new Set(appStore.themes.map((t) => t.name));
    const diskMap = new Map(diskThemes.map((t) => [t.name, t]));

    const added: string[] = [];
    const removed: string[] = [];

    const isInitialLoad = prevNames.size === 0;
    for (const t of diskThemes) {
      if (!prevNames.has(t.name)) {
        upsertThemeInSTMemory(t);
        if (!isInitialLoad) {
          added.push(t.name);
          markRecentlyAdded(t.name);
        }
        if (t._xia) {
          t._xia.tags?.forEach((tagName) => assignThemeToTagByName(t.name, tagName));
          if (t._xia.category) assignThemeToTagByName(t.name, t._xia.category);
          if (t._xia.bg && !appStore.settings.backgroundBindings[t.name]) {
            appStore.settings.backgroundBindings[t.name] = t._xia.bg;
          }
        }
      }
    }

    for (const prev of prevNames) {
      if (!diskMap.has(prev)) {
        removed.push(prev);
      }
    }

    // 仅在真正有增删或首次加载时更新响应式列表，避免无意义重渲染
    if (isInitialLoad || added.length > 0 || removed.length > 0) {
      appStore.themes = diskThemes;
    }
    appStore.activeTheme = getActiveThemeName();
    appStore.lastSyncAt = Date.now();

    if (!options.silent) {
      if (added.length > 0 || removed.length > 0) {
        const parts: string[] = [];
        if (added.length > 0) parts.push(`新增 ${added.length}`);
        if (removed.length > 0) parts.push(`移除 ${removed.length}`);
        showToast('success', `同步完成：${parts.join('，')}`);
      } else {
        showToast('info', '已是最新');
      }
    } else if (added.length > 0) {
      showToast('info', `新增 ${added.length} 个美化`);
    }

    return { added, removed };
  } catch (err: any) {
    if (!options.silent) {
      showToast('error', `同步失败：${err?.message || err}`);
    }
    return { added: [], removed: [] };
  } finally {
    appStore.isSyncing = false;
  }
}

/**
 * 切换主题并自动应用绑定的背景图
 */
export function selectTheme(themeName: string): boolean {
  const ok = applyTheme(themeName);
  if (ok) {
    appStore.activeTheme = themeName;
    appStore.settings.usageCounts[themeName] = (appStore.settings.usageCounts[themeName] || 0) + 1;
    clearRecentlyAdded(themeName);
    const boundBg = appStore.settings.backgroundBindings[themeName];
    if (boundBg) {
      setTimeout(() => {
        applyBackground(boundBg);
      }, 120);
    }
  }
  return ok;
}

export function toggleFavorite(themeName: string): void {
  const idx = appStore.settings.favorites.indexOf(themeName);
  if (idx >= 0) {
    appStore.settings.favorites.splice(idx, 1);
  } else {
    appStore.settings.favorites.push(themeName);
  }
}

export function isFavorite(themeName: string): boolean {
  return appStore.settings.favorites.includes(themeName);
}

// ==========================================================
// N 级层级标签系统
// ==========================================================

function findTagByNameAndParent(name: string, parentId: string | null): TagItem | undefined {
  return appStore.settings.tags.find(
    (t) => t.name === name && (t.parentId || null) === (parentId || null),
  );
}

/**
 * 创建标签。支持指定 parentId，也支持传入 "父级/子级/孙级" 自动构建 N 级链条
 */
export function createTag(rawName: string, parentId: string | null = null): TagItem | null {
  const segments = rawName
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return null;

  let currentParentId: string | null = parentId || null;
  let lastTag: TagItem | null = null;

  for (const seg of segments) {
    const exist = findTagByNameAndParent(seg, currentParentId);
    if (exist) {
      lastTag = exist;
      currentParentId = exist.id;
    } else {
      const tag: TagItem = {
        id: `tag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: seg,
        parentId: currentParentId,
        themes: [],
      };
      appStore.settings.tags.push(tag);
      lastTag = tag;
      currentParentId = tag.id;
    }
  }

  return lastTag;
}

/**
 * 删除标签（其直接子标签自动提升至上一级，避免误删子树）
 */
export function deleteTag(tagId: string): void {
  const target = appStore.settings.tags.find((t) => t.id === tagId);
  const fallbackParent = target?.parentId ?? null;
  appStore.settings.tags.forEach((t) => {
    if (t.parentId === tagId) {
      t.parentId = fallbackParent;
    }
  });
  appStore.settings.tags = appStore.settings.tags.filter((t) => t.id !== tagId);
}

/**
 * 同层级标签拖拽排序：将 sourceId 移动到 targetId 所在位置
 */
export function reorderTags(sourceId: string, targetId: string): void {
  if (!sourceId || !targetId || sourceId === targetId) return;
  const list = appStore.settings.tags;
  const fromIdx = list.findIndex((t) => t.id === sourceId);
  const toIdx = list.findIndex((t) => t.id === targetId);
  if (fromIdx < 0 || toIdx < 0) return;
  if ((list[fromIdx].parentId || null) !== (list[toIdx].parentId || null)) return;
  const [moved] = list.splice(fromIdx, 1);
  list.splice(toIdx, 0, moved);
}

export function getRootTags(): TagItem[] {
  const idSet = new Set(appStore.settings.tags.map((t) => t.id));
  return appStore.settings.tags.filter((t) => !t.parentId || !idSet.has(t.parentId));
}

export function getChildTags(parentId: string): TagItem[] {
  return appStore.settings.tags.filter((t) => t.parentId === parentId);
}

export function getDescendantTagIds(tagId: string): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  const stack = [tagId];
  while (stack.length > 0) {
    const curr = stack.pop()!;
    if (visited.has(curr)) continue;
    visited.add(curr);
    result.push(curr);
    for (const t of appStore.settings.tags) {
      if (t.parentId === curr && !visited.has(t.id)) {
        stack.push(t.id);
      }
    }
  }
  return result;
}

export function getTagAncestry(tagId: string): TagItem[] {
  const byId = new Map(appStore.settings.tags.map((t) => [t.id, t]));
  const chain: TagItem[] = [];
  const visited = new Set<string>();
  let curr = byId.get(tagId);
  while (curr && !visited.has(curr.id)) {
    visited.add(curr.id);
    chain.unshift(curr);
    curr = curr.parentId ? byId.get(curr.parentId) : undefined;
  }
  return chain;
}

export function getTagThemeSet(tagId: string): Set<string> {
  const descIds = new Set(getDescendantTagIds(tagId));
  const set = new Set<string>();
  appStore.settings.tags.forEach((t) => {
    if (descIds.has(t.id)) {
      t.themes.forEach((n) => set.add(n));
    }
  });
  return set;
}

export function getTagThemeCount(tagId: string): number {
  const validSet = new Set(appStore.themes.map((t) => t.name));
  let count = 0;
  getTagThemeSet(tagId).forEach((name) => {
    if (validSet.has(name)) count++;
  });
  return count;
}

export interface FlattenedTagNode {
  tag: TagItem;
  depth: number;
  hasChildren: boolean;
}

/**
 * 将标签树按深度优先展平，便于设置页和打标签面板缩进渲染
 */
export function getFlattenedTagTree(): FlattenedTagNode[] {
  const result: FlattenedTagNode[] = [];
  const visited = new Set<string>();

  const walk = (nodes: TagItem[], depth: number) => {
    for (const node of nodes) {
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      const children = getChildTags(node.id);
      result.push({ tag: node, depth, hasChildren: children.length > 0 });
      if (children.length > 0) {
        walk(children, depth + 1);
      }
    }
  };

  walk(getRootTags(), 0);
  return result;
}

export function assignThemeToTagByName(themeName: string, tagPath: string): void {
  const clean = tagPath.trim();
  if (!themeName || !clean) return;
  const tag = createTag(clean);
  if (tag && !tag.themes.includes(themeName)) {
    tag.themes.push(themeName);
  }
}

export function toggleThemeTag(themeName: string, tagId: string): void {
  const tag = appStore.settings.tags.find((t) => t.id === tagId);
  if (!tag) return;
  const idx = tag.themes.indexOf(themeName);
  if (idx >= 0) {
    tag.themes.splice(idx, 1);
  } else {
    tag.themes.push(themeName);
  }
}

export function getTagsForTheme(themeName: string): TagItem[] {
  return appStore.settings.tags.filter((t) => t.themes.includes(themeName));
}

export function setThemeBackgroundBinding(themeName: string, bgFile: string): void {
  if (!bgFile) {
    delete appStore.settings.backgroundBindings[themeName];
  } else {
    appStore.settings.backgroundBindings[themeName] = bgFile;
  }
}

export function setCharacterThemeBinding(avatarFile: string, target: string): void {
  if (!target) {
    delete appStore.settings.characterBindings[avatarFile];
  } else {
    appStore.settings.characterBindings[avatarFile] = target;
  }
}

export function addDayNightPair(dayTheme: string, nightTheme: string): void {
  if (!dayTheme && !nightTheme) return;
  const pair: DayNightPair = {
    id: `pair_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    dayTheme,
    nightTheme,
  };
  appStore.settings.dayNightPairs.push(pair);
}

export function removeDayNightPair(id: string): void {
  appStore.settings.dayNightPairs = appStore.settings.dayNightPairs.filter((p) => p.id !== id);
}

export async function renameTheme(oldName: string, newName: string): Promise<boolean> {
  const cleanNew = newName.trim();
  if (!cleanNew || cleanNew === oldName) return false;
  if (appStore.themes.some((t) => t.name === cleanNew)) {
    showToast('warning', `主题「${cleanNew}」已存在`);
    return false;
  }

  const target = appStore.themes.find((t) => t.name === oldName);
  if (!target) return false;

  const cloned: ThemeObject = { ...target, name: cleanNew };
  await saveThemeToDisk(cloned);
  await deleteThemeFromDisk(oldName);

  appStore.settings.favorites = appStore.settings.favorites.map((f) => (f === oldName ? cleanNew : f));
  appStore.settings.tags.forEach((tag) => {
    tag.themes = tag.themes.map((n) => (n === oldName ? cleanNew : n));
  });
  if (appStore.settings.backgroundBindings[oldName]) {
    appStore.settings.backgroundBindings[cleanNew] = appStore.settings.backgroundBindings[oldName];
    delete appStore.settings.backgroundBindings[oldName];
  }
  Object.keys(appStore.settings.characterBindings).forEach((k) => {
    if (appStore.settings.characterBindings[k] === oldName) {
      appStore.settings.characterBindings[k] = cleanNew;
    }
  });
  appStore.settings.dayNightPairs.forEach((p) => {
    if (p.dayTheme === oldName) p.dayTheme = cleanNew;
    if (p.nightTheme === oldName) p.nightTheme = cleanNew;
  });

  appStore.themes = appStore.themes.map((t) => (t.name === oldName ? cloned : t));
  if (appStore.activeTheme === oldName) {
    selectTheme(cleanNew);
  }
  showToast('success', `已重命名为「${cleanNew}」`);
  return true;
}

export async function deleteTheme(themeName: string): Promise<boolean> {
  await deleteThemeFromDisk(themeName);
  appStore.themes = appStore.themes.filter((t) => t.name !== themeName);
  appStore.settings.favorites = appStore.settings.favorites.filter((f) => f !== themeName);
  appStore.settings.tags.forEach((tag) => {
    tag.themes = tag.themes.filter((n) => n !== themeName);
  });
  delete appStore.settings.backgroundBindings[themeName];
  appStore.activeTheme = getActiveThemeName();
  showToast('success', `已删除「${themeName}」`);
  return true;
}

/**
 * 解析目标字符串（具体主题名 或 '[Tag] tagId'，包含其所有子标签）
 */
export function resolveTargetTheme(target: string): string | null {
  if (!target) return null;
  if (target.startsWith('[Tag] ')) {
    const tagId = target.slice(6);
    const candidates = Array.from(getTagThemeSet(tagId));
    const available = candidates.filter((name) => appStore.themes.some((t) => t.name === name));
    if (available.length === 0) return null;
    return available[Math.floor(Math.random() * available.length)];
  }
  const exact = appStore.themes.find((t) => t.name === target);
  return exact ? exact.name : null;
}
