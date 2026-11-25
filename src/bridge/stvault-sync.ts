import type { StVaultThemePushedDetail } from '../types';
import { getMainDoc, getMainWin, showToast } from './host';
import { markThemeSavedByNative } from './st-api';
import { appStore, assignThemeToTagByName, createTag, ingestTheme, setThemeBackgroundBinding, syncThemesWithDisk } from '../store/appStore';

const FOCUS_SYNC_COOLDOWN_MS = 300_000; // 5 分钟冷却，避免频繁拉取全量 settings 拖慢切窗体验

interface StVaultTagsSyncedDetail {
  tagPaths?: string[];
  themeTags?: Record<string, string[]>;
  backgroundBindings?: Record<string, string>;
}

/**
 * 启动酒馆匣实时推送监听 & 切回窗口静默 Diff 同步
 * 返回清理函数，供热重载卸载时调用
 */
export function startSyncEngine(): () => void {
  const doc = getMainDoc();
  const win = getMainWin();

  // 1. 监听「酒馆匣互联」派发的实时推送事件（0ms 延迟）
  const onStVaultPushed = (ev: Event) => {
    const customEv = ev as CustomEvent<StVaultThemePushedDetail>;
    const detail = customEv?.detail;
    if (!detail || !detail.theme || !detail.theme.name) return;

    ingestTheme(detail.theme, {
      tags: detail.tags,
      category: detail.category,
      bg: detail.bg,
      autoApply: detail.autoApply,
    });

    const tagInfo = detail.tags?.length
      ? `（已自动归类：${detail.tags.join('、')}）`
      : detail.category
        ? `（已自动归类：${detail.category}）`
        : '';

    showToast('success', `收到酒馆匣推送的美化「${detail.theme.name}」${tagInfo}`);
  };

  doc.addEventListener('stvault:themePushed', onStVaultPushed);

  // 1.5 监听「酒馆匣互联」派发的全量双向标签同步事件
  const onStVaultTagsSynced = (ev: Event) => {
    const customEv = ev as CustomEvent<StVaultTagsSyncedDetail>;
    const detail = customEv?.detail;
    if (!detail) return;
    if (Array.isArray(detail.tagPaths)) {
      detail.tagPaths.forEach((p) => {
        if (p && typeof p === 'string') createTag(p);
      });
    }
    if (detail.themeTags && typeof detail.themeTags === 'object') {
      const existingThemeNames = new Set(appStore.themes.map((t) => t.name));
      Object.entries(detail.themeTags).forEach(([tName, paths]) => {
        if (!existingThemeNames.has(tName) || !Array.isArray(paths)) return;
        paths.forEach((p) => {
          if (p && typeof p === 'string') assignThemeToTagByName(tName, p);
        });
      });
    }
    if (detail.backgroundBindings && typeof detail.backgroundBindings === 'object') {
      Object.entries(detail.backgroundBindings).forEach(([tName, bgFile]) => {
        if (tName && typeof bgFile === 'string' && bgFile) {
          setThemeBackgroundBinding(tName, bgFile);
        }
      });
    }
  };

  doc.addEventListener('stvault:tagsSynced', onStVaultTagsSynced);

  // 2. 切回前台/窗口聚焦时的低开销静默 Diff 同步（延迟至空闲帧执行，不阻塞切窗）
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const maybeSilentSync = () => {
    if (!appStore.settings.autoSyncOnFocus) return;
    if (doc.visibilityState === 'hidden') return;
    const elapsed = Date.now() - appStore.lastSyncAt;
    if (elapsed < FOCUS_SYNC_COOLDOWN_MS) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      const run = () => syncThemesWithDisk({ silent: true });
      if (typeof win.requestIdleCallback === 'function') {
        win.requestIdleCallback(run, { timeout: 2000 });
      } else {
        run();
      }
    }, 600);
  };

  const onVisibilityChange = () => {
    if (doc.visibilityState === 'visible') {
      maybeSilentSync();
    }
  };

  doc.addEventListener('visibilitychange', onVisibilityChange);
  win.addEventListener('focus', maybeSilentSync);

  // 3. 监听酒馆原生 #themes 下拉框变化与原生保存/另存为操作
  const selectEl = doc.querySelector<HTMLSelectElement>('#themes');
  const syncSelectOptionsToStore = () => {
    if (!selectEl) return;
    Array.from(selectEl.options).forEach((opt) => {
      const name = opt.value?.trim();
      if (name && !appStore.themes.some((t) => t.name === name)) {
        appStore.themes.unshift({ name });
      }
    });
    if (selectEl.value && selectEl.value !== appStore.activeTheme) {
      appStore.activeTheme = selectEl.value;
    }
  };

  selectEl?.addEventListener('change', syncSelectOptionsToStore);

  let selectObserver: MutationObserver | null = null;
  if (selectEl && typeof MutationObserver !== 'undefined') {
    selectObserver = new MutationObserver(() => {
      syncSelectOptionsToStore();
      if (selectEl.value) markThemeSavedByNative(selectEl.value);
    });
    selectObserver.observe(selectEl, { childList: true });
  }

  const updateBtn = doc.getElementById('ui-preset-update-button');
  const onNativeSaveClick = () => {
    if (appStore.activeTheme) {
      markThemeSavedByNative(appStore.activeTheme);
    }
  };
  updateBtn?.addEventListener('click', onNativeSaveClick);

  return () => {
    if (idleTimer) clearTimeout(idleTimer);
    selectObserver?.disconnect();
    doc.removeEventListener('stvault:themePushed', onStVaultPushed);
    doc.removeEventListener('stvault:tagsSynced', onStVaultTagsSynced);
    doc.removeEventListener('visibilitychange', onVisibilityChange);
    win.removeEventListener('focus', maybeSilentSync);
    selectEl?.removeEventListener('change', syncSelectOptionsToStore);
    updateBtn?.removeEventListener('click', onNativeSaveClick);
  };
}
