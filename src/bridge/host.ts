/**
 * 安全获取 SillyTavern 主窗口与主文档（兼容酒馆助手 iframe 沙箱与直接注入两种模式）
 */
export function getMainWin(): Window & Record<string, any> {
  try {
    if (window.parent && window.parent !== window && window.parent.document) {
      return window.parent as Window & Record<string, any>;
    }
  } catch (_) {}
  try {
    if (window.top && window.top !== window && window.top.document) {
      return window.top as Window & Record<string, any>;
    }
  } catch (_) {}
  return window as Window & Record<string, any>;
}

export function getMainDoc(): Document {
  return getMainWin().document;
}

export function getSTContext(): Record<string, any> | null {
  try {
    const win = getMainWin();
    if (win.SillyTavern && typeof win.SillyTavern.getContext === 'function') {
      return win.SillyTavern.getContext() || null;
    }
  } catch (_) {}
  return null;
}

export function showToast(
  type: 'success' | 'info' | 'warning' | 'error',
  message: string,
  title = '美化管理',
) {
  const win = getMainWin();
  if (win.toastr && typeof win.toastr[type] === 'function') {
    win.toastr[type](message, title, { timeOut: 2600 });
  } else {
    console.log(`[ThemeCompanion][${type}] ${message}`);
  }
}
