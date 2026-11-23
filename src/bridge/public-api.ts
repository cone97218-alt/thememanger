import type { TagItem } from '../types';
import { getMainDoc, getMainWin } from './host';

type TagListener = (tags: TagItem[]) => void;

const listeners = new Set<TagListener>();

function cloneTags(tags: TagItem[]): TagItem[] {
  return tags.map((t) => ({
    id: t.id,
    name: t.name,
    parentId: t.parentId ?? null,
    themes: [...t.themes],
  }));
}

/**
 * 注册完全兼容原版 API.md 的 window.themeManager 接口
 */
export function installPublicTagApi(getTagsRef: () => TagItem[]): void {
  const win = getMainWin();

  win.themeManager = {
    getTags(): TagItem[] {
      return cloneTags(getTagsRef());
    },
    getThemeTags(themeName: string): string[] {
      if (!themeName) return [];
      return getTagsRef()
        .filter((t) => Array.isArray(t.themes) && t.themes.includes(themeName))
        .map((t) => t.id);
    },
    onTagsChanged(callback: TagListener): () => void {
      if (typeof callback === 'function') {
        listeners.add(callback);
      }
      return () => {
        listeners.delete(callback);
      };
    },
  };
}

/**
 * 标签变更时触发回调并向主文档派发 themeManager:tagsChanged 自定义事件
 */
export function notifyTagsChanged(tags: TagItem[]): void {
  const snapshot = cloneTags(tags);
  listeners.forEach((cb) => {
    try {
      cb(snapshot);
    } catch (err) {
      console.error('[ThemeCompanion] onTagsChanged callback error:', err);
    }
  });

  try {
    const doc = getMainDoc();
    doc.dispatchEvent(new CustomEvent('themeManager:tagsChanged', { detail: snapshot }));
  } catch (err) {
    console.error('[ThemeCompanion] dispatch themeManager:tagsChanged error:', err);
  }
}
