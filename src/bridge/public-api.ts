import type { TagItem, ThemeObject } from '../types';
import { getMainDoc, getMainWin } from './host';

export const PUBLIC_API_VERSION = '3.2.0';

export type TagListener = (tags: TagItem[]) => void;
export type ThemeChangedListener = (themeName: string, prevThemeName: string) => void;
export type ThemesUpdatedListener = (themeNames: string[]) => void;

export interface ThemeFilterOptions {
  /** 按标签 ID 筛选 */
  tagId?: string;
  /** 按标签名称筛选（支持精确名或父/子路径） */
  tagName?: string;
  /** 仅返回收藏的美化 */
  favoriteOnly?: boolean;
  /** 按名称关键字模糊筛选（不区分大小写） */
  search?: string;
  /** 按标签筛选时是否包含其所有子标签（默认 true） */
  includeSubTags?: boolean;
}

export interface RandomThemeOptions extends ThemeFilterOptions {
  /** 随机切换时是否排除当前正在使用的美化（默认 true） */
  excludeCurrent?: boolean;
}

export interface ThemeSummary {
  name: string;
  isActive: boolean;
  isFavorite: boolean;
  tagIds: string[];
  tagNames: string[];
  usageCount: number;
  background: string | null;
}

export interface PublicApiDeps {
  getThemes: () => ThemeObject[];
  getActiveTheme: () => string;
  getTags: () => TagItem[];
  getFavorites: () => string[];
  getUsageCounts: () => Record<string, number>;
  getBackgroundBindings: () => Record<string, string>;
  getTagThemeSet: (tagId: string) => Set<string>;
  selectTheme: (themeName: string) => boolean;
  toggleFavorite: (themeName: string) => void;
  syncThemesWithDisk: (options?: { silent?: boolean }) => Promise<{ added: string[]; removed: string[] }>;
}

const tagListeners = new Set<TagListener>();
const themeChangedListeners = new Set<ThemeChangedListener>();
const themesUpdatedListeners = new Set<ThemesUpdatedListener>();

function cloneTags(tags: TagItem[]): TagItem[] {
  return tags.map((t) => ({
    id: t.id,
    name: t.name,
    parentId: t.parentId ?? null,
    themes: [...t.themes],
  }));
}

function cloneTheme(theme: ThemeObject): ThemeObject {
  try {
    return JSON.parse(JSON.stringify(theme));
  } catch {
    return { ...theme };
  }
}

function resolveTagId(tags: TagItem[], tagIdOrName: string): string | null {
  const key = tagIdOrName.trim();
  if (!key) return null;

  const byId = tags.find((t) => t.id === key);
  if (byId) return byId.id;

  // 支持 "一级/二级" 路径查找
  if (key.includes('/')) {
    const segments = key
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);
    let parentId: string | null = null;
    let matched: TagItem | undefined;
    for (const seg of segments) {
      matched = tags.find((t) => t.name === seg && (t.parentId || null) === parentId);
      if (!matched) return null;
      parentId = matched.id;
    }
    return matched ? matched.id : null;
  }

  const byName = tags.find((t) => t.name === key);
  return byName ? byName.id : null;
}

function getFilteredThemeNames(deps: PublicApiDeps, options?: ThemeFilterOptions): string[] {
  let names = deps.getThemes().map((t) => t.name);
  if (!options) return names;

  if (options.favoriteOnly) {
    const favSet = new Set(deps.getFavorites());
    names = names.filter((n) => favSet.has(n));
  }

  const tagQuery = options.tagId || options.tagName;
  if (tagQuery) {
    const tags = deps.getTags();
    const resolvedId = resolveTagId(tags, tagQuery);
    if (!resolvedId) return [];

    const includeSub = options.includeSubTags !== false;
    let allowed: Set<string>;
    if (includeSub) {
      allowed = deps.getTagThemeSet(resolvedId);
    } else {
      const target = tags.find((t) => t.id === resolvedId);
      allowed = new Set(target?.themes || []);
    }
    names = names.filter((n) => allowed.has(n));
  }

  if (options.search && options.search.trim()) {
    const kw = options.search.trim().toLowerCase();
    names = names.filter((n) => n.toLowerCase().includes(kw));
  }

  return names;
}

/**
 * 注册 window.themeManager 对外接口（100% 向后兼容原版标签 API，并扩展美化名单、切换与事件能力）
 */
export function installPublicApi(deps: PublicApiDeps): void {
  const win = getMainWin();

  const switchTheme = (themeName: string): boolean => {
    if (!themeName || typeof themeName !== 'string') return false;
    return deps.selectTheme(themeName.trim());
  };

  const getThemesByTag = (tagIdOrName: string, options?: { includeSubTags?: boolean }): string[] => {
    if (!tagIdOrName || typeof tagIdOrName !== 'string') return [];
    return getFilteredThemeNames(deps, {
      tagId: tagIdOrName,
      includeSubTags: options?.includeSubTags,
    });
  };

  const switchStepTheme = (step: 1 | -1, options?: ThemeFilterOptions): string | null => {
    const candidates = getFilteredThemeNames(deps, options);
    if (candidates.length === 0) return null;
    const current = deps.getActiveTheme();
    const currIdx = candidates.indexOf(current);
    const nextIdx =
      currIdx < 0
        ? step > 0
          ? 0
          : candidates.length - 1
        : (currIdx + step + candidates.length) % candidates.length;
    const target = candidates[nextIdx];
    return switchTheme(target) ? target : null;
  };

  win.themeManager = {
    version: PUBLIC_API_VERSION,

    isReady(): boolean {
      return true;
    },

    // ==========================================================
    // 美化名单 & 查询
    // ==========================================================
    getThemes(options?: ThemeFilterOptions): string[] {
      return getFilteredThemeNames(deps, options);
    },

    getThemeList(options?: ThemeFilterOptions): ThemeSummary[] {
      const names = getFilteredThemeNames(deps, options);
      const active = deps.getActiveTheme();
      const favSet = new Set(deps.getFavorites());
      const tags = deps.getTags();
      const usageCounts = deps.getUsageCounts();
      const bgBindings = deps.getBackgroundBindings();

      return names.map((name) => {
        const matchedTags = tags.filter((t) => Array.isArray(t.themes) && t.themes.includes(name));
        return {
          name,
          isActive: name === active,
          isFavorite: favSet.has(name),
          tagIds: matchedTags.map((t) => t.id),
          tagNames: matchedTags.map((t) => t.name),
          usageCount: usageCounts[name] || 0,
          background: bgBindings[name] || null,
        };
      });
    },

    getThemeDetails(themeName: string): ThemeObject | null {
      if (!themeName) return null;
      const found = deps.getThemes().find((t) => t.name === themeName);
      return found ? cloneTheme(found) : null;
    },

    getActiveTheme(): string {
      return deps.getActiveTheme();
    },

    getFavorites(): string[] {
      return [...deps.getFavorites()];
    },

    hasTheme(themeName: string): boolean {
      if (!themeName) return false;
      return deps.getThemes().some((t) => t.name === themeName);
    },

    async syncThemes(options?: { silent?: boolean }): Promise<{ added: string[]; removed: string[] }> {
      return deps.syncThemesWithDisk({ silent: options?.silent ?? true });
    },

    // ==========================================================
    // 切换 & 控制
    // ==========================================================
    switchTheme,
    applyTheme: switchTheme,

    switchRandomTheme(options?: RandomThemeOptions): string | null {
      const allCandidates = getFilteredThemeNames(deps, options);
      if (allCandidates.length === 0) return null;
      const excludeCurrent = options?.excludeCurrent !== false;
      const current = deps.getActiveTheme();
      const pool =
        excludeCurrent && allCandidates.length > 1
          ? allCandidates.filter((n) => n !== current)
          : allCandidates;
      const picked = pool[Math.floor(Math.random() * pool.length)];
      return switchTheme(picked) ? picked : null;
    },

    switchNextTheme(options?: ThemeFilterOptions): string | null {
      return switchStepTheme(1, options);
    },

    switchPrevTheme(options?: ThemeFilterOptions): string | null {
      return switchStepTheme(-1, options);
    },

    toggleFavorite(themeName: string): boolean {
      if (!themeName || !deps.getThemes().some((t) => t.name === themeName)) return false;
      deps.toggleFavorite(themeName);
      return deps.getFavorites().includes(themeName);
    },

    // ==========================================================
    // 标签系统（向后兼容原版 API）
    // ==========================================================
    getTags(): TagItem[] {
      return cloneTags(deps.getTags());
    },

    getThemeTags(themeName: string): string[] {
      if (!themeName) return [];
      return deps
        .getTags()
        .filter((t) => Array.isArray(t.themes) && t.themes.includes(themeName))
        .map((t) => t.id);
    },

    getThemesByTag,

    // ==========================================================
    // 事件订阅
    // ==========================================================
    onThemeChanged(callback: ThemeChangedListener): () => void {
      if (typeof callback === 'function') {
        themeChangedListeners.add(callback);
      }
      return () => {
        themeChangedListeners.delete(callback);
      };
    },

    onThemesUpdated(callback: ThemesUpdatedListener): () => void {
      if (typeof callback === 'function') {
        themesUpdatedListeners.add(callback);
      }
      return () => {
        themesUpdatedListeners.delete(callback);
      };
    },

    onTagsChanged(callback: TagListener): () => void {
      if (typeof callback === 'function') {
        tagListeners.add(callback);
      }
      return () => {
        tagListeners.delete(callback);
      };
    },
  };

  // 向主文档派发就绪事件，方便早于本插件加载的拓展监听
  try {
    const doc = getMainDoc();
    doc.dispatchEvent(
      new CustomEvent('themeManager:ready', {
        detail: {
          version: PUBLIC_API_VERSION,
          themes: deps.getThemes().map((t) => t.name),
          activeTheme: deps.getActiveTheme(),
        },
      }),
    );
  } catch (err) {
    console.error('[ThemeCompanion] dispatch themeManager:ready error:', err);
  }
}

/**
 * 激活美化变更时触发回调并向主文档派发 themeManager:themeChanged 事件
 */
export function notifyThemeChanged(themeName: string, prevThemeName = ''): void {
  if (!themeName || themeName === prevThemeName) return;
  themeChangedListeners.forEach((cb) => {
    try {
      cb(themeName, prevThemeName);
    } catch (err) {
      console.error('[ThemeCompanion] onThemeChanged callback error:', err);
    }
  });

  try {
    const doc = getMainDoc();
    doc.dispatchEvent(
      new CustomEvent('themeManager:themeChanged', {
        detail: { theme: themeName, previousTheme: prevThemeName },
      }),
    );
  } catch (err) {
    console.error('[ThemeCompanion] dispatch themeManager:themeChanged error:', err);
  }
}

/**
 * 美化名单增删/同步时触发回调并向主文档派发 themeManager:themesUpdated 事件
 */
export function notifyThemesUpdated(themeNames: string[]): void {
  const snapshot = [...themeNames];
  themesUpdatedListeners.forEach((cb) => {
    try {
      cb(snapshot);
    } catch (err) {
      console.error('[ThemeCompanion] onThemesUpdated callback error:', err);
    }
  });

  try {
    const doc = getMainDoc();
    doc.dispatchEvent(
      new CustomEvent('themeManager:themesUpdated', {
        detail: { themes: snapshot },
      }),
    );
  } catch (err) {
    console.error('[ThemeCompanion] dispatch themeManager:themesUpdated error:', err);
  }
}

/**
 * 标签变更时触发回调并向主文档派发 themeManager:tagsChanged 自定义事件
 */
export function notifyTagsChanged(tags: TagItem[]): void {
  const snapshot = cloneTags(tags);
  tagListeners.forEach((cb) => {
    try {
      cb(snapshot);
    } catch (err) {
      console.error('[ThemeCompanion] onTagsChanged callback error:', err);
    }
  });

  try {
    const doc = getMainDoc();
    doc.dispatchEvent(new CustomEvent('themeManager:tagsChanged', { detail: snapshot }));
  } catch (err) {
    console.error('[ThemeCompanion] dispatch themeManager:tagsChanged error:', err);
  }
}
