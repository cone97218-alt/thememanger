import { getMainWin, showToast } from '../bridge/host';
import { appStore, resolveTargetTheme, selectTheme } from '../store/appStore';

export type DayNightState = 'day' | 'night';

export function detectCurrentDayNightState(): DayNightState {
  const cfg = appStore.settings.autoTheme;
  if (cfg.mode === 'time') {
    const now = new Date();
    const curMin = now.getHours() * 60 + now.getMinutes();
    const [dh, dm] = (cfg.dayStart || '07:00').split(':').map(Number);
    const [nh, nm] = (cfg.nightStart || '19:00').split(':').map(Number);
    const dayMin = (dh || 7) * 60 + (dm || 0);
    const nightMin = (nh || 19) * 60 + (nm || 0);
    if (dayMin < nightMin) {
      return curMin >= dayMin && curMin < nightMin ? 'day' : 'night';
    }
    return curMin >= nightMin && curMin < dayMin ? 'night' : 'day';
  }

  // system 模式
  const win = getMainWin();
  if (win.matchMedia && win.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'night';
  }
  return 'day';
}

/**
 * 执行一次自动日夜主题判定与切换
 */
export function evaluateAutoTheme(force = false): void {
  const cfg = appStore.settings.autoTheme;
  if (!cfg.enabled && !force) return;

  const state = detectCurrentDayNightState();
  const current = appStore.activeTheme;

  // 1. 优先检查当前主题是否属于某个日夜配对
  let target: string | null = null;
  const pair = appStore.settings.dayNightPairs.find(
    (p) => p.dayTheme === current || p.nightTheme === current,
  );
  if (pair) {
    target = state === 'day' ? pair.dayTheme || pair.nightTheme : pair.nightTheme || pair.dayTheme;
  }

  // 2. 否则回退到全局日/夜目标
  if (!target) {
    target = state === 'day' ? cfg.dayTarget : cfg.nightTarget;
  }

  const resolved = target ? resolveTargetTheme(target) : null;
  if (resolved && resolved !== current) {
    selectTheme(resolved);
  }
}

/**
 * 标题栏一键手动切换日/夜配对主题
 */
export function quickToggleDayNight(): void {
  const current = appStore.activeTheme;
  const pair = appStore.settings.dayNightPairs.find(
    (p) => p.dayTheme === current || p.nightTheme === current,
  );

  if (pair) {
    const next = current === pair.dayTheme ? pair.nightTheme : pair.dayTheme;
    if (next && next !== current) {
      const ok = selectTheme(next);
      if (ok) {
        const label = next === pair.dayTheme ? '日间' : '夜间';
        showToast('info', `已切换至${label}配对美化「${next}」`);
      }
      return;
    }
  }

  // 未配置当前主题配对时，按全局日夜目标反向切换
  const cfg = appStore.settings.autoTheme;
  const curState = detectCurrentDayNightState();
  const target = curState === 'day' ? cfg.nightTarget || cfg.dayTarget : cfg.dayTarget || cfg.nightTarget;
  const resolved = target ? resolveTargetTheme(target) : null;
  if (resolved && resolved !== current) {
    selectTheme(resolved);
    showToast('info', `已切换至「${resolved}」`);
  } else {
    showToast('warning', '请先在设置中配置日夜间配对或默认日/夜美化');
  }
}

/**
 * 启动自动日夜间监听（系统深浅色变化 + 每分钟检查时间段）
 */
export function startAutoThemeWatcher(): () => void {
  const win = getMainWin();
  let lastAppliedState: DayNightState | null = null;

  const tick = () => {
    if (!appStore.settings.autoTheme.enabled) return;
    const state = detectCurrentDayNightState();
    if (state !== lastAppliedState) {
      lastAppliedState = state;
      evaluateAutoTheme();
    }
  };

  // 启动时执行一次
  tick();

  const mediaQuery = win.matchMedia ? win.matchMedia('(prefers-color-scheme: dark)') : null;
  const onMediaChange = () => tick();
  mediaQuery?.addEventListener?.('change', onMediaChange);

  const timer = setInterval(tick, 60_000);

  return () => {
    clearInterval(timer);
    mediaQuery?.removeEventListener?.('change', onMediaChange);
  };
}
