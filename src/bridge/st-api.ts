import type { ThemeObject } from '../types';
import { getMainDoc, getMainWin, getSTContext } from './host';

export const SETTINGS_NAMESPACE = 'theme_companion_v3';

let _bgModulePromise: Promise<any> | null = null;
let _puModulePromise: Promise<any> | null = null;

/**
 * 记录当前已在酒馆 power-user.js 私有 themes 闭包内的主题名集合
 * 存量主题直接走 100% 原生 #themes change，仅本会话免刷新新增主题才走 applyPowerUserSettings
 */
const nativeKnownThemes = new Set<string>();
let _knownThemesInitialized = false;

function ensureNativeKnownThemes(): void {
  if (_knownThemesInitialized) return;
  const doc = getMainDoc();
  const select = doc.querySelector<HTMLSelectElement>('#themes');
  if (select && select.options.length > 0) {
    Array.from(select.options).forEach((opt) => {
      if (opt.value) nativeKnownThemes.add(opt.value);
    });
    _knownThemesInitialized = true;
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

async function getPowerUserModule(): Promise<any> {
  if (!_puModulePromise) {
    const win = getMainWin();
    const base = win.location?.origin || '';
    _puModulePromise = import(/* @vite-ignore */ `${base}/scripts/power-user.js`).catch(() => null);
  }
  return _puModulePromise;
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
  ensureNativeKnownThemes();
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
  ensureNativeKnownThemes();
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

  ensureNativeKnownThemes();

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

  // 若宿主支持 baibaokuHydrateTheme，直接注入 power-user.js 私有 themes 闭包并标记为原生已知
  if (typeof win.baibaokuHydrateTheme === 'function') {
    try {
      win.baibaokuHydrateTheme(theme);
      nativeKnownThemes.add(name);
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

  nativeKnownThemes.delete(name);

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

const COLOR_PICKER_MAP: Array<{ key: string; selector: string }> = [
  { key: 'main_text_color', selector: '#main-text-color-picker' },
  { key: 'italics_text_color', selector: '#italics-color-picker' },
  { key: 'underline_text_color', selector: '#underline-color-picker' },
  { key: 'quote_text_color', selector: '#quote-color-picker' },
  { key: 'blur_tint_color', selector: '#blur-tint-color-picker' },
  { key: 'chat_tint_color', selector: '#chat-tint-color-picker' },
  { key: 'user_mes_blur_tint_color', selector: '#user-mes-blur-tint-color-picker' },
  { key: 'bot_mes_blur_tint_color', selector: '#bot-mes-blur-tint-color-picker' },
  { key: 'shadow_color', selector: '#shadow-color-picker' },
  { key: 'border_color', selector: '#border-color-picker' },
];

/**
 * 仅针对本会话免刷新新增（尚未进入 power-user.js 私有 themes 闭包）的主题：
 * 将主题属性合并进 power_user 并调用酒馆官方导出的 applyPowerUserSettings()
 */
async function applyDynamicThemeViaNativeModule(theme: ThemeObject): Promise<void> {
  const doc = getMainDoc();
  const ctx = getSTContext();
  const puMod = await getPowerUserModule();
  const pu = puMod?.power_user || getPowerUser();

  if (pu) {
    for (const [k, v] of Object.entries(theme)) {
      if (k !== '_xia' && v !== undefined) {
        pu[k] = v;
      }
    }
    pu.theme = theme.name;
  }

  // 同步颜色选择器（触发酒馆原生 applyThemeColor 管道）
  for (const { key, selector } of COLOR_PICKER_MAP) {
    const val = theme[key];
    if (typeof val === 'string' && val) {
      const el = doc.querySelector<HTMLElement>(selector);
      if (el) {
        el.setAttribute('color', val);
        el.dispatchEvent(new CustomEvent('change', { detail: { rgba: val } }));
      }
    }
  }

  // 调用酒馆官方导出的 applyPowerUserSettings() 执行全套原生渲染（CSS、字号、聊天宽度、头像样式、开关等）
  if (typeof puMod?.applyPowerUserSettings === 'function') {
    puMod.applyPowerUserSettings();
  }
  if (typeof puMod?.applyStylePins === 'function') {
    puMod.applyStylePins();
  }

  if (typeof ctx?.saveSettingsDebounced === 'function') {
    ctx.saveSettingsDebounced();
  }
}

/**
 * 切换主题（存量主题 100% 走原生 #themes change；免刷新新推送主题走酒馆官方 applyPowerUserSettings）
 */
export function applyTheme(themeName: string, themeObj?: ThemeObject): boolean {
  ensureNativeKnownThemes();

  const doc = getMainDoc();
  const win = getMainWin();
  const select = doc.querySelector<HTMLSelectElement>('#themes');
  if (!select) return false;

  if (themeObj) {
    upsertThemeInSTMemory(themeObj);
  }

  // 排他性选中目标 <option>，确保酒馆 $(this).find(':selected').val() 精确命中
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
    if (!themeObj) return false;
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

  // 若该主题是本会话免刷新新推送/导入的（不在启动时的原生闭包内），走酒馆官方 applyPowerUserSettings
  if (themeObj && !nativeKnownThemes.has(themeName)) {
    void applyDynamicThemeViaNativeModule(themeObj);
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
