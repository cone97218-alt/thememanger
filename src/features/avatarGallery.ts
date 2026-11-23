import { getMainWin } from '../bridge/host';
import { appStore } from '../store/appStore';
import type { AvatarGalleryItem } from '../types';

const DB_NAME = 'ThemeCompanionGalleryDB';
const STORE_NAME = 'images';

let dbInstance: IDBDatabase | null = null;
const blobUrlCache = new Map<string, string>();

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise((resolve, reject) => {
    const idb = getMainWin().indexedDB || window.indexedDB;
    const req = idb.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      dbInstance = req.result;
      resolve(dbInstance);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * 启动时预加载所有本地图库图片为 Blob URL，保证图库与聊天头像零延迟渲染
 */
export async function initAvatarGalleryDB(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const list = (req.result || []) as Array<{ id: string; blob?: Blob }>;
        for (const item of list) {
          if (item?.id && item.blob) {
            const old = blobUrlCache.get(item.id);
            if (old) URL.revokeObjectURL(old);
            blobUrlCache.set(item.id, URL.createObjectURL(item.blob));
          }
        }
        appStore.galleryCacheVersion++;
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[ThemeCompanion] 图库数据库初始化失败:', err);
  }
}

export async function saveGalleryImageBlob(file: File | Blob, name?: string): Promise<AvatarGalleryItem> {
  const db = await openDB();
  const id = `gal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put({ id, name: name || '', blob: file });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  const url = URL.createObjectURL(file);
  blobUrlCache.set(id, url);
  appStore.galleryCacheVersion++;

  return { id, source: 'idb', name: name || '' };
}

export async function deleteGalleryImageBlob(id: string): Promise<void> {
  const cached = blobUrlCache.get(id);
  if (cached) {
    URL.revokeObjectURL(cached);
    blobUrlCache.delete(id);
  }
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (_) {}
  appStore.galleryCacheVersion++;
}

export function resolveGalleryItemUrl(item: AvatarGalleryItem | undefined | null): string {
  if (!item) return '';
  if (item.source === 'url') return item.url || '';
  return blobUrlCache.get(item.id) || '';
}

export function resolveOverrideUrl(targetKey: string): string {
  const overrideId = appStore.settings.avatar.avatarOverrides[targetKey];
  if (!overrideId) return '';
  if (targetKey === '__user__') {
    const found = appStore.settings.avatar.userGallery.find((i) => i.id === overrideId);
    return resolveGalleryItemUrl(found);
  }
  const list = appStore.settings.avatar.perCharacterGallery[targetKey] || [];
  const found = list.find((i) => i.id === overrideId);
  return resolveGalleryItemUrl(found);
}
