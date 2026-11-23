import type { ThemeObject } from '../types';
import { getMainDoc, getMainWin, getSTContext } from './host';

export const SETTINGS_NAMESPACE = 'theme_companion_v3';

let _bgModulePromise: Promise<any> | null = null;

/**
 * 记录本会话中通过酒馆匣推送或 JSON 导入的免刷新主题名
 * 一旦用户点击酒馆原生「保存」按钮，power-user.js 会自行将其写入私有 themes 闭包，即可从本集合移除
 */
const freshlyIngestedThemes = new Set<string>();

export function markThemeFreshlyIngested(name: string): void {
  if (name) freshlyIngestedThemes.add(name);
}

export function clearThemeFreshlyIngested(name: string): void {
  if (name) freshlyIngestedThemes.delete(name);
}

async function getBgModule(): Promise<any> {
  if (!_bgModulePromise) {
    const win = getMainWin();
    const base = win.location?.origin || '';
    _bgModulePromise = import(/* @vite-ignore */ `${base}/scripts/backgrounds.js`).catch(() => null);
  }
  return _bgModulePromise;
}

export function getRequestHeaders(): Record<string, string> {
  const ctx = getSTContext();
  if (ctx && typeof ctx.getRequestHeaders === 'function') {
    return { ...ctx.getRequestHeaders() };
  }
  return {};
}

export async function apiPost<T = any>(endpoint: string, body: unknown = {}): Promise<T> {
  const win = getMainWin();
  const headers = getRequestHeaders();
  if (!headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await win.fetch(`/api/${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `HTTP ${res.status}`);
  }
  if (!text || text.trim().toUpperCase() === 'OK') {
    return { status: 'OK' } as T;
  }
  return JSON.parse(text) as T;
}

export function loadExtensionSettings<T>(): Partial<T> | null {
  const ctx = getSTContext();
  const store = ctx?.extensionSettings || ctx?.extension_settings;
  if (!store) return null;
  return (store[SETTINGS_NAMESPACE] as Partial<T>) || null;
}

export function saveExtensionSettings(data: unknown): void {
  const ctx = getSTContext();
  const store = ctx?.extensionSettings || ctx?.extension_settings;
  if (!store) return;
  store[SETTINGS_NAMESPACE] = JSON.parse(JSON.stringify(data));
  if (typeof ctx?.saveSettingsDebounced === 'function') {
    ctx.saveSettingsDebounced();
  }
}

export function getPowerUser(): Record<string, any> | null {
  const ctx = getSTContext();
  const win = getMainWin();
  return ctx?.powerUserSettings || ctx?.power_user || win.power_user || null;
}

export function getActiveThemeName(): string {
  const doc = getMainDoc();
  const select = doc.querySelector<HTMLSelectElement>('#themes');
  if (select?.value) return select.value;
  const pu = getPowerUser();
  return String(pu?.theme || '');
}

export function getMemoryThemes(): ThemeObject[] {
  const ctx = getSTContext();
  const pu = getPowerUser();
  const win = getMainWin();
  const raw =
    (Array.isArray(ctx?.themes) && ctx.themes.length > 0 && ctx.themes) ||
    (Array.isArray(pu?.themes) && pu.themes.length > 0 && pu.themes) ||
    (Array.isArray(win.themes) && win.themes.length > 0 && win.themes) ||
    [];
  return (raw as any[])
    .filter((t) => t && typeof t === 'object' && typeof t.name === 'string' && t.name.trim())
    .map((t) => t as ThemeObject);
}

export async function fetchThemesFromDisk(): Promise<ThemeObject[]> {
  const data = await apiPost<{ themes?: ThemeObject[] }>('settings/get', {});
  const list = Array.isArray(data?.themes) ? data.themes : [];
  return list.filter((t) => t && typeof t === 'object' && typeof t.name === 'string' && t.name.trim());
}

export function upsertThemeInSTMemory(theme: ThemeObject): void {
  const name = theme?.name?.trim();
  if (!name) return;

  const ctx = getSTContext();
  const pu = getPowerUser();
  const win = getMainWin();
  const doc = getMainDoc();

  const patchArray = (arr: any) => {
    if (!Array.isArray(arr)) return;
    const idx = arr.findIndex((t) => t && t.name === name);
    if (idx >= 0) {
      arr[idx] = theme;
    } else {
      arr.push(theme);
    }
  };

  patchArray(ctx?.themes);
  patchArray(pu?.themes);
  patchArray(win.themes);

  if (typeof win.baibaokuHydrateTheme === 'function') {
    try {
      win.baibaokuHydrateTheme(theme);
    } catch (_) {}
  }

  const select = doc.querySelector<HTMLSelectElement>('#themes');
  if (select) {
    const exists = Array.from(select.options).some((opt) => opt.value === name);
    if (!exists) {
      const opt = doc.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    }
  }
}

export function removeThemeFromSTMemory(name: string): void {
  if (!name) return;
  const ctx = getSTContext();
  const pu = getPowerUser();
  const win = getMainWin();
  const doc = getMainDoc();

  freshlyIngestedThemes.delete(name);

  const removeFromArray = (arr: any) => {
    if (!Array.isArray(arr)) return;
    const idx = arr.findIndex((t) => t && t.name === name);
    if (idx >= 0) arr.splice(idx, 1);
  };

  removeFromArray(ctx?.themes);
  removeFromArray(pu?.themes);
  removeFromArray(win.themes);

  const select = doc.querySelector<HTMLSelectElement>('#themes');
  if (select) {
    Array.from(select.options).forEach((opt) => {
      if (opt.value === name) opt.remove();
    });
  }
}

const THEME_COLOR_KEYS: Array<{ key: string; pickerId: string; cssVar: string }> = [
  { key: 'main_text_color', pickerId: '#main-text-color-picker', cssVar: '--SmartThemeBodyColor' },
  { key: 'italics_text_color', pickerId: '#italics-color-picker', cssVar: '--SmartThemeEmColor' },
  { key: 'underline_text_color', pickerId: '#underline-color-picker', cssVar: '--SmartThemeUnderlineColor' },
  { key: 'quote_text_color', pickerId: '#quote-color-picker', cssVar: '--SmartThemeQuoteColor' },
  { key: 'blur_tint_color', pickerId: '#blur-tint-color-picker', cssVar: '--SmartThemeBlurTintColor' },
  { key: 'chat_tint_color', pickerId: '#chat-tint-color-picker', cssVar: '--SmartThemeChatTintColor' },
  {
    key: 'user_mes_blur_tint_color',
    pickerId: '#user-mes-blur-tint-color-picker',
    cssVar: '--SmartThemeUserMesBlurTintColor',
  },
  {
    key: 'bot_mes_blur_tint_color',
    pickerId: '#bot-mes-blur-tint-color-picker',
    cssVar: '--SmartThemeBotMesBlurTintColor',
  },
  { key: 'shadow_color', pickerId: '#shadow-color-picker', cssVar: '--SmartThemeShadowColor' },
  { key: 'border_color', pickerId: '#border-color-picker', cssVar: '--SmartThemeBorderColor' },
];

/**
 * 仅在原生 power-user.js 闭包未命中（如本会话刚从酒馆匣推送的免刷新主题）时执行直接渲染
 */
function applyFallbackThemeDOM(theme: ThemeObject): void {
  const doc = getMainDoc();
  const ctx = getSTContext();
  const pu = getPowerUser();
  const rootStyle = doc.documentElement.style;

  if (pu) {
    for (const [k, v] of Object.entries(theme)) {
      if (k !== '_xia' && v !== undefined) pu[k] = v;
    }
    pu.theme = theme.name;
  }

  const customCss = typeof theme.custom_css === 'string' ? theme.custom_css : '';
  const editorEl = doc.querySelector<HTMLTextAreaElement>('#customCSS');
  if (editorEl) editorEl.value = customCss;
  let styleTag = doc.getElementById('custom-style') as HTMLStyleElement | null;
  if (!styleTag) {
    styleTag = doc.createElement('style');
    styleTag.id = 'custom-style';
    doc.head.appendChild(styleTag);
  }
  styleTag.innerHTML = customCss;

  for (const { key, pickerId, cssVar } of THEME_COLOR_KEYS) {
    const col = theme[key];
    if (typeof col === 'string' && col) {
      rootStyle.setProperty(cssVar, col);
      const picker = doc.querySelector<any>(pickerId);
      if (picker) {
        picker.setAttribute('color', col);
        if ('rgba' in picker) picker.rgba = col;
      }
      if (key === 'main_text_color' && col.includes('(')) {
        const parts = col.split('(')[1]?.split(')')[0]?.split(',');
        if (parts && parts.length >= 4) {
          rootStyle.setProperty('--SmartThemeCheckboxBgColorR', parts[0].trim());
          rootStyle.setProperty('--SmartThemeCheckboxBgColorG', parts[1].trim());
          rootStyle.setProperty('--SmartThemeCheckboxBgColorB', parts[2].trim());
          rootStyle.setProperty('--SmartThemeCheckboxBgColorA', parts[3].trim());
        }
      }
      if (key === 'blur_tint_color') {
        doc.querySelector('meta[name=theme-color]')?.setAttribute('content', col);
      }
    }
  }

  if (theme.chat_width !== undefined) {
    rootStyle.setProperty('--sheldWidth', `${Number(theme.chat_width) || 50}vw`);
  }
  if (theme.font_scale !== undefined) {
    rootStyle.setProperty('--fontScale', String(Number(theme.font_scale) || 1));
  }
  if (theme.blur_strength !== undefined) {
    rootStyle.setProperty('--blurStrength', String(Number(theme.blur_strength) ?? 10));
  }
  if (theme.shadow_width !== undefined) {
    rootStyle.setProperty('--shadowWidth', String(Number(theme.shadow_width) ?? 2));
  }

  if (typeof ctx?.saveSettingsDebounced === 'function') {
    ctx.saveSettingsDebounced();
  }
}

/**
 * 切换主题：
 * 1. 通过哨兵检测原生 #themes change 是否已在 power-user.js 闭包内命中并完成切换；
 * 2. 若原生已命中（存量主题及用原生保存按钮保存过的主题），直接信任原生结果，零冗余覆盖；
 * 3. 仅当原生未命中或属于刚从酒馆匣免刷新推送的新主题时，才由 applyFallbackThemeDOM 兜底渲染。
 */
export function applyTheme(themeName: string, themeObj?: ThemeObject): boolean {
  if (!themeName) return false;
  const doc = getMainDoc();
  const win = getMainWin();
  const pu = getPowerUser();
  const select = doc.querySelector<HTMLSelectElement>('#themes');
  if (!select) return false;

  if (themeObj) {
    upsertThemeInSTMemory(themeObj);
  }

  let targetOpt: HTMLOptionElement | null = null;
  Array.from(select.options).forEach((o) => {
    if (o.value === themeName) {
      targetOpt = o;
    } else {
      o.selected = false;
      o.removeAttribute('selected');
    }
  });

  if (!targetOpt) {
    targetOpt = doc.createElement('option');
    targetOpt.value = themeName;
    targetOpt.textContent = themeName;
    select.appendChild(targetOpt);
  }

  targetOpt.selected = true;
  targetOpt.setAttribute('selected', 'selected');
  select.value = themeName;

  // 植入哨兵：若原生闭包内存在该主题，trigger('change') 会同步把 pu.custom_css 改写为该主题真实的 custom_css
  const SENTINEL = '__TC_NATIVE_PROBE__';
  const prevCss = pu?.custom_css;
  if (pu) pu.custom_css = SENTINEL;

  if (win.jQuery) {
    try {
      win.jQuery(select).val(themeName).trigger('change');
    } catch (_) {
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } else {
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const handledByNative = pu ? pu.custom_css !== SENTINEL : false;
  if (!handledByNative && pu) {
    pu.custom_css = prevCss;
  }

  // 仅当原生未命中（或刚被酒馆匣免刷新推送覆盖）时，才执行兜底 DOM 渲染
  if (!handledByNative || freshlyIngestedThemes.has(themeName)) {
    const hasFullData = Boolean(
      themeObj && (themeObj.main_text_color || typeof themeObj.custom_css === 'string'),
    );
    if (hasFullData && themeObj) {
      applyFallbackThemeDOM(themeObj);
    } else {
      void fetchThemesFromDisk().then((diskThemes) => {
        const full = diskThemes.find((t) => t.name === themeName);
        if (full) {
          upsertThemeInSTMemory(full);
          applyFallbackThemeDOM(full);
        }
      });
    }
  }

  return true;
}

export async function saveThemeToDisk(theme: ThemeObject): Promise<void> {
  await apiPost('themes/save', theme);
  upsertThemeInSTMemory(theme);
}

export async function deleteThemeFromDisk(themeName: string): Promise<void> {
  await apiPost('themes/delete', { name: themeName });
  removeThemeFromSTMemory(themeName);
}

export async function fetchBackgroundList(): Promise<string[]> {
  try {
    const data = await apiPost<{ images?: Array<string | { filename?: string }> }>('backgrounds/all', {});
    if (Array.isArray(data?.images)) {
      return data.images
        .map((item) => (typeof item === 'string' ? item : String(item?.filename || '')))
        .filter(Boolean);
    }
  } catch (_) {}

  const doc = getMainDoc();
  const names = new Set<string>();
  doc.querySelectorAll('.bg_example[bgfile], [data-bgfile]').forEach((el) => {
    const file = el.getAttribute('bgfile') || el.getAttribute('data-bgfile');
    if (file) names.add(file);
  });
  return Array.from(names);
}

export async function applyBackground(bgFile: string): Promise<void> {
  if (!bgFile) return;
  const doc = getMainDoc();
  const bg1 = doc.querySelector<HTMLElement>('#bg1');
  if (bg1) {
    const cur = bg1.style.backgroundImage || '';
    if (cur.includes(encodeURIComponent(bgFile)) || cur.includes(bgFile)) {
      return;
    }
  }

  try {
    const escaped = CSS.escape(bgFile);
    const card = doc.querySelector<HTMLElement>(
      `#bg_menu_content .bg_example[bgfile="${escaped}"], #bg_custom_content .bg_example[bgfile="${escaped}"]`,
    );
    if (card) {
      card.click();
      return;
    }
  } catch (_) {}

  try {
    const bgMod = await getBgModule();
    if (bgMod && typeof bgMod.applyGlobalBackground === 'function') {
      await bgMod.applyGlobalBackground(bgFile);
      return;
    }
  } catch (_) {}

  if (bg1) {
    bg1.style.backgroundImage = `url("backgrounds/${encodeURIComponent(bgFile)}")`;
  }
}

export interface CharacterBrief {
  name: string;
  avatar: string;
}

export function getCharacters(): CharacterBrief[] {
  const ctx = getSTContext();
  const list = Array.isArray(ctx?.characters) ? ctx.characters : [];
  return list
    .filter((c: any) => c && c.avatar)
    .map((c: any) => ({ name: String(c.name || c.avatar), avatar: String(c.avatar) }));
}

export function getCurrentCharacter(): CharacterBrief | null {
  const ctx = getSTContext();
  if (!ctx) return null;
  const chid = ctx.characterId;
  if (chid !== undefined && chid !== null && Array.isArray(ctx.characters)) {
    const c = ctx.characters[chid];
    if (c && c.avatar) {
      return { name: String(c.name || c.avatar), avatar: String(c.avatar) };
    }
  }
  return null;
}

export function onSTEvent(eventName: string, handler: (...args: any[]) => void): () => void {
  const ctx = getSTContext();
  const source = ctx?.eventSource;
  const types = ctx?.eventTypes || ctx?.event_types;
  const actualName = (types && types[eventName]) || eventName;

  if (source && typeof source.on === 'function') {
    source.on(actualName, handler);
    return () => {
      try {
        source.removeListener?.(actualName, handler);
      } catch (_) {}
    };
  }
  return () => {};
}
