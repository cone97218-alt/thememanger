import { createApp, type App as VueApp } from 'vue';
import App from './App.vue';
import './styles/main.css';
import { getMainDoc, getMainWin, getSTContext } from './bridge/host';
import { appStore, initStore, syncThemesWithDisk } from './store/appStore';
import { installPublicTagApi } from './bridge/public-api';
import { startSyncEngine } from './bridge/stvault-sync';
import { startAutoThemeWatcher } from './features/autoTheme';
import { startCharacterBindingWatcher } from './features/charBinding';
import { startAvatarFeature } from './features/avatarStyle';

const MOUNT_CONTAINER_ID = 'st-theme-companion-root';
const CLEANUP_KEY = '__ST_THEME_COMPANION_CLEANUP__';

function waitForHostReady(timeoutMs = 20_000): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const doc = getMainDoc();
      const ctx = getSTContext();
      const themeBlock = doc.querySelector<HTMLElement>('#UI-Theme-Block');
      const selectEl = doc.querySelector<HTMLSelectElement>('#themes');
      if (ctx && themeBlock && selectEl) {
        resolve(themeBlock);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        resolve(themeBlock || null);
        return;
      }
      setTimeout(check, 250);
    };
    check();
  });
}

async function bootstrap() {
  const win = getMainWin();
  const doc = getMainDoc();

  // 支持热更新重复加载：先干净卸载旧实例
  if (typeof win[CLEANUP_KEY] === 'function') {
    try {
      win[CLEANUP_KEY]();
    } catch (_) {}
  }

  const hostBlock = await waitForHostReady();
  if (!hostBlock) {
    console.warn('[ThemeCompanion] 未找到 #UI-Theme-Block，跳过挂载');
    return;
  }

  // 初始化状态与对外 API
  initStore();
  installPublicTagApi(() => appStore.settings.tags);

  // 创建挂载节点
  doc.getElementById(MOUNT_CONTAINER_ID)?.remove();
  const mountEl = doc.createElement('div');
  mountEl.id = MOUNT_CONTAINER_ID;

  // 插在原生 #themes 区块之后，保持视觉自然连贯
  const themesSelect = hostBlock.querySelector('#themes');
  if (themesSelect && themesSelect.parentElement) {
    themesSelect.parentElement.insertAdjacentElement('afterend', mountEl);
  } else {
    hostBlock.appendChild(mountEl);
  }

  const vueApp: VueApp = createApp(App);
  vueApp.mount(mountEl);

  // 启动各独立功能模块并收集卸载钩子
  const cleanups: Array<() => void> = [
    startSyncEngine(),
    startAutoThemeWatcher(),
    startCharacterBindingWatcher(),
    startAvatarFeature(),
  ];

  // 启动后若内存里没有主题列表，静默拉取一次磁盘列表
  if (appStore.themes.length === 0) {
    syncThemesWithDisk({ silent: true });
  }

  win[CLEANUP_KEY] = () => {
    cleanups.forEach((fn) => {
      try {
        fn();
      } catch (_) {}
    });
    try {
      vueApp.unmount();
    } catch (_) {}
    mountEl.remove();
  };

  console.log('[ThemeCompanion] v3.0.0 已挂载就绪');
}

bootstrap();
