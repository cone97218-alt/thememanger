import { createApp, type App as VueApp } from 'vue';
import ThemePanel from './components/ThemePanel.vue';
import ModalsRoot from './ModalsRoot.vue';
import './styles/main.css';
import { getMainDoc, getMainWin, getSTContext } from './bridge/host';
import { appStore, initStore, syncThemesWithDisk } from './store/appStore';
import { installPublicTagApi } from './bridge/public-api';
import { startSyncEngine } from './bridge/stvault-sync';
import { startAutoThemeWatcher } from './features/autoTheme';
import { startCharacterBindingWatcher } from './features/charBinding';
import { startAvatarFeature } from './features/avatarStyle';
import { startBgBindingFeature } from './features/bgBinding';
import { initAvatarGalleryDB } from './features/avatarGallery';

const PANEL_CONTAINER_ID = 'st-theme-companion-root';
const MODALS_CONTAINER_ID = 'st-theme-companion-modals';
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

  // 初始化状态、对外 API 与图库数据库
  initStore();
  installPublicTagApi(() => appStore.settings.tags);
  initAvatarGalleryDB();

  // 隐藏酒馆原生 #UI-presets-block 内的全部原生元素（包含「UI 主题」标题栏、#themes 下拉框及 TT 酒馆原生绑定按钮）
  const presetsBlock = hostBlock.querySelector<HTMLElement>('#UI-presets-block');
  const themesSelect = hostBlock.querySelector<HTMLSelectElement>('#themes');
  const originalSelectRow = themesSelect?.parentElement as HTMLElement | null;

  const hiddenOriginals: Array<{ el: HTMLElement; prevDisplay: string }> = [];
  if (presetsBlock) {
    Array.from(presetsBlock.children).forEach((child) => {
      const el = child as HTMLElement;
      if (el.id === PANEL_CONTAINER_ID) return;
      hiddenOriginals.push({ el, prevDisplay: el.style.display });
      el.style.display = 'none';
    });
  } else if (originalSelectRow) {
    hiddenOriginals.push({ el: originalSelectRow, prevDisplay: originalSelectRow.style.display });
    originalSelectRow.style.display = 'none';
  }

  // 1. 挂载主面板节点（完全替换原 #UI-presets-block 视觉区域）
  doc.getElementById(PANEL_CONTAINER_ID)?.remove();
  const panelMountEl = doc.createElement('div');
  panelMountEl.id = PANEL_CONTAINER_ID;

  if (presetsBlock) {
    presetsBlock.prepend(panelMountEl);
  } else if (originalSelectRow) {
    originalSelectRow.insertAdjacentElement('beforebegin', panelMountEl);
  } else {
    hostBlock.prepend(panelMountEl);
  }

  const panelApp: VueApp = createApp(ThemePanel);
  panelApp.mount(panelMountEl);

  // 2. 挂载独立弹窗根节点到主文档 body（避免 iframe 下 Vue <Teleport> 跨 realm 失效）
  doc.getElementById(MODALS_CONTAINER_ID)?.remove();
  const modalsMountEl = doc.createElement('div');
  modalsMountEl.id = MODALS_CONTAINER_ID;
  doc.body.appendChild(modalsMountEl);

  const modalsApp: VueApp = createApp(ModalsRoot);
  modalsApp.mount(modalsMountEl);

  // 启动各独立功能模块并收集卸载钩子
  const cleanups: Array<() => void> = [
    startSyncEngine(),
    startAutoThemeWatcher(),
    startCharacterBindingWatcher(),
    startBgBindingFeature(),
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

    hiddenOriginals.forEach(({ el, prevDisplay }) => {
      el.style.display = prevDisplay;
    });

    try {
      panelApp.unmount();
    } catch (_) {}
    try {
      modalsApp.unmount();
    } catch (_) {}
    panelMountEl.remove();
    modalsMountEl.remove();
  };

  console.log('[ThemeCompanion] v3.2.0 已挂载就绪');
}

bootstrap();
