import type { ThemeObject } from '../types';
import { getMainDoc, getMainWin, getSTContext } from './host';

export const SETTINGS_NAMESPACE = 'theme_companion_v3';
export const LAST_ACTIVE_THEME_STORAGE_KEY = 'themeManager_lastActiveTheme';

let _bgModulePromise: Promise<any> | null = null;
let _expectedThemeGetter: (() => string) | null = null;

export function setExpectedThemeGetter(getter: () => string): void {
  _expectedThemeGetter = getter;
}

export function getExpectedActiveTheme(): string {
  const fromGetter = _expectedThemeGetter ? _expectedThemeGetter() : '';
  if (fromGetter) return fromGetter;
  try {
    const win = getMainWin();
    return win.localStorage?.getItem(LAST_ACTIVE_THEME_STORAGE_KEY) || '';
  } catch (_) {
    return '';
  }
}

export function recordExpectedActiveTheme(themeName: string): void {
  if (!themeName) return;
  try {
    const win = getMainWin();
    win.localStorage?.setItem(LAST_ACTIVE_THEME_STORAGE_KEY, themeName);
  } catch (_) {}
}

/**
 * 在 power_user.theme 上安装属性拦截器：
 * 当 TT 酒馆原生 syncThemeForCurrentContext / applyThemeForCurrentContext 在重进首页或切聊时
 * 试图把主题强行回退为旧主题 A 时，自动拦截并维持用户选定的美化 B
 */
export function installPowerUserThemeInterceptor(): void {
  const pu = getPowerUser();
  if (!pu || typeof pu !== 'object' || pu._tcThemeTrapInstalled) return;

  try {
    let currentTheme = String(pu.theme || '');
    Object.defineProperty(pu, '_tcThemeTrapInstalled', {
      value: true,
      writable: false,
      configurable: true,
    });

    Object.defineProperty(pu, 'theme', {
      get() {
        return currentTheme;
      },
      set(val: unknown) {
        const nextVal = String(val ?? '');
        const stack = new Error().stack || '';
        const isTTContextSync =
          stack.includes('syncThemeForCurrentContext') ||
          stack.includes('applyThemeForCurrentContext');

        if (isTTContextSync) {
          const expected = getExpectedActiveTheme();
          if (expected && nextVal && nextVal !== expected) {
            currentTheme = expected;
            queueMicrotask(() => {
              applyTheme(expected);
            });
            return;
          }
        }
        currentTheme = nextVal;
      },
      configurable: true,
      enumerable: true,
    });
  } catch (_) {}
}

/**
 * 记录需要由本插件直接渲染 DOM 的免刷新主题（本会话从酒馆匣推送或导入、尚未经酒馆原生保存按钮写入 power-user.js 闭包的主题）
 */
const freshlyIngestedThemes = new Set<string>();

/**
 * 记录酒馆启动时已在 power-user.js 私有 themes 闭包内的原生主题集合
 */
const nativeClosureThemes = new Set<string>();
let _closureSnapshotTaken = false;

export function captureInitialNativeThemes(): void {
  if (_closureSnapshotTaken) return;
  const doc = getMainDoc();
  const select = doc.querySelector<HTMLSelectElement>('#themes');
  if (select && select.options.length > 0) {
    Array.from(select.options).forEach((opt) => {
      if (opt.value) nativeClosureThemes.add(opt.value);
    });
    _closureSnapshotTaken = true;
  }
}

export function markThemeFreshlyIngested(name: string): void {
  if (name) {
    freshlyIngestedThemes.add(name);
  }
}

export function markThemeSavedByNative(name: string): void {
  if (name) {
    freshlyIngestedThemes.delete(name);
    nativeClosureThemes.add(name);
  }
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
  captureInitialNativeThemes();
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
  captureInitialNativeThemes();
  const data = await apiPost<{ themes?: ThemeObject[] }>('settings/get', {});
  const list = Array.isArray(data?.themes) ? data.themes : [];
  return list.filter((t) => t && typeof t === 'object' && typeof t.name === 'string' && t.name.trim());
}

export function upsertThemeInSTMemory(theme: ThemeObject): void {
  const name = theme?.name?.trim();
  if (!name) return;

  captureInitialNativeThemes();

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
      nativeClosureThemes.add(name);
      freshlyIngestedThemes.delete(name);
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
  nativeClosureThemes.delete(name);

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
 * 仅在原生 power-user.js 闭包未包含最新主题（如刚从酒馆匣免刷新推送的主题）时执行直接渲染
 * 注意：绝不可对 toolcool-color-picker 的只读 getter 属性 picker.rgba 赋值，否则在严格模式下会抛 TypeError 中断后续颜色同步
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
      // 1. 先更新取色器 attribute（它会同步触发取色器内部 change）
      const picker = doc.querySelector<HTMLElement>(pickerId);
      if (picker) {
        try {
          picker.setAttribute('color', col);
        } catch (_) {}
      }
      // 2. 再以主题原始颜色权威写回 power_user 与 :root CSS 变量，防止被取色器二次格式化篡改
      if (pu) pu[key] = col;
      rootStyle.setProperty(cssVar, col);

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

export function applyTheme(themeName: string, themeObj?: ThemeObject): boolean {
  if (!themeName) return false;
  captureInitialNativeThemes();
  installPowerUserThemeInterceptor();
  recordExpectedActiveTheme(themeName);

  const doc = getMainDoc();
  const win = getMainWin();
  const ctx = getSTContext();
  const pu = getPowerUser();
  const select = doc.querySelector<HTMLSelectElement>('#themes');
  if (!select) return false;

  if (themeObj) {
    upsertThemeInSTMemory(themeObj);
  }

  if (pu) {
    pu.theme = themeName;
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

  if (win.jQuery) {
    try {
      win.jQuery(select).val(themeName).trigger('change');
    } catch (_) {
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } else {
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const needsFallback =
    !nativeClosureThemes.has(themeName) || freshlyIngestedThemes.has(themeName);

  if (needsFallback) {
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

  // 同步更新当前聊天元数据中的 theme，防止 TT 酒馆重进或切回首页时用旧的 chat_metadata.theme 回滚美化
  try {
    if (ctx?.chat_metadata && typeof ctx.chat_metadata === 'object') {
      ctx.chat_metadata.theme = themeName;
      if (typeof ctx.saveMetadataDebounced === 'function') {
        ctx.saveMetadataDebounced();
      }
    }
    if (ctx?.chatMetadata && typeof ctx.chatMetadata === 'object') {
      ctx.chatMetadata.theme = themeName;
    }
    if (typeof ctx?.saveSettingsDebounced === 'function') {
      ctx.saveSettingsDebounced();
    }
  } catch (_) {}

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
