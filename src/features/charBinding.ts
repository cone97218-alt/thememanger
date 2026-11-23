import { getMainDoc, getSTContext, showToast } from '../bridge/host';
import { getCurrentCharacter, onSTEvent } from '../bridge/st-api';
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
  injectHideTTBindingUIStyle();

  let lastAvatar = '';

  const applyForCurrentChar = () => {
    const ch = getCurrentCharacter();
    if (!ch || !ch.avatar || ch.avatar === lastAvatar) return;
    lastAvatar = ch.avatar;

    const target = appStore.settings.characterBindings[ch.avatar];
    if (!target) return;

    const resolved = resolveTargetTheme(target);
    if (resolved && resolved !== appStore.activeTheme) {
      if (selectTheme(resolved)) {
        showToast('info', `已为「${ch.name}」切换绑定美化：${resolved}`);
      }
    }
  };

  const unsub = onSTEvent('CHAT_CHANGED', () => {
    setTimeout(applyForCurrentChar, 80);
  });

  return () => {
    unsub();
    getMainDoc().getElementById(TT_HIDE_STYLE_ID)?.remove();
  };
}
