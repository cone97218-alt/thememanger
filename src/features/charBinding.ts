import { getMainDoc, getSTContext, showToast } from '../bridge/host';
import {
  applyBackground,
  applyTheme,
  getActiveThemeName,
  getCurrentCharacter,
  getExpectedActiveTheme,
  installPowerUserThemeInterceptor,
  onSTEvent,
} from '../bridge/st-api';
import { appStore, resolveTargetTheme, selectTheme } from '../store/appStore';

const TT_HIDE_STYLE_ID = 'tc-hide-tt-native-bind-style';

function isNativeContextThemeSyncListener(fn: unknown): boolean {
  if (typeof fn !== 'function') return false;
  const name = fn.name || '';
  const str = typeof fn.toString === 'function' ? fn.toString() : '';
  return (
    name === 'syncThemeForCurrentContext' ||
    name === 'applyThemeForCurrentContext' ||
    str.includes('applyThemeForCurrentContext') ||
    str.includes('syncThemeForCurrentContext')
  );
}

/**
 * 彻底屏蔽 TT 酒馆（TauriTavern）原生的角色/聊天主题自动同步监听器，防止与本拓展冲突
 */
function neutralizeTTContextThemeSync(): void {
  const ctx = getSTContext();
  const es = ctx?.eventSource;
  if (!es) return;

  const eventMaps = [es.events, es._events].filter(
    (m: unknown) => m && typeof m === 'object',
  ) as Array<Record<string, unknown>>;

  eventMaps.forEach((events) => {
    for (const [evtName, listeners] of Object.entries(events)) {
      if (!Array.isArray(listeners)) continue;
      events[evtName] = listeners.filter((fn) => !isNativeContextThemeSyncListener(fn));
    }
  });

  if (!es._tcSyncHooked) {
    es._tcSyncHooked = true;
    (['on', 'makeFirst', 'makeLast'] as const).forEach((method) => {
      if (typeof es[method] === 'function') {
        const orig = es[method];
        es[method] = function (event: unknown, listener: unknown, ...rest: unknown[]) {
          if (isNativeContextThemeSyncListener(listener)) {
            return;
          }
          return orig.call(this, event, listener, ...rest);
        };
      }
    });
  }
}

/**
 * 屏蔽 TT 酒馆原生的角色/聊天主题绑定 UI 按钮与提示图标
 */
function injectHideTTBindingUIStyle(): void {
  const doc = getMainDoc();
  if (doc.getElementById(TT_HIDE_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = TT_HIDE_STYLE_ID;
  style.textContent = `
    #UI-presets-block > :not(#st-theme-companion-root),
    #UI-Theme-Block [id*="theme_bind"],
    #UI-Theme-Block [id*="theme-bind"],
    #UI-Theme-Block [id*="bind_theme"],
    #UI-Theme-Block [id*="bind-theme"],
    #UI-Theme-Block [id*="context_theme"],
    #UI-Theme-Block [id*="context-theme"],
    #UI-Theme-Block .theme-context-bind-btn,
    #UI-Theme-Block .tt-theme-bind-btn {
      display: none !important;
    }
  `;
  doc.head.appendChild(style);
}

/**
 * 基于 ST 官方 CHAT_CHANGED 事件监听角色切换并自动应用绑定美化
 */
export function startCharacterBindingWatcher(): () => void {
  neutralizeTTContextThemeSync();
  installPowerUserThemeInterceptor();
  injectHideTTBindingUIStyle();

  let lastAvatar = '';

  const applyForCurrentChar = () => {
    neutralizeTTContextThemeSync();
    installPowerUserThemeInterceptor();

    const ch = getCurrentCharacter();
    if (ch && ch.avatar) {
      const target = appStore.settings.characterBindings[ch.avatar];
      if (target && ch.avatar !== lastAvatar) {
        lastAvatar = ch.avatar;
        const resolved = resolveTargetTheme(target);
        if (resolved && resolved !== appStore.activeTheme) {
          if (selectTheme(resolved)) {
            showToast('info', `已为「${ch.name}」切换绑定美化：${resolved}`);
          }
          return;
        }
      }
      lastAvatar = ch.avatar;
    } else {
      lastAvatar = '';
    }

    // 若当前没有角色专属绑定（或处于首页欢迎页），检查是否被 TT 酒馆原生上下文同步回滚到了旧主题
    const expected = appStore.settings.lastActiveTheme || getExpectedActiveTheme();
    const domActive = getActiveThemeName();
    if (
      expected &&
      domActive !== expected &&
      appStore.themes.some((t) => t.name === expected)
    ) {
      const themeObj = appStore.themes.find((t) => t.name === expected);
      applyTheme(expected, themeObj);
      appStore.activeTheme = expected;
    }

    const active = appStore.activeTheme || domActive;
    const boundBg = active ? appStore.settings.backgroundBindings[active] : '';
    if (boundBg) {
      setTimeout(() => {
        applyBackground(boundBg);
      }, 200);
    }
  };

  // 启动时立即检查一次，修复在脚本挂载前已被 TT 酒馆首页初始化回滚的主题
  setTimeout(applyForCurrentChar, 60);

  const unsubChat = onSTEvent('CHAT_CHANGED', () => {
    setTimeout(applyForCurrentChar, 80);
  });

  const unsubChar = onSTEvent('CHARACTER_SELECTED', () => {
    setTimeout(applyForCurrentChar, 80);
  });

  return () => {
    unsubChat();
    unsubChar();
    getMainDoc().getElementById(TT_HIDE_STYLE_ID)?.remove();
  };
}
