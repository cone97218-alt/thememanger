import type { ThemeObject } from '../types';
import { getMainDoc, getMainWin, getSTContext } from './host';

export const SETTINGS_NAMESPACE = 'theme_companion_v3';

let _bgModulePromise: Promise<any> | null = null;

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

/**
 * 读取/保存扩展持久化配置到 ST 官方 extension_settings
 */
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

/**
 * 获取当前激活主题名称
 */
export function getActiveThemeName(): string {
  const doc = getMainDoc();
  const select = doc.querySelector<HTMLSelectElement>('#themes');
  if (select?.value) return select.value;
  const pu = getPowerUser();
  return String(pu?.theme || '');
}

/**
 * 从酒馆前端内存读取当前已加载的主题对象列表
 */
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

/**
 * 直接向后端 /api/settings/get 拉取磁盘上最新的主题列表
 */
export async function fetchThemesFromDisk(): Promise<ThemeObject[]> {
  const data = await apiPost<{ themes?: ThemeObject[] }>('settings/get', {});
  const list = Array.isArray(data?.themes) ? data.themes : [];
  return list.filter((t) => t && typeof t === 'object' && typeof t.name === 'string' && t.name.trim());
}

/**
 * 将新增或更新的主题同步到酒馆前端内存与原生 #themes 下拉框（免刷新页面）
 */
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

/**
 * 从酒馆前端内存与 #themes 下拉框移除主题
 */
export function removeThemeFromSTMemory(name: string): void {
  if (!name) return;
  const ctx = getSTContext();
  const pu = getPowerUser();
  const win = getMainWin();
  const doc = getMainDoc();

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

const COLOR_VAR_MAP: Array<{ key: string; cssVar: string; picker: string }> = [
  { key: 'main_text_color', cssVar: '--SmartThemeBodyColor', picker: '#main-text-color-picker' },
  { key: 'italics_text_color', cssVar: '--SmartThemeEmColor', picker: '#italics-color-picker' },
  { key: 'underline_text_color', cssVar: '--SmartThemeUnderlineColor', picker: '#underline-color-picker' },
  { key: 'quote_text_color', cssVar: '--SmartThemeQuoteColor', picker: '#quote-color-picker' },
  { key: 'blur_tint_color', cssVar: '--SmartThemeBlurTintColor', picker: '#blur-tint-color-picker' },
  { key: 'chat_tint_color', cssVar: '--SmartThemeChatTintColor', picker: '#chat-tint-color-picker' },
  { key: 'user_mes_blur_tint_color', cssVar: '--SmartThemeUserMesBlurTintColor', picker: '#user-mes-blur-tint-color-picker' },
  { key: 'bot_mes_blur_tint_color', cssVar: '--SmartThemeBotMesBlurTintColor', picker: '#bot-mes-blur-tint-color-picker' },
  { key: 'shadow_color', cssVar: '--SmartThemeShadowColor', picker: '#shadow-color-picker' },
  { key: 'border_color', cssVar: '--SmartThemeBorderColor', picker: '#border-color-picker' },
];

/**
 * 直接将主题对象应用到 power_user、CSS 变量与 #custom-style，解决免刷新新推送主题不在 power-user.js 私有 themes 闭包内导致原生切换静默失效的问题
 */
function enforceThemeDirect(theme: ThemeObject): void {
  const doc = getMainDoc();
  const win = getMainWin();
  const ctx = getSTContext();
  const pu = getPowerUser();
  const rootStyle = doc.documentElement.style;

  if (pu) {
    pu.theme = theme.name;
  }

  for (const { key, cssVar, picker } of COLOR_VAR_MAP) {
    const val = theme[key];
    if (typeof val === 'string' && val) {
      if (pu) pu[key] = val;
      rootStyle.setProperty(cssVar, val);
      const pickerEl = doc.querySelector<HTMLElement>(picker);
      if (pickerEl) pickerEl.setAttribute('color', val);
    }
  }

  if (typeof theme.blur_strength === 'number') {
    if (pu) pu.blur_strength = theme.blur_strength;
    rootStyle.setProperty('--blurStrength', String(theme.blur_strength));
    const el = doc.querySelector<HTMLInputElement>('#blur_strength');
    if (el) el.value = String(theme.blur_strength);
  }
  if (typeof theme.shadow_width === 'number') {
    if (pu) pu.shadow_width = theme.shadow_width;
    rootStyle.setProperty('--shadowWidth', String(theme.shadow_width));
    const el = doc.querySelector<HTMLInputElement>('#shadow_width');
    if (el) el.value = String(theme.shadow_width);
  }
  if (typeof theme.font_scale === 'number') {
    if (pu) pu.font_scale = theme.font_scale;
    rootStyle.setProperty('--fontScale', String(theme.font_scale));
    const el = doc.querySelector<HTMLInputElement>('#font_scale');
    if (el) el.value = String(theme.font_scale);
  }
  if (typeof theme.chat_width === 'number') {
    if (pu) pu.chat_width = theme.chat_width;
    rootStyle.setProperty('--sheldWidth', `${theme.chat_width}vw`);
    const el = doc.querySelector<HTMLInputElement>('#chat_width');
    if (el) el.value = String(theme.chat_width);
  }

  // 自定义 CSS（#custom-style + 编辑器同步）
  if (typeof theme.custom_css === 'string') {
    const css = theme.custom_css;
    if (pu) pu.custom_css = css;
    const editor = doc.querySelector<HTMLTextAreaElement>(
      '#customCSS, #style_custom_content, #custom_style',
    );
    if (editor) editor.value = css;
    let styleTag = doc.getElementById('custom-style') as HTMLStyleElement | null;
    if (!styleTag) {
      styleTag = doc.createElement('style');
      styleTag.id = 'custom-style';
      styleTag.type = 'text/css';
      doc.head.appendChild(styleTag);
    }
    styleTag.textContent = css;
  }

  // 布尔外观开关
  const boolFlags: Array<{ key: string; selector: string; bodyClass: string }> = [
    { key: 'fast_ui_mode', selector: '#fast_ui_mode', bodyClass: 'fast-ui' },
    { key: 'waifuMode', selector: '#waifuMode', bodyClass: 'waifuMode' },
    { key: 'noShadows', selector: '#noShadows', bodyClass: 'noShadows' },
    { key: 'reduced_motion', selector: '#reduced_motion', bodyClass: 'reduced-motion' },
  ];
  for (const { key, selector, bodyClass } of boolFlags) {
    if (theme[key] !== undefined) {
      const enabled = Boolean(theme[key]);
      if (pu) pu[key] = enabled;
      const chk = doc.querySelector<HTMLInputElement>(selector);
      if (chk) chk.checked = enabled;
      doc.body.classList.toggle(bodyClass, enabled);
    }
  }

  // 触发头像/聊天样式选择器（如果主题定义了）
  const selectFields = ['avatar_style', 'chat_display'] as const;
  for (const field of selectFields) {
    if (theme[field] !== undefined) {
      if (pu) pu[field] = theme[field];
      const sel = doc.querySelector<HTMLSelectElement>(`#${field}`);
      if (sel) {
        sel.value = String(theme[field]);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        if (win.jQuery) {
          try {
            win.jQuery(sel).trigger('change');
          } catch (_) {}
        }
      }
    }
  }

  if (typeof ctx?.saveSettingsDebounced === 'function') {
    ctx.saveSettingsDebounced();
  }
}

/**
 * 切换主题：先走酒馆原生管道，再对免刷新新增主题执行直接属性固化，确保 0 刷新即刻生效
 */
export function applyTheme(themeName: string, themeObj?: ThemeObject): boolean {
  const doc = getMainDoc();
  const win = getMainWin();
  const select = doc.querySelector<HTMLSelectElement>('#themes');
  if (!select) return false;

  if (themeObj) {
    upsertThemeInSTMemory(themeObj);
  }

  let opt = Array.from(select.options).find((o) => o.value === themeName);
  if (!opt) {
    if (!themeObj) return false;
    opt = doc.createElement('option');
    opt.value = themeName;
    opt.textContent = themeName;
    select.appendChild(opt);
  }

  select.value = themeName;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  if (win.jQuery) {
    try {
      win.jQuery(select).trigger('change');
    } catch (_) {}
  }

  // 若是本会话刚推送/导入的新主题，power-user.js 私有 themes 数组中可能还没有它，直接写入样式与状态确保立即生效
  if (themeObj) {
    enforceThemeDirect(themeObj);
  }
  return true;
}

/**
 * 保存主题到后端并同步前端内存
 */
export async function saveThemeToDisk(theme: ThemeObject): Promise<void> {
  await apiPost('themes/save', theme);
  upsertThemeInSTMemory(theme);
}

/**
 * 删除主题并同步前端内存
 */
export async function deleteThemeFromDisk(themeName: string): Promise<void> {
  await apiPost('themes/delete', { name: themeName });
  removeThemeFromSTMemory(themeName);
}

/**
 * 获取当前已安装的背景图文件名列表
 */
export async function fetchBackgroundList(): Promise<string[]> {
  try {
    const data = await apiPost<{ images?: Array<string | { filename?: string }> }>('backgrounds/all', {});
    if (Array.isArray(data?.images)) {
      return data.images
        .map((item) => (typeof item === 'string' ? item : String(item?.filename || '')))
        .filter(Boolean);
    }
  } catch (_) {}

  // 降级：从 DOM 中已挂载的背景卡片读取
  const doc = getMainDoc();
  const names = new Set<string>();
  doc.querySelectorAll('.bg_example[bgfile], [data-bgfile]').forEach((el) => {
    const file = el.getAttribute('bgfile') || el.getAttribute('data-bgfile');
    if (file) names.add(file);
  });
  return Array.from(names);
}

/**
 * 应用背景图（优先通过 backgrounds.js 模块，兼容抽屉未展开/移动端冻结场景）
 */
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

  // 1. 若背景卡片已在 DOM 中，直接点击走原生流程
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

  // 2. 通过原生 backgrounds.js 模块应用
  try {
    const bgMod = await getBgModule();
    if (bgMod && typeof bgMod.applyGlobalBackground === 'function') {
      await bgMod.applyGlobalBackground(bgFile);
      return;
    }
  } catch (_) {}

  // 3. 兜底直写
  if (bg1) {
    bg1.style.backgroundImage = `url("backgrounds/${encodeURIComponent(bgFile)}")`;
  }
}

export interface CharacterBrief {
  name: string;
  avatar: string;
}

/**
 * 获取酒馆当前角色列表
 */
export function getCharacters(): CharacterBrief[] {
  const ctx = getSTContext();
  const list = Array.isArray(ctx?.characters) ? ctx.characters : [];
  return list
    .filter((c: any) => c && c.avatar)
    .map((c: any) => ({ name: String(c.name || c.avatar), avatar: String(c.avatar) }));
}

/**
 * 获取当前聊天角色
 */
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

/**
 * 订阅 SillyTavern 官方事件（返回取消订阅函数）
 */
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
