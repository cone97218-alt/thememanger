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
 * 捕获当前界面正在编辑的完整美化快照（含最大化 CSS 编辑器、#customCSS、CodeMirror、实时取色器、滑块与 power_user）
 */
export function captureCurrentThemeSnapshot(
  targetName: string,
  baseObj?: ThemeObject,
): ThemeObject {
  const doc = getMainDoc();
  const win = getMainWin();
  const pu = getPowerUser();
  const currentObj: Record<string, any> = { ...(baseObj || {}) };

  let currentCss: string | null = null;

  // 1. 优先检查展开的最大化 CSS 编辑器 (.maximized_textarea[data-for="customCSS"])
  const maxTextarea = doc.querySelector<HTMLTextAreaElement>(
    '.maximized_textarea[data-for="customCSS"]',
  );
  if (maxTextarea && typeof maxTextarea.value === 'string') {
    if (maxTextarea.value.trim().length > 0 || doc.activeElement === maxTextarea) {
      currentCss = maxTextarea.value;
      const origArea = doc.querySelector<HTMLTextAreaElement>('#customCSS');
      if (origArea && origArea.value !== currentCss) {
        origArea.value = currentCss;
        try {
          origArea.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (_) {}
      }
    }
  }

  // 2. 检查标准 #customCSS 输入框 / CodeMirror
  if (currentCss === null) {
    const editorEl = doc.querySelector<any>('#customCSS, #style_custom_content');
    if (editorEl) {
      let editorVal: string | null = null;
      if (editorEl.CodeMirror && typeof editorEl.CodeMirror.getValue === 'function') {
        editorVal = editorEl.CodeMirror.getValue();
      } else if (win.jQuery) {
        try {
          const cm = win.jQuery(editorEl).data('codemirror');
          if (cm && typeof cm.getValue === 'function') editorVal = cm.getValue();
        } catch (_) {}
      }
      if (editorVal === null && typeof editorEl.value === 'string') {
        editorVal = editorEl.value;
      }
      if (typeof editorVal === 'string') {
        const activeStyle = doc.getElementById('custom-style');
        if (
          editorVal.trim().length > 0 ||
          doc.activeElement === editorEl ||
          !pu?.custom_css ||
          !activeStyle?.innerHTML?.trim()
        ) {
          currentCss = editorVal;
        }
      }
    }
  }

  // 3. 回退到 power_user.custom_css -> <style id="custom-style"> -> 原对象
  if (currentCss === null) {
    if (pu && typeof pu.custom_css === 'string') {
      currentCss = pu.custom_css;
    } else {
      const styleTag = doc.getElementById('custom-style');
      if (styleTag && typeof styleTag.innerHTML === 'string') {
        currentCss = styleTag.innerHTML;
      } else if (typeof currentObj.custom_css === 'string') {
        currentCss = currentObj.custom_css;
      } else {
        currentCss = '';
      }
    }
  }

  if (pu) pu.custom_css = currentCss;

  const extractNum = (sliderId: string, counterId: string, puProp: string, defVal: number) => {
    const counter = doc.querySelector<HTMLInputElement>(counterId);
    const slider = doc.querySelector<HTMLInputElement>(sliderId);
    if (counter && counter.value !== '' && !Number.isNaN(Number(counter.value))) {
      const cVal = Number(counter.value);
      if (doc.activeElement === counter || !slider || cVal !== Number(slider.value)) {
        return cVal;
      }
    }
    if (slider && slider.value !== '' && !Number.isNaN(Number(slider.value))) {
      return Number(slider.value);
    }
    if (pu && pu[puProp] !== undefined && !Number.isNaN(Number(pu[puProp]))) {
      return Number(pu[puProp]);
    }
    if (currentObj[puProp] !== undefined && !Number.isNaN(Number(currentObj[puProp]))) {
      return Number(currentObj[puProp]);
    }
    return defVal;
  };

  const getColorVal = (pickerId: string, puProp: string, cssVar: string) => {
    const picker = doc.querySelector<any>(pickerId);
    if (picker) {
      if (typeof picker.rgba === 'string' && picker.rgba.trim()) return picker.rgba.trim();
      if (typeof picker.value === 'string' && picker.value.trim()) return picker.value.trim();
    }
    const cssVal = doc.documentElement.style.getPropertyValue(cssVar).trim();
    if (cssVal) return cssVal;
    if (pu && typeof pu[puProp] === 'string' && pu[puProp].trim()) return pu[puProp].trim();
    if (picker) {
      const attrCol = picker.getAttribute('color');
      if (typeof attrCol === 'string' && attrCol.trim()) return attrCol.trim();
    }
    return typeof currentObj[puProp] === 'string' ? currentObj[puProp] : 'rgba(220, 220, 220, 1)';
  };

  const snapshot: ThemeObject = {
    ...currentObj,
    name: targetName,
    custom_css: currentCss,
    chat_width: extractNum('#chat_width_slider', '#chat_width_slider_counter', 'chat_width', 50),
    font_scale: extractNum('#font_scale', '#font_scale_counter', 'font_scale', 1),
    blur_strength: extractNum('#blur_strength', '#blur_strength_counter', 'blur_strength', 10),
    shadow_width: extractNum('#shadow_width', '#shadow_width_counter', 'shadow_width', 2),
  };

  for (const { key, pickerId, cssVar } of THEME_COLOR_KEYS) {
    snapshot[key] = getColorVal(pickerId, key, cssVar);
    if (pu) pu[key] = snapshot[key];
  }

  const extraKeys = [
    'fast_ui_mode',
    'waifuMode',
    'avatar_style',
    'chat_display',
    'toastr_position',
    'noShadows',
    'timer_enabled',
    'timestamps_enabled',
    'timestamp_model_icon',
    'mesIDDisplay_enabled',
    'hideChatAvatars_enabled',
    'message_token_count_enabled',
    'expand_message_actions',
    'enableZenSliders',
    'enableLabMode',
    'hotswap_enabled',
    'bogus_folders',
    'zoomed_avatar_magnification',
    'reduced_motion',
    'compact_input_area',
    'show_swipe_num_all_messages',
    'click_to_edit',
    'media_display',
  ];
  if (pu) {
    for (const k of extraKeys) {
      if (pu[k] !== undefined) snapshot[k] = pu[k];
    }
  }

  return snapshot;
}

/**
 * 原版 theme-core.js 实战验证的全量权威固化引擎（Master Theme Enforcer）
 * 直接在主窗口 document 与 power_user 上同步 10 项颜色、custom_css、CodeMirror、滑块、布尔开关及 TT 酒馆 chat_metadata.theme
 */
export function enforceThemeMaster(cleanTheme: ThemeObject): void {
  const doc = getMainDoc();
  const win = getMainWin();
  const ctx = getSTContext();
  const pu = getPowerUser();
  const rootStyle = doc.documentElement.style;

  if (pu) {
    pu.theme = cleanTheme.name;
  }

  // 1. 同步 custom_css 至内存、编辑器（含 CodeMirror）与 <style id="custom-style">
  const customCss = typeof cleanTheme.custom_css === 'string' ? cleanTheme.custom_css : '';
  if (pu) {
    pu.custom_css = customCss;
  }
  const editorEl = doc.querySelector<any>('#customCSS, #style_custom_content, #custom_style');
  if (editorEl) {
    editorEl.value = customCss;
    if (editorEl.CodeMirror && typeof editorEl.CodeMirror.setValue === 'function') {
      editorEl.CodeMirror.setValue(customCss);
    } else if (win.jQuery) {
      try {
        const cm = win.jQuery(editorEl).data('codemirror');
        if (cm && typeof cm.setValue === 'function') cm.setValue(customCss);
      } catch (_) {}
    }
  }
  let customStyleTag = doc.getElementById('custom-style') as HTMLStyleElement | null;
  if (!customStyleTag) {
    customStyleTag = doc.createElement('style');
    customStyleTag.setAttribute('type', 'text/css');
    customStyleTag.setAttribute('id', 'custom-style');
    doc.head.appendChild(customStyleTag);
  }
  customStyleTag.innerHTML = customCss;

  // 2. 同步 10 项主题色至 CSS 变量、取色器属性、复选框 RGBA 与 meta[name=theme-color]
  for (const { key, pickerId, cssVar } of THEME_COLOR_KEYS) {
    const col = cleanTheme[key];
    if (typeof col === 'string' && col) {
      if (pu) pu[key] = col;
      try {
        rootStyle.setProperty(cssVar, col);
      } catch (_) {}

      const picker = doc.querySelector<any>(pickerId);
      if (picker) {
        try {
          picker.setAttribute('color', col);
          if ('rgba' in picker) picker.rgba = col;
        } catch (_) {}
      }

      if (key === 'main_text_color' && col.includes('(')) {
        try {
          const parts = col.split('(')[1].split(')')[0].split(',');
          if (parts.length >= 4) {
            rootStyle.setProperty('--SmartThemeCheckboxBgColorR', parts[0].trim());
            rootStyle.setProperty('--SmartThemeCheckboxBgColorG', parts[1].trim());
            rootStyle.setProperty('--SmartThemeCheckboxBgColorB', parts[2].trim());
            rootStyle.setProperty('--SmartThemeCheckboxBgColorA', parts[3].trim());
          }
        } catch (_) {}
      }

      if (key === 'blur_tint_color') {
        try {
          const metaThemeColor = doc.querySelector('meta[name=theme-color]');
          if (metaThemeColor) metaThemeColor.setAttribute('content', col);
        } catch (_) {}
      }
    }
  }

  // 3. 同步聊天宽度、字号、模糊度、阴影宽度
  if (cleanTheme.chat_width !== undefined) {
    const widthVal = Number(cleanTheme.chat_width) || 50;
    if (pu) pu.chat_width = widthVal;
    rootStyle.setProperty('--sheldWidth', `${widthVal}vw`);
    const slider = doc.querySelector<HTMLInputElement>('#chat_width_slider');
    if (slider) slider.value = String(widthVal);
    const counter = doc.querySelector<HTMLInputElement>('#chat_width_slider_counter');
    if (counter) counter.value = String(widthVal);
  }
  if (cleanTheme.font_scale !== undefined) {
    const fontVal = Number(cleanTheme.font_scale) || 1;
    if (pu) pu.font_scale = fontVal;
    rootStyle.setProperty('--sheldFontScale', `${fontVal}`);
    rootStyle.setProperty('--fontScale', String(fontVal));
    const slider = doc.querySelector<HTMLInputElement>('#font_scale');
    if (slider) slider.value = String(fontVal);
    const counter = doc.querySelector<HTMLInputElement>('#font_scale_counter');
    if (counter) counter.value = String(fontVal);
  }
  if (cleanTheme.blur_strength !== undefined) {
    const parsedBlur = Number(cleanTheme.blur_strength);
    const blurVal = Number.isFinite(parsedBlur) ? Math.max(0, parsedBlur) : 10;
    if (pu) pu.blur_strength = blurVal;
    rootStyle.setProperty('--sheldBlur', `${blurVal}px`);
    rootStyle.setProperty('--blurStrength', String(blurVal));
    const slider = doc.querySelector<HTMLInputElement>('#blur_strength');
    if (slider) slider.value = String(blurVal);
    const counter = doc.querySelector<HTMLInputElement>('#blur_strength_counter');
    if (counter) counter.value = String(blurVal);
  }
  if (cleanTheme.shadow_width !== undefined) {
    const parsedShadow = Number(cleanTheme.shadow_width);
    const shadowVal = Number.isFinite(parsedShadow) ? Math.max(0, parsedShadow) : 2;
    if (pu) pu.shadow_width = shadowVal;
    rootStyle.setProperty('--shadowWidth', String(shadowVal));
    const slider = doc.querySelector<HTMLInputElement>('#shadow_width');
    if (slider) slider.value = String(shadowVal);
    const counter = doc.querySelector<HTMLInputElement>('#shadow_width_counter');
    if (counter) counter.value = String(shadowVal);
  }

  // 4. 同步布尔开关与 body class
  const boolFlags: Array<{ key: string; selector: string; bodyClass: string }> = [
    { key: 'fast_ui_mode', selector: '#fast_ui_mode', bodyClass: 'fast-ui' },
    { key: 'waifuMode', selector: '#waifuMode', bodyClass: 'waifuMode' },
    { key: 'noShadows', selector: '#noShadows', bodyClass: 'noShadows' },
    { key: 'reduced_motion', selector: '#reduced_motion', bodyClass: 'reduced-motion' },
    { key: 'compact_input_area', selector: '#compact_input_area', bodyClass: 'compact-input' },
  ];
  for (const { key, selector, bodyClass } of boolFlags) {
    if (cleanTheme[key] !== undefined) {
      const enabled = Boolean(cleanTheme[key]);
      if (pu) pu[key] = enabled;
      const el = doc.querySelector<HTMLInputElement>(selector);
      if (el) el.checked = enabled;
      doc.body.classList.toggle(bodyClass, enabled);
    }
  }

  const extraKeys = [
    'avatar_style',
    'chat_display',
    'toastr_position',
    'timer_enabled',
    'timestamps_enabled',
    'timestamp_model_icon',
    'mesIDDisplay_enabled',
    'hideChatAvatars_enabled',
    'message_token_count_enabled',
    'expand_message_actions',
    'enableZenSliders',
    'enableLabMode',
    'hotswap_enabled',
    'bogus_folders',
    'zoomed_avatar_magnification',
    'show_swipe_num_all_messages',
    'click_to_edit',
    'media_display',
  ];
  if (pu) {
    for (const k of extraKeys) {
      if (cleanTheme[k] !== undefined) {
        pu[k] = cleanTheme[k];
      }
    }
  }

  // 5. 同步 TT 酒馆 / ST 的 chat_metadata.theme 并持久化保存
  try {
    if (ctx?.chat_metadata) {
      ctx.chat_metadata.theme = cleanTheme.name;
      if (typeof ctx.saveMetadataDebounced === 'function') ctx.saveMetadataDebounced();
    }
    if (ctx?.chatMetadata) {
      ctx.chatMetadata.theme = cleanTheme.name;
    }
    if (typeof ctx?.saveSettingsDebounced === 'function') {
      ctx.saveSettingsDebounced();
    }
  } catch (_) {}
}

/**
 * 切换主题：排他性更新原生 #themes 下拉框 + 触发原生 change + 执行 Master Theme Enforcer
 * 若传入的 themeObj 缺少完整字段，自动从后端拉取完整主题对象后立即补齐应用
 */
export function applyTheme(themeName: string, themeObj?: ThemeObject): boolean {
  if (!themeName) return false;
  const doc = getMainDoc();
  const win = getMainWin();
  const select = doc.querySelector<HTMLSelectElement>('#themes');
  if (!select) return false;

  if (themeObj) {
    upsertThemeInSTMemory(themeObj);
  }

  // 排他性选中目标 <option>，避免 jQuery find(':selected') 命中旧项
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
  const optIdx = Array.from(select.options).indexOf(targetOpt);
  if (optIdx !== -1) select.selectedIndex = optIdx;

  // 先写入初始 custom_css，再触发原生 change，最后执行 Master Theme Enforcer 双重固化
  const hasFullData = Boolean(
    themeObj && (themeObj.main_text_color || typeof themeObj.custom_css === 'string'),
  );
  if (hasFullData && themeObj) {
    enforceThemeMaster(themeObj);
  }

  if (win.jQuery) {
    try {
      win.jQuery(select).val(themeName).trigger('change');
    } catch (_) {
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } else {
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  if (hasFullData && themeObj) {
    enforceThemeMaster(themeObj);
  } else {
    // 若内存里只有名称没有完整属性，异步从磁盘拉取完整主题对象并立即固化
    void fetchThemesFromDisk().then((diskThemes) => {
      const full = diskThemes.find((t) => t.name === themeName);
      if (full) {
        upsertThemeInSTMemory(full);
        enforceThemeMaster(full);
      }
    });
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
