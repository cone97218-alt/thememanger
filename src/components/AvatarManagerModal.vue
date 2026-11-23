<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { appStore } from '../store/appStore';
import { getCharacters, getCurrentCharacter, type CharacterBrief } from '../bridge/st-api';
import { getMainWin, showToast } from '../bridge/host';
import { triggerReplaceCharacterAvatar, triggerReplaceUserAvatar } from '../features/avatarStyle';
import {
  deleteGalleryImageBlob,
  resolveGalleryItemUrl,
  resolveOverrideUrl,
  saveGalleryImageBlob,
} from '../features/avatarGallery';
import type { AvatarCropRule, AvatarGalleryItem } from '../types';

const activeTab = ref<'gallery' | 'style'>('gallery');
const targetType = ref<'char' | 'user'>('char');
const userGalleryScope = ref<'global' | 'char'>('global');

const characters = ref<CharacterBrief[]>([]);
const selectedCharAvatar = ref<string>('');
const selectedCropKey = ref<string>('__global__');

const showUrlBar = ref(false);
const urlInput = ref('');
const isCheckingUrl = ref(false);
const brokenItemIds = ref<Set<string>>(new Set());
const galleryFileInput = ref<HTMLInputElement | null>(null);

// 图库批量删除状态
const isGalleryBatch = ref(false);
const selectedGalleryIds = ref<string[]>([]);

// 交互式自由裁剪框状态（百分比 0-100）
const isFreeCropMode = ref(false);
const cropImgRef = ref<HTMLImageElement | null>(null);
const cropBox = ref({ x: 15, y: 10, w: 70, h: 70 });
let dragMode: 'move' | 'resize' | null = null;
let dragStartX = 0;
let dragStartY = 0;
let dragStartBox = { x: 0, y: 0, w: 0, h: 0 };
let dragContainerRect: DOMRect | null = null;

function syncActiveCharacter() {
  characters.value = getCharacters();
  const cur = getCurrentCharacter();
  if (cur?.avatar) {
    selectedCharAvatar.value = cur.avatar;
    selectedCropKey.value = cur.avatar;
  } else if (!selectedCharAvatar.value && characters.value.length > 0) {
    selectedCharAvatar.value = characters.value[0].avatar;
  }
}

watch(
  () => appStore.showAvatarModal,
  (open) => {
    if (open) {
      syncActiveCharacter();
      showUrlBar.value = false;
      urlInput.value = '';
      isGalleryBatch.value = false;
      selectedGalleryIds.value = [];
      isFreeCropMode.value = false;
    }
  },
  { immediate: true },
);

watch([targetType, userGalleryScope, selectedCharAvatar], () => {
  isGalleryBatch.value = false;
  selectedGalleryIds.value = [];
});

const activeGalleryKey = computed(() => {
  if (targetType.value === 'user') {
    if (userGalleryScope.value === 'char') {
      return selectedCharAvatar.value ? `__user_char__:${selectedCharAvatar.value}` : '';
    }
    return '__user__';
  }
  return selectedCharAvatar.value;
});

const galleryList = computed<AvatarGalleryItem[]>(() => {
  void appStore.galleryCacheVersion;
  if (targetType.value === 'user') {
    if (userGalleryScope.value === 'char') {
      return selectedCharAvatar.value
        ? appStore.settings.avatar.perCharUserGallery[selectedCharAvatar.value] || []
        : [];
    }
    return appStore.settings.avatar.userGallery;
  }
  const key = selectedCharAvatar.value;
  if (!key) return [];
  return appStore.settings.avatar.perCharacterGallery[key] || [];
});

const activeOverrideId = computed(() => {
  const key = activeGalleryKey.value;
  if (!key) return '';
  return appStore.settings.avatar.avatarOverrides[key] || '';
});

const nativeCharAvatarSrc = computed(() => {
  if (!selectedCharAvatar.value) return '';
  return `/characters/${encodeURIComponent(selectedCharAvatar.value)}`;
});

const currentCrop = computed<AvatarCropRule>(() => {
  const cfg = appStore.settings.avatar;
  if (selectedCropKey.value === '__global__') {
    return cfg.defaultCrop;
  }
  return cfg.perCharacterCrop[selectedCropKey.value] || { ...cfg.defaultCrop };
});

const previewSrc = computed(() => {
  void appStore.galleryCacheVersion;
  const key =
    selectedCropKey.value === '__global__' ? selectedCharAvatar.value : selectedCropKey.value;
  if (key) {
    const overridden = resolveOverrideUrl(key);
    if (overridden) return overridden;
    return `/characters/${encodeURIComponent(key)}`;
  }
  return '';
});

const previewImgStyle = computed(() => ({
  objectPosition: `${currentCrop.value.posX}% ${currentCrop.value.posY}%`,
  transformOrigin: `${currentCrop.value.posX}% ${currentCrop.value.posY}%`,
  transform: `scale(${currentCrop.value.scale})`,
}));

const previewBoxStyle = computed(() => {
  const cfg = appStore.settings.avatar;
  const w = cfg.sizePx > 0 ? Math.min(Math.max(cfg.sizePx, 48), 140) : 88;
  return {
    width: `${w}px`,
    aspectRatio: cfg.aspectRatio === 'auto' ? '1 / 1' : cfg.aspectRatio.replace('/', ' / '),
    borderRadius: cfg.borderRadiusPx >= 0 ? `${cfg.borderRadiusPx}px` : '10px',
  };
});

function getItemSrc(item: AvatarGalleryItem): string {
  void appStore.galleryCacheVersion;
  return resolveGalleryItemUrl(item);
}

function appendToActiveGallery(item: AvatarGalleryItem) {
  if (targetType.value === 'user') {
    if (userGalleryScope.value === 'char') {
      const ch = selectedCharAvatar.value;
      if (!ch) return;
      if (!appStore.settings.avatar.perCharUserGallery[ch]) {
        appStore.settings.avatar.perCharUserGallery[ch] = [];
      }
      appStore.settings.avatar.perCharUserGallery[ch].unshift(item);
    } else {
      appStore.settings.avatar.userGallery.unshift(item);
    }
  } else {
    const key = selectedCharAvatar.value;
    if (!key) return;
    if (!appStore.settings.avatar.perCharacterGallery[key]) {
      appStore.settings.avatar.perCharacterGallery[key] = [];
    }
    appStore.settings.avatar.perCharacterGallery[key].unshift(item);
  }
}

function handleGalleryCardClick(itemId: string) {
  if (isGalleryBatch.value) {
    if (!itemId) return;
    const idx = selectedGalleryIds.value.indexOf(itemId);
    if (idx >= 0) selectedGalleryIds.value.splice(idx, 1);
    else selectedGalleryIds.value.push(itemId);
    return;
  }
  selectGalleryItem(itemId);
}

function selectGalleryItem(itemId: string) {
  const key = activeGalleryKey.value;
  if (itemId && brokenItemIds.value.has(itemId)) {
    showToast('warning', '该图片已失效，无法应用');
    return;
  }
  if (!itemId) {
    // 还原原图：用户模式下同时清除角色绑定与全局覆盖，确保任何情况下都能 100% 恢复原图
    if (targetType.value === 'user') {
      delete appStore.settings.avatar.avatarOverrides['__user__'];
      if (selectedCharAvatar.value) {
        delete appStore.settings.avatar.avatarOverrides[`__user_char__:${selectedCharAvatar.value}`];
      }
    } else if (key) {
      delete appStore.settings.avatar.avatarOverrides[key];
    }
    showToast('info', '已还原原图');
    return;
  }
  if (!key) return;
  appStore.settings.avatar.avatarOverrides[key] = itemId;
}

function markItemBroken(id: string) {
  const next = new Set(brokenItemIds.value);
  next.add(id);
  brokenItemIds.value = next;
}

function verifyImageUrl(url: string, timeoutMs = 6000): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    img.onload = () => finish(img.naturalWidth > 0);
    img.onerror = () => finish(false);
    img.src = url;
  });
}

function toggleGalleryBatch() {
  isGalleryBatch.value = !isGalleryBatch.value;
  selectedGalleryIds.value = [];
}

function selectAllGallery() {
  const all = galleryList.value.map((i) => i.id);
  if (all.length > 0 && all.every((id) => selectedGalleryIds.value.includes(id))) {
    selectedGalleryIds.value = [];
  } else {
    selectedGalleryIds.value = all;
  }
}

async function confirmBatchDeleteGallery() {
  const ids = new Set(selectedGalleryIds.value);
  if (ids.size === 0) return;
  const targets = galleryList.value.filter((i) => ids.has(i.id));
  for (const item of targets) {
    await handleRemoveGalleryItem(item);
  }
  selectedGalleryIds.value = [];
  isGalleryBatch.value = false;
  showToast('success', `已删除 ${targets.length} 张`);
}

function triggerUpload() {
  galleryFileInput.value?.click();
}

async function handleGalleryUpload(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  input.value = '';
  if (files.length === 0) return;

  if (!activeGalleryKey.value) {
    showToast('warning', '请先选择角色');
    return;
  }

  let added = 0;
  for (const file of files) {
    try {
      const item = await saveGalleryImageBlob(file, file.name);
      appendToActiveGallery(item);
      added++;
    } catch (err: any) {
      showToast('error', `上传失败：${err?.message || err}`);
    }
  }
  if (added > 0) {
    showToast('success', `已添加 ${added} 张`);
  }
}

async function handleAddUrl() {
  const clean = urlInput.value.trim();
  if (!clean || isCheckingUrl.value) return;
  if (!activeGalleryKey.value) {
    showToast('warning', '请先选择角色');
    return;
  }
  isCheckingUrl.value = true;
  const ok = await verifyImageUrl(clean);
  isCheckingUrl.value = false;
  if (!ok) {
    showToast('error', '图片链接无法加载，请检查地址或防盗链');
    return;
  }
  const item: AvatarGalleryItem = {
    id: `url_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    source: 'url',
    url: clean,
  };
  appendToActiveGallery(item);
  urlInput.value = '';
  showUrlBar.value = false;
  showToast('success', '已添加到图库');
}

async function handleRemoveGalleryItem(item: AvatarGalleryItem) {
  const key = activeGalleryKey.value;
  if (!key) return;

  if (appStore.settings.avatar.avatarOverrides[key] === item.id) {
    delete appStore.settings.avatar.avatarOverrides[key];
  }

  if (targetType.value === 'user') {
    if (userGalleryScope.value === 'char') {
      const ch = selectedCharAvatar.value;
      if (ch && appStore.settings.avatar.perCharUserGallery[ch]) {
        appStore.settings.avatar.perCharUserGallery[ch] =
          appStore.settings.avatar.perCharUserGallery[ch].filter((i) => i.id !== item.id);
      }
    } else {
      appStore.settings.avatar.userGallery = appStore.settings.avatar.userGallery.filter(
        (i) => i.id !== item.id,
      );
    }
  } else if (appStore.settings.avatar.perCharacterGallery[key]) {
    appStore.settings.avatar.perCharacterGallery[key] =
      appStore.settings.avatar.perCharacterGallery[key].filter((i) => i.id !== item.id);
  }

  if (item.source === 'idb') {
    await deleteGalleryImageBlob(item.id);
  }
}

function handleReplaceNative() {
  if (targetType.value === 'user') {
    triggerReplaceUserAvatar();
  } else {
    triggerReplaceCharacterAvatar();
  }
}

function updateCrop(patch: Partial<AvatarCropRule>) {
  const cfg = appStore.settings.avatar;
  if (selectedCropKey.value === '__global__') {
    cfg.defaultCrop = { ...cfg.defaultCrop, ...patch };
  } else {
    const prev = cfg.perCharacterCrop[selectedCropKey.value] || { ...cfg.defaultCrop };
    cfg.perCharacterCrop[selectedCropKey.value] = { ...prev, ...patch };
  }
}

function resetCurrentCrop() {
  const cfg = appStore.settings.avatar;
  if (selectedCropKey.value === '__global__') {
    cfg.defaultCrop = { posX: 50, posY: 50, scale: 1 };
  } else {
    delete cfg.perCharacterCrop[selectedCropKey.value];
  }
  showToast('info', '已重置');
}

// ==========================================================
// 交互式自由裁剪框（视觉裁剪 + Canvas 实体裁剪）
// ==========================================================

function startFreeCrop() {
  if (!previewSrc.value) {
    showToast('warning', '暂无可裁剪图片');
    return;
  }
  cropBox.value = { x: 15, y: 10, w: 70, h: 70 };
  isFreeCropMode.value = true;
}

function getClientXY(ev: MouseEvent | TouchEvent) {
  if ('touches' in ev && ev.touches.length > 0) {
    return { cx: ev.touches[0].clientX, cy: ev.touches[0].clientY };
  }
  const m = ev as MouseEvent;
  return { cx: m.clientX, cy: m.clientY };
}

function onCropPointerDown(mode: 'move' | 'resize', ev: MouseEvent | TouchEvent) {
  ev.preventDefault();
  ev.stopPropagation();
  const imgEl = cropImgRef.value;
  if (!imgEl) return;
  dragContainerRect = imgEl.getBoundingClientRect();
  dragMode = mode;
  const { cx, cy } = getClientXY(ev);
  dragStartX = cx;
  dragStartY = cy;
  dragStartBox = { ...cropBox.value };

  const win = getMainWin();
  const onMove = (e: MouseEvent | TouchEvent) => {
    if (!dragMode || !dragContainerRect) return;
    const { cx: nx, cy: ny } = getClientXY(e);
    const dxPct = ((nx - dragStartX) / dragContainerRect.width) * 100;
    const dyPct = ((ny - dragStartY) / dragContainerRect.height) * 100;

    if (dragMode === 'move') {
      const nextX = Math.min(Math.max(0, dragStartBox.x + dxPct), 100 - dragStartBox.w);
      const nextY = Math.min(Math.max(0, dragStartBox.y + dyPct), 100 - dragStartBox.h);
      cropBox.value = { ...dragStartBox, x: nextX, y: nextY };
    } else {
      const nextW = Math.min(Math.max(15, dragStartBox.w + dxPct), 100 - dragStartBox.x);
      const nextH = Math.min(Math.max(15, dragStartBox.h + dyPct), 100 - dragStartBox.y);
      cropBox.value = { ...dragStartBox, w: nextW, h: nextH };
    }
  };

  const onUp = () => {
    dragMode = null;
    win.removeEventListener('mousemove', onMove);
    win.removeEventListener('mouseup', onUp);
    win.removeEventListener('touchmove', onMove);
    win.removeEventListener('touchend', onUp);
  };

  win.addEventListener('mousemove', onMove);
  win.addEventListener('mouseup', onUp);
  win.addEventListener('touchmove', onMove, { passive: false });
  win.addEventListener('touchend', onUp);
}

function saveVisualCrop() {
  const b = cropBox.value;
  const centerX = Math.round(b.x + b.w / 2);
  const centerY = Math.round(b.y + b.h / 2);
  const scale = Number(Math.min(2.5, Math.max(1, 100 / Math.max(b.w, b.h))).toFixed(2));
  appStore.settings.avatar.enabled = true;
  updateCrop({ posX: centerX, posY: centerY, scale });
  isFreeCropMode.value = false;
  showToast('success', '已应用视觉裁剪');
}

async function saveCanvasCrop() {
  const imgEl = cropImgRef.value;
  if (!imgEl || !imgEl.naturalWidth || !imgEl.naturalHeight) {
    showToast('error', '图片尚未加载完成');
    return;
  }
  try {
    const b = cropBox.value;
    const sx = (b.x / 100) * imgEl.naturalWidth;
    const sy = (b.y / 100) * imgEl.naturalHeight;
    const sw = (b.w / 100) * imgEl.naturalWidth;
    const sh = (b.h / 100) * imgEl.naturalHeight;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw));
    canvas.height = Math.max(1, Math.round(sh));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 不可用');
    ctx.drawImage(imgEl, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((res) => resolve(res), 'image/png'),
    );
    if (!blob) throw new Error('生成裁剪图片失败');

    const item = await saveGalleryImageBlob(blob, `crop_${Date.now()}.png`);
    const targetChar =
      selectedCropKey.value === '__global__' ? selectedCharAvatar.value : selectedCropKey.value;
    if (targetChar) {
      if (!appStore.settings.avatar.perCharacterGallery[targetChar]) {
        appStore.settings.avatar.perCharacterGallery[targetChar] = [];
      }
      appStore.settings.avatar.perCharacterGallery[targetChar].unshift(item);
      appStore.settings.avatar.avatarOverrides[targetChar] = item.id;
    } else {
      appStore.settings.avatar.userGallery.unshift(item);
      appStore.settings.avatar.avatarOverrides['__user__'] = item.id;
    }
    isFreeCropMode.value = false;
    showToast('success', '实体裁剪已存入图库并应用');
  } catch (err: any) {
    showToast('error', `实体裁剪失败：${err?.message || err}`);
  }
}

function close() {
  appStore.showAvatarModal = false;
}
</script>

<template>
  <div v-if="appStore.showAvatarModal" class="tc-modal-mask" @click.self="close">
    <div class="tc-modal">
      <div class="tc-modal-header">
        <div class="tc-modal-title">
          <i class="fa-solid fa-user-pen"></i>
          <span>头像管理</span>
        </div>
        <button type="button" class="tc-icon-btn" title="关闭" @click="close">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>

      <div class="tc-tabs">
        <button
          type="button"
          class="tc-tab"
          :class="{ active: activeTab === 'gallery' }"
          @click="activeTab = 'gallery'"
        >
          <i class="fa-solid fa-images"></i>
          <span>图库</span>
        </button>
        <button
          type="button"
          class="tc-tab"
          :class="{ active: activeTab === 'style' }"
          @click="activeTab = 'style'"
        >
          <i class="fa-solid fa-crop-simple"></i>
          <span>样式与裁剪</span>
        </button>
      </div>

      <div class="tc-modal-body">
        <!-- Tab 1: 头像图库 -->
        <div v-if="activeTab === 'gallery'" class="tc-section">
          <div class="tc-row-between tc-wrap">
            <div class="tc-row-inline">
              <div class="tc-seg">
                <button
                  type="button"
                  class="tc-seg-btn"
                  :class="{ active: targetType === 'char' }"
                  @click="targetType = 'char'"
                >
                  <i class="fa-solid fa-user"></i>
                  <span>角色</span>
                </button>
                <button
                  type="button"
                  class="tc-seg-btn"
                  :class="{ active: targetType === 'user' }"
                  @click="targetType = 'user'"
                >
                  <i class="fa-solid fa-id-badge"></i>
                  <span>用户</span>
                </button>
              </div>

              <!-- 用户图库：全局 vs 当前角色专属 -->
              <div v-if="targetType === 'user'" class="tc-seg">
                <button
                  type="button"
                  class="tc-seg-btn"
                  :class="{ active: userGalleryScope === 'global' }"
                  @click="userGalleryScope = 'global'"
                >
                  全局
                </button>
                <button
                  type="button"
                  class="tc-seg-btn"
                  :class="{ active: userGalleryScope === 'char' }"
                  @click="userGalleryScope = 'char'"
                >
                  当前角色
                </button>
              </div>
            </div>

            <div class="tc-row-inline">
              <button type="button" class="tc-tool-btn" title="上传图片" @click="triggerUpload">
                <i class="fa-solid fa-upload"></i>
              </button>
              <button
                type="button"
                class="tc-tool-btn"
                :class="{ active: showUrlBar }"
                title="添加链接"
                @click="showUrlBar = !showUrlBar"
              >
                <i class="fa-solid fa-link"></i>
              </button>
              <button
                type="button"
                class="tc-tool-btn"
                :class="{ active: isGalleryBatch }"
                title="批量删除"
                @click="toggleGalleryBatch"
              >
                <i class="fa-solid fa-list-check"></i>
              </button>
              <button
                type="button"
                class="tc-tool-btn"
                title="还原原图"
                @click="selectGalleryItem('')"
              >
                <i class="fa-solid fa-rotate-left"></i>
              </button>
              <button type="button" class="tc-tool-btn" title="替换原图" @click="handleReplaceNative">
                <i class="fa-solid fa-file-image"></i>
              </button>
              <input
                ref="galleryFileInput"
                type="file"
                accept="image/*"
                multiple
                style="display: none"
                @change="handleGalleryUpload"
              />
            </div>
          </div>

          <select
            v-if="targetType === 'char' || userGalleryScope === 'char'"
            v-model="selectedCharAvatar"
            class="tc-select"
          >
            <option value="">选择角色</option>
            <option v-for="c in characters" :key="c.avatar" :value="c.avatar">{{ c.name }}</option>
          </select>

          <div v-if="showUrlBar" class="tc-form-row">
            <input
              v-model="urlInput"
              type="url"
              class="tc-input tc-flex-1"
              placeholder="输入图片 URL..."
              @keyup.enter="handleAddUrl"
            />
            <button
              type="button"
              class="tc-btn primary"
              :disabled="isCheckingUrl"
              title="添加"
              @click="handleAddUrl"
            >
              <i :class="isCheckingUrl ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-check'"></i>
            </button>
          </div>

          <!-- 图库批量删除操作条 -->
          <div v-if="isGalleryBatch" class="tc-batch-bar tc-batch-wrap">
            <span class="tc-batch-count">{{ selectedGalleryIds.length }}</span>
            <button type="button" class="tc-batch-btn" title="全选" @click="selectAllGallery">
              <i class="fa-solid fa-check-double"></i>
            </button>
            <button
              type="button"
              class="tc-batch-btn tc-danger"
              title="删除选中"
              @click="confirmBatchDeleteGallery"
            >
              <i class="fa-solid fa-trash"></i>
            </button>
            <button
              type="button"
              class="tc-batch-btn tc-batch-close"
              title="取消"
              @click="toggleGalleryBatch"
            >
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>

          <!-- 图库网格 -->
          <div class="tc-gallery-grid">
            <div
              v-if="!isGalleryBatch"
              class="tc-gallery-card"
              :class="{ active: !activeOverrideId }"
              title="还原原图"
              @click="selectGalleryItem('')"
            >
              <img
                v-if="targetType === 'char' && nativeCharAvatarSrc"
                :src="nativeCharAvatarSrc"
                alt="original"
              />
              <div v-else class="tc-gallery-orig-placeholder">
                <i class="fa-solid fa-rotate-left"></i>
              </div>
              <span class="tc-gallery-badge">原图</span>
            </div>

            <div
              v-for="item in galleryList"
              :key="item.id"
              class="tc-gallery-card"
              :class="{
                active: !isGalleryBatch && activeOverrideId === item.id,
                'batch-picked': isGalleryBatch && selectedGalleryIds.includes(item.id),
              }"
              @click="handleGalleryCardClick(item.id)"
            >
              <img
                v-if="getItemSrc(item) && !brokenItemIds.has(item.id)"
                :src="getItemSrc(item)"
                :alt="item.name || 'avatar'"
                @error="markItemBroken(item.id)"
              />
              <div v-else class="tc-gallery-orig-placeholder" title="图片加载失败">
                <i
                  :class="
                    brokenItemIds.has(item.id)
                      ? 'fa-solid fa-triangle-exclamation'
                      : 'fa-regular fa-image'
                  "
                ></i>
              </div>
              <span v-if="isGalleryBatch" class="tc-gallery-chk">
                <i
                  :class="
                    selectedGalleryIds.includes(item.id)
                      ? 'fa-solid fa-square-check'
                      : 'fa-regular fa-square'
                  "
                ></i>
              </span>
              <button
                v-else
                type="button"
                class="tc-gallery-del"
                title="删除"
                @click.stop="handleRemoveGalleryItem(item)"
              >
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </div>
        </div>

        <!-- Tab 2: 样式与裁剪 -->
        <div v-if="activeTab === 'style'" class="tc-section">
          <div class="tc-row-inline">
            <label class="tc-switch-row">
              <input v-model="appStore.settings.avatar.enabled" type="checkbox" />
              <span>自定义样式</span>
            </label>
            <label class="tc-switch-row">
              <input v-model="appStore.settings.avatar.disableAvatarZoom" type="checkbox" />
              <span>禁用点击放大</span>
            </label>
            <label class="tc-switch-row">
              <input v-model="appStore.settings.avatar.enableReplaceButton" type="checkbox" />
              <span>详情页替换按钮</span>
            </label>
          </div>

          <div class="tc-grid-3" :class="{ 'tc-disabled': !appStore.settings.avatar.enabled }">
            <label class="tc-field">
              <span>宽度 {{ appStore.settings.avatar.sizePx === 0 ? '默认' : `${appStore.settings.avatar.sizePx}px` }}</span>
              <input
                v-model.number="appStore.settings.avatar.sizePx"
                type="range"
                min="0"
                max="140"
                step="2"
              />
            </label>

            <label class="tc-field">
              <span>比例</span>
              <select v-model="appStore.settings.avatar.aspectRatio" class="tc-select">
                <option value="auto">默认</option>
                <option value="1/1">1:1</option>
                <option value="3/4">3:4</option>
                <option value="2/3">2:3</option>
              </select>
            </label>

            <label class="tc-field">
              <span>圆角 {{ appStore.settings.avatar.borderRadiusPx < 0 ? '默认' : `${appStore.settings.avatar.borderRadiusPx}px` }}</span>
              <input
                v-model.number="appStore.settings.avatar.borderRadiusPx"
                type="range"
                min="-1"
                max="60"
                step="1"
              />
            </label>
          </div>

          <div class="tc-divider"></div>

          <div class="tc-section">
            <div class="tc-form-row">
              <select v-model="selectedCropKey" class="tc-select tc-flex-1">
                <option value="__global__">全局默认</option>
                <option v-for="c in characters" :key="c.avatar" :value="c.avatar">
                  {{ c.name }}
                </option>
              </select>
              <button
                type="button"
                class="tc-btn"
                :class="{ primary: isFreeCropMode }"
                title="自由裁剪"
                @click="isFreeCropMode ? (isFreeCropMode = false) : startFreeCrop()"
              >
                <i class="fa-solid fa-crop"></i>
              </button>
              <button type="button" class="tc-btn" title="重置" @click="resetCurrentCrop">
                <i class="fa-solid fa-rotate-left"></i>
              </button>
            </div>

            <!-- 交互式自由裁剪工作台 -->
            <div v-if="isFreeCropMode" class="tc-freecrop-wrap">
              <div class="tc-freecrop-stage">
                <img
                  ref="cropImgRef"
                  :src="previewSrc"
                  crossorigin="anonymous"
                  class="tc-freecrop-img"
                  alt="crop source"
                />
                <div
                  class="tc-freecrop-box"
                  :style="{
                    left: `${cropBox.x}%`,
                    top: `${cropBox.y}%`,
                    width: `${cropBox.w}%`,
                    height: `${cropBox.h}%`,
                  }"
                  @mousedown="onCropPointerDown('move', $event)"
                  @touchstart="onCropPointerDown('move', $event)"
                >
                  <div
                    class="tc-freecrop-handle"
                    @mousedown="onCropPointerDown('resize', $event)"
                    @touchstart="onCropPointerDown('resize', $event)"
                  ></div>
                </div>
              </div>
              <div class="tc-row-inline">
                <button type="button" class="tc-btn primary tc-flex-1" @click="saveVisualCrop">
                  <i class="fa-solid fa-eye"></i>
                  <span>视觉裁剪</span>
                </button>
                <button type="button" class="tc-btn tc-flex-1" @click="saveCanvasCrop">
                  <i class="fa-solid fa-scissors"></i>
                  <span>实体裁剪</span>
                </button>
                <button type="button" class="tc-btn" title="取消" @click="isFreeCropMode = false">
                  <i class="fa-solid fa-xmark"></i>
                </button>
              </div>
            </div>

            <!-- 常规滑块微调工作台 -->
            <div
              v-else
              class="tc-crop-workbench"
              :class="{ 'tc-disabled': !appStore.settings.avatar.enabled }"
            >
              <div class="tc-crop-preview-box" :style="previewBoxStyle">
                <img v-if="previewSrc" :src="previewSrc" :style="previewImgStyle" alt="preview" />
                <div v-else class="tc-crop-placeholder">
                  <i class="fa-regular fa-user"></i>
                </div>
              </div>

              <div class="tc-crop-sliders">
                <label class="tc-field">
                  <span>水平 {{ currentCrop.posX }}%</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    :value="currentCrop.posX"
                    @input="updateCrop({ posX: Number(($event.target as HTMLInputElement).value) })"
                  />
                </label>
                <label class="tc-field">
                  <span>垂直 {{ currentCrop.posY }}%</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    :value="currentCrop.posY"
                    @input="updateCrop({ posY: Number(($event.target as HTMLInputElement).value) })"
                  />
                </label>
                <label class="tc-field">
                  <span>缩放 {{ currentCrop.scale.toFixed(2) }}x</span>
                  <input
                    type="range"
                    min="1"
                    max="2.5"
                    step="0.05"
                    :value="currentCrop.scale"
                    @input="updateCrop({ scale: Number(($event.target as HTMLInputElement).value) })"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
