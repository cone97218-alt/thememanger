<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { appStore } from '../store/appStore';
import { getCharacters, getCurrentCharacter, type CharacterBrief } from '../bridge/st-api';
import { getMainDoc, showToast } from '../bridge/host';
import { triggerReplaceCharacterAvatar, triggerReplaceUserAvatar } from '../features/avatarStyle';
import {
  deleteGalleryImageBlob,
  resolveGalleryItemUrl,
  resolveOverrideUrl,
  saveGalleryImageBlob,
} from '../features/avatarGallery';
import type { AvatarCropRule, AvatarGalleryItem } from '../types';

const teleportTarget = computed(() => getMainDoc().body);
const activeTab = ref<'gallery' | 'style'>('gallery');
const targetType = ref<'char' | 'user'>('char');

const characters = ref<CharacterBrief[]>([]);
const selectedCharAvatar = ref<string>('');
const selectedCropKey = ref<string>('__global__');

const showUrlBar = ref(false);
const urlInput = ref('');
const galleryFileInput = ref<HTMLInputElement | null>(null);

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
    }
  },
  { immediate: true },
);

const activeGalleryKey = computed(() =>
  targetType.value === 'user' ? '__user__' : selectedCharAvatar.value,
);

const galleryList = computed<AvatarGalleryItem[]>(() => {
  // 依赖 galleryCacheVersion 以响应 Blob URL 加载完成
  void appStore.galleryCacheVersion;
  if (targetType.value === 'user') {
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
  const key = selectedCropKey.value === '__global__' ? selectedCharAvatar.value : selectedCropKey.value;
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

function selectGalleryItem(itemId: string) {
  const key = activeGalleryKey.value;
  if (!key) return;
  if (!itemId) {
    delete appStore.settings.avatar.avatarOverrides[key];
  } else {
    appStore.settings.avatar.avatarOverrides[key] = itemId;
  }
}

function triggerUpload() {
  galleryFileInput.value?.click();
}

async function handleGalleryUpload(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  input.value = '';
  if (files.length === 0) return;

  const key = activeGalleryKey.value;
  if (!key) {
    showToast('warning', '请先选择角色');
    return;
  }

  let added = 0;
  for (const file of files) {
    try {
      const item = await saveGalleryImageBlob(file, file.name);
      if (targetType.value === 'user') {
        appStore.settings.avatar.userGallery.unshift(item);
      } else {
        if (!appStore.settings.avatar.perCharacterGallery[key]) {
          appStore.settings.avatar.perCharacterGallery[key] = [];
        }
        appStore.settings.avatar.perCharacterGallery[key].unshift(item);
      }
      added++;
    } catch (err: any) {
      showToast('error', `上传失败：${err?.message || err}`);
    }
  }
  if (added > 0) {
    showToast('success', `已添加 ${added} 张`);
  }
}

function handleAddUrl() {
  const clean = urlInput.value.trim();
  if (!clean) return;
  const key = activeGalleryKey.value;
  if (!key) {
    showToast('warning', '请先选择角色');
    return;
  }
  const item: AvatarGalleryItem = {
    id: `url_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    source: 'url',
    url: clean,
  };
  if (targetType.value === 'user') {
    appStore.settings.avatar.userGallery.unshift(item);
  } else {
    if (!appStore.settings.avatar.perCharacterGallery[key]) {
      appStore.settings.avatar.perCharacterGallery[key] = [];
    }
    appStore.settings.avatar.perCharacterGallery[key].unshift(item);
  }
  urlInput.value = '';
  showUrlBar.value = false;
}

async function handleRemoveGalleryItem(item: AvatarGalleryItem) {
  const key = activeGalleryKey.value;
  if (!key) return;

  if (appStore.settings.avatar.avatarOverrides[key] === item.id) {
    delete appStore.settings.avatar.avatarOverrides[key];
  }

  if (targetType.value === 'user') {
    appStore.settings.avatar.userGallery = appStore.settings.avatar.userGallery.filter(
      (i) => i.id !== item.id,
    );
  } else if (appStore.settings.avatar.perCharacterGallery[key]) {
    appStore.settings.avatar.perCharacterGallery[key] = appStore.settings.avatar.perCharacterGallery[
      key
    ].filter((i) => i.id !== item.id);
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
    cfg.defaultCrop = { posX: 50, posY: 25, scale: 1 };
  } else {
    delete cfg.perCharacterCrop[selectedCropKey.value];
  }
  showToast('info', '已重置');
}

function close() {
  appStore.showAvatarModal = false;
}
</script>

<template>
  <Teleport :to="teleportTarget">
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

              <div class="tc-row-inline">
                <button type="button" class="tc-tool-btn" title="上传图片" @click="triggerUpload">
                  <i class="fa-solid fa-upload"></i>
                </button>
                <button
                  type="button"
                  class="tc-tool-btn"
                  :class="{ active: showUrlBar }"
                  title="添加图片链接"
                  @click="showUrlBar = !showUrlBar"
                >
                  <i class="fa-solid fa-link"></i>
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
              v-if="targetType === 'char'"
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
              <button type="button" class="tc-btn primary" title="添加" @click="handleAddUrl">
                <i class="fa-solid fa-check"></i>
              </button>
            </div>

            <!-- 图库网格 -->
            <div class="tc-gallery-grid">
              <!-- 原图卡片 -->
              <div
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

              <!-- 图库图片 -->
              <div
                v-for="item in galleryList"
                :key="item.id"
                class="tc-gallery-card"
                :class="{ active: activeOverrideId === item.id }"
                @click="selectGalleryItem(item.id)"
              >
                <img v-if="getItemSrc(item)" :src="getItemSrc(item)" :alt="item.name || 'avatar'" />
                <div v-else class="tc-gallery-orig-placeholder">
                  <i class="fa-regular fa-image"></i>
                </div>
                <button
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
            <div class="tc-row-between tc-wrap">
              <label class="tc-switch-row">
                <input v-model="appStore.settings.avatar.enabled" type="checkbox" />
                <span>启用自定义样式与裁剪</span>
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

            <div class="tc-section" :class="{ 'tc-disabled': !appStore.settings.avatar.enabled }">
              <div class="tc-form-row">
                <select v-model="selectedCropKey" class="tc-select tc-flex-1">
                  <option value="__global__">全局默认</option>
                  <option v-for="c in characters" :key="c.avatar" :value="c.avatar">
                    {{ c.name }}
                  </option>
                </select>
                <button type="button" class="tc-btn" title="重置" @click="resetCurrentCrop">
                  <i class="fa-solid fa-rotate-left"></i>
                </button>
              </div>

              <div class="tc-crop-workbench">
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
  </Teleport>
</template>
