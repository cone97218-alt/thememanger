import { getMainDoc, showToast } from '../bridge/host';
import { applyBackground } from '../bridge/st-api';
import { appStore, setThemeBackgroundBinding } from '../store/appStore';

let _bindingStartTime = 0;
let _bindingTimer: ReturnType<typeof setTimeout> | null = null;

export function cancelBackgroundBinding(): void {
  appStore.bgBindingTheme = null;
  if (_bindingTimer) {
    clearTimeout(_bindingTimer);
    _bindingTimer = null;
  }
}

/**
 * 进入背景图绑定模式：自动展开酒馆原生背景抽屉，等待用户可视化点选任意背景卡片
 */
export function startBackgroundBinding(themeName: string): void {
  if (!themeName) return;

  appStore.showSettingsModal = false;
  appStore.bgBindingTheme = themeName;
  _bindingStartTime = Date.now();

  if (_bindingTimer) clearTimeout(_bindingTimer);
  _bindingTimer = setTimeout(() => {
    if (appStore.bgBindingTheme) {
      cancelBackgroundBinding();
    }
  }, 60_000);

  // 延时打开背景抽屉，避开当前点击事件冒泡
  setTimeout(() => {
    const doc = getMainDoc();
    const bgDrawer = doc.querySelector<HTMLElement>('#Backgrounds');
    const toggleBtn =
      doc.querySelector<HTMLElement>('#backgrounds-drawer-toggle') ||
      doc.querySelector<HTMLElement>('#logo_block .drawer-toggle') ||
      doc.querySelector<HTMLElement>('#bg_button .drawer-toggle');
    if (toggleBtn && (!bgDrawer || bgDrawer.classList.contains('closedDrawer'))) {
      toggleBtn.click();
    }
  }, 60);
}

/**
 * 注册全局背景卡片拦截监听器（捕获阶段），还原原版跳转背景抽屉点选体验
 */
export function startBgBindingFeature(): () => void {
  const doc = getMainDoc();

  const onCaptureClick = (e: Event) => {
    const themeName = appStore.bgBindingTheme;
    if (!themeName) return;

    const target = e.target as HTMLElement | null;
    if (!target) return;

    // 取消条上的点击放行
    if (target.closest('#tc-bg-binding-banner')) return;

    const isGracePeriod = Date.now() - _bindingStartTime < 800;

    const isInsideBgArea = Boolean(
      target.closest(
        '#Backgrounds, #backgrounds-drawer-toggle, #logo_block, #bg_button, .bg_folder_tile, #bg_back_to_folders, #bg_tabs, .ui-tabs-nav, .bg_example, [bgfile], [data-bgfile]',
      ),
    );

    if (!isInsideBgArea) {
      if (!isGracePeriod && target.closest('#rm_print_characters_block, #send_textarea, #right-nav-panel, #sheld')) {
        cancelBackgroundBinding();
      }
      return;
    }

    // 放行文件夹进入、返回、选项卡切换和卡片内部辅助按钮
    if (
      target.closest(
        '.bg_folder_tile, #bg_back_to_folders, .ui-tabs-anchor, .bg_tab_button, .jg-button, .mobile-only-menu-toggle, #bg-filter, #bg-sort',
      )
    ) {
      return;
    }

    const bgEl = target.closest<HTMLElement>('.bg_example, [bgfile], [data-bgfile]');
    if (!bgEl) return;

    const bgFile =
      bgEl.getAttribute('bgfile') ||
      bgEl.dataset?.bgfile ||
      bgEl.getAttribute('data-bgfile') ||
      bgEl.querySelector<HTMLElement>('[bgfile]')?.getAttribute('bgfile') ||
      '';

    if (!bgFile) return;

    e.preventDefault();
    e.stopPropagation();

    setThemeBackgroundBinding(themeName, bgFile);
    cancelBackgroundBinding();

    if (themeName === appStore.activeTheme) {
      applyBackground(bgFile);
    }

    showToast('success', `已绑定背景：${bgFile}`);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && appStore.bgBindingTheme) {
      cancelBackgroundBinding();
    }
  };

  doc.addEventListener('click', onCaptureClick, true);
  doc.addEventListener('keydown', onKeyDown);

  return () => {
    cancelBackgroundBinding();
    doc.removeEventListener('click', onCaptureClick, true);
    doc.removeEventListener('keydown', onKeyDown);
  };
}
