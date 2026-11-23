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
      defaultCrop: { posX: 50, posY: 25, scale: 1 },
      perCharacterCrop: {},
    },
    autoSyncOnFocus: true,
  };
}

function mergeSettings(saved: Partial<CompanionSettings> | null): CompanionSettings {
  const def = createDefaultSettings();
  if (!saved) return def;
  return {
    ...def,
    ...saved,
    favorites: Array.isArray(saved.favorites) ? saved.favorites : def.favorites,
    tags: Array.isArray(saved.tags) ? saved.tags : def.tags,
    backgroundBindings: saved.backgroundBindings ? { ...saved.backgroundBindings } : {},
    characterBindings: saved.characterBindings ? { ...saved.characterBindings } : {},
    dayNightPairs: Array.isArray(saved.dayNightPairs) ? saved.dayNightPairs : [],
    autoTheme: { ...def.autoTheme, ...(saved.autoTheme || {}) },
    avatar: {
      ...def.avatar,
      ...(saved.avatar || {}),
      defaultCrop: { ...def.avatar.defaultCrop, ...(saved.avatar?.defaultCrop || {}) },
      perCharacterCrop: { ...(saved.avatar?.perCharacterCrop || {}) },
    },
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

  // 自动承接酒馆匣推送的分类/标签
  const incomingTags = new Set<string>();
  if (Array.isArray(meta?.tags)) meta.tags.forEach((t) => t && incomingTags.add(String(t).trim()));
  if (meta?.category && meta.category.trim()) incomingTags.add(meta.category.trim());
  if (Array.isArray(theme._xia?.tags)) theme._xia.tags.forEach((t) => t && incomingTags.add(String(t).trim()));
  if (theme._xia?.category && theme._xia.category.trim()) incomingTags.add(theme._xia.category.trim());

  incomingTags.forEach((tagName) => {
    assignThemeToTagByName(name, tagName);
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

    for (const t of diskThemes) {
      upsertThemeInSTMemory(t);
      if (!prevNames.has(t.name)) {
        added.push(t.name);
        markRecentlyAdded(t.name);
        // 若磁盘 JSON 内带 _xia 元数据也顺手自动归类
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

    appStore.themes = diskThemes;
    appStore.activeTheme = getActiveThemeName();
    appStore.lastSyncAt = Date.now();

    if (!options.silent) {
      if (added.length > 0 || removed.length > 0) {
        const parts: string[] = [];
        if (added.length > 0) parts.push(`新增 ${added.length} 个`);
        if (removed.length > 0) parts.push(`移除 ${removed.length} 个`);
        showToast('success', `已同步磁盘美化：${parts.join('，')}（共 ${diskThemes.length} 个）`);
      } else {
        showToast('info', `已是最新（共 ${diskThemes.length} 个美化）`);
      }
    } else if (added.length > 0) {
      showToast('info', `检测到 ${added.length} 个新美化：${added.slice(0, 3).join('、')}${added.length > 3 ? ' 等' : ''}`);
    }

    return { added, removed };
  } catch (err: any) {
    if (!options.silent) {
      showToast('error', `同步美化失败：${err?.message || err}`);
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

export function createTag(name: string): TagItem | null {
  const clean = name.trim();
  if (!clean) return null;
  const exist = appStore.settings.tags.find((t) => t.name === clean);
  if (exist) return exist;
  const tag: TagItem = {
    id: `tag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: clean,
    themes: [],
  };
  appStore.settings.tags.push(tag);
  return tag;
}

export function deleteTag(tagId: string): void {
  appStore.settings.tags = appStore.settings.tags.filter((t) => t.id !== tagId);
}

export function assignThemeToTagByName(themeName: string, tagName: string): void {
  const cleanTag = tagName.trim();
  if (!themeName || !cleanTag) return;
  const tag = createTag(cleanTag);
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

  // 同步更新本地引用（收藏、标签、背景绑定、角色绑定、日夜配对）
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
  showToast('success', `已删除美化「${themeName}」`);
  return true;
}

/**
 * 解析目标字符串（具体主题名 或 '[Tag] tagId'）
 */
export function resolveTargetTheme(target: string): string | null {
  if (!target) return null;
  if (target.startsWith('[Tag] ')) {
    const tagId = target.slice(6);
    const tag = appStore.settings.tags.find((t) => t.id === tagId);
    if (!tag || tag.themes.length === 0) return null;
    const available = tag.themes.filter((name) => appStore.themes.some((t) => t.name === name));
    if (available.length === 0) return null;
    return available[Math.floor(Math.random() * available.length)];
  }
  const exact = appStore.themes.find((t) => t.name === target);
  return exact ? exact.name : null;
}
