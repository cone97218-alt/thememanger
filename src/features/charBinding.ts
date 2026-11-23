import { getCurrentCharacter, onSTEvent } from '../bridge/st-api';
import { showToast } from '../bridge/host';
import { appStore, resolveTargetTheme, selectTheme } from '../store/appStore';

/**
 * 基于 ST 官方 CHAT_CHANGED 事件监听角色切换并自动应用绑定美化
 */
export function startCharacterBindingWatcher(): () => void {
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

  return unsub;
}
