import type { AutoThemeConfig, CompanionSettings, DayNightPair, TagItem } from '../types';
import { getMainWin } from './host';

export interface MigrationSummary {
  favoritesCount: number;
  tagsCount: number;
  bgBindingsCount: number;
  charBindingsCount: number;
  pairsCount: number;
  autoThemeMigrated: boolean;
}

function readLegacyJson<T>(key: string): T | null {
  try {
    const raw = getMainWin().localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (_) {
    return null;
  }
}

/**
 * 检测是否存在旧版 themeManager_* localStorage 数据
 */
export function hasLegacyData(): boolean {
  const ls = getMainWin().localStorage;
  return Boolean(
    ls.getItem('themeManager_favorites') ||
      ls.getItem('themeManager_themeTags') ||
      ls.getItem('themeManager_backgroundBindings') ||
      ls.getItem('themeManager_characterThemeBindings') ||
      ls.getItem('themeManager_themeDayNightPairs') ||
      ls.getItem('themeManager_autoTheme'),
  );
}

/**
 * 将旧版 localStorage 数据合并迁移到新版 CompanionSettings（不删除旧版数据，确保安全）
 */
export function migrateLegacyDataInto(settings: CompanionSettings): MigrationSummary {
  const summary: MigrationSummary = {
    favoritesCount: 0,
    tagsCount: 0,
    bgBindingsCount: 0,
    charBindingsCount: 0,
    pairsCount: 0,
    autoThemeMigrated: false,
  };

  // 1. 收藏
  const legacyFavs = readLegacyJson<string[]>('themeManager_favorites');
  if (Array.isArray(legacyFavs)) {
    const favSet = new Set(settings.favorites);
    for (const f of legacyFavs) {
      if (typeof f === 'string' && f.trim() && !favSet.has(f)) {
        favSet.add(f);
        summary.favoritesCount++;
      }
    }
    settings.favorites = Array.from(favSet);
  }

  // 2. 标签（保留 N 级 parentId 层级）
  const legacyTags = readLegacyJson<any[]>('themeManager_themeTags');
  if (Array.isArray(legacyTags)) {
    const existingById = new Map(settings.tags.map((t) => [t.id, t]));
    const existingByKey = new Map(
      settings.tags.map((t) => [`${t.parentId || ''}::${t.name}`, t]),
    );
    for (const lt of legacyTags) {
      if (!lt || typeof lt.name !== 'string' || !lt.name.trim()) continue;
      const themes = Array.isArray(lt.themes)
        ? lt.themes.filter((x: any) => typeof x === 'string')
        : [];
      const parentId = typeof lt.parentId === 'string' && lt.parentId ? lt.parentId : null;
      const key = `${parentId || ''}::${lt.name.trim()}`;
      const exist = (typeof lt.id === 'string' && existingById.get(lt.id)) || existingByKey.get(key);
      if (exist) {
        const merged = new Set([...exist.themes, ...themes]);
        exist.themes = Array.from(merged);
        if (!exist.parentId && parentId) exist.parentId = parentId;
      } else {
        const newTag: TagItem = {
          id:
            typeof lt.id === 'string' && lt.id
              ? lt.id
              : `tag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: lt.name.trim(),
          parentId,
          themes: Array.from(new Set(themes)),
        };
        settings.tags.push(newTag);
        existingById.set(newTag.id, newTag);
        existingByKey.set(key, newTag);
        summary.tagsCount++;
      }
    }
  }

  // 3. 背景图绑定
  const legacyBg = readLegacyJson<Record<string, string>>('themeManager_backgroundBindings');
  if (legacyBg && typeof legacyBg === 'object') {
    for (const [theme, bg] of Object.entries(legacyBg)) {
      if (theme && typeof bg === 'string' && bg && !settings.backgroundBindings[theme]) {
        settings.backgroundBindings[theme] = bg;
        summary.bgBindingsCount++;
      }
    }
  }

  // 4. 角色绑定
  const legacyChar = readLegacyJson<Record<string, string>>('themeManager_characterThemeBindings');
  if (legacyChar && typeof legacyChar === 'object') {
    for (const [avatar, target] of Object.entries(legacyChar)) {
      if (avatar && typeof target === 'string' && target && !settings.characterBindings[avatar]) {
        settings.characterBindings[avatar] = target;
        summary.charBindingsCount++;
      }
    }
  }

  // 5. 日夜配对
  const legacyPairs = readLegacyJson<any[]>('themeManager_themeDayNightPairs');
  if (Array.isArray(legacyPairs)) {
    for (const p of legacyPairs) {
      if (!p || (!p.dayTheme && !p.nightTheme)) continue;
      const dup = settings.dayNightPairs.some(
        (e) => e.dayTheme === (p.dayTheme || '') && e.nightTheme === (p.nightTheme || ''),
      );
      if (!dup) {
        const pair: DayNightPair = {
          id: `pair_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          dayTheme: String(p.dayTheme || ''),
          nightTheme: String(p.nightTheme || ''),
        };
        settings.dayNightPairs.push(pair);
        summary.pairsCount++;
      }
    }
  }

  // 6. 自动日夜切换配置
  const legacyAuto = readLegacyJson<Partial<AutoThemeConfig>>('themeManager_autoTheme');
  if (legacyAuto && typeof legacyAuto === 'object') {
    settings.autoTheme = {
      ...settings.autoTheme,
      enabled: Boolean(legacyAuto.enabled),
      mode: legacyAuto.mode === 'time' ? 'time' : 'system',
      dayStart: typeof legacyAuto.dayStart === 'string' ? legacyAuto.dayStart : settings.autoTheme.dayStart,
      nightStart: typeof legacyAuto.nightStart === 'string' ? legacyAuto.nightStart : settings.autoTheme.nightStart,
      dayTarget: typeof legacyAuto.dayTarget === 'string' ? legacyAuto.dayTarget : settings.autoTheme.dayTarget,
      nightTarget: typeof legacyAuto.nightTarget === 'string' ? legacyAuto.nightTarget : settings.autoTheme.nightTarget,
    };
    summary.autoThemeMigrated = true;
  }

  return summary;
}
