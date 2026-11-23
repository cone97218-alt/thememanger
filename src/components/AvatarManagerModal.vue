<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { appStore } from '../store/appStore';
import { getCharacters, getCurrentCharacter, type CharacterBrief } from '../bridge/st-api';
import { getMainDoc, showToast } from '../bridge/host';
import { triggerReplaceCharacterAvatar, triggerReplaceUserAvatar } from '../features/avatarStyle';
import type { AvatarCropRule } from '../types';

const teleportTarget = computed(() => getMainDoc().body);
const characters = ref<CharacterBrief[]>([]);
/** '__global__' 表示全局默认裁剪，否则为角色头像文件名 */
const selectedAvatarKey = ref<string>('__global__');

onMounted(() => {
  characters.value = getCharacters();
  const cur = getCurrentCharacter();
  if (cur?.avatar) {
    selectedAvatarKey.value = cur.avatar;
  }
});

const currentCrop = computed<AvatarCropRule>(() => {
  const cfg = appStore.settings.avatar;
  if (selectedAvatarKey.value === '__global__') {
    return cfg.defaultCrop;
  }
  return cfg.perCharacterCrop[selectedAvatarKey.value] || { ...cfg.defaultCrop };
});

const previewSrc = computed(() => {
  if (selectedAvatarKey.value === '__global__') {
    const cur = getCurrentCharacter();
    return cur?.avatar ? `/characters/${encodeURIComponent(cur.avatar)}` : '';
  }
  return `/characters/${encodeURIComponent(selectedAvatarKey.value)}`;
});

const previewImgStyle = computed(() => ({
  objectPosition: `${currentCrop.value.posX}% ${currentCrop.value.posY}%`,
  transformOrigin: `${currentCrop.value.posX}% ${currentCrop.value.posY}%`,
  transform: `scale(${currentCrop.value.scale})`,
}));

const previewBoxStyle = computed(() => {
  const cfg = appStore.settings.avatar;
  const w = cfg.sizePx > 0 ? Math.min(Math.max(cfg.sizePx, 48), 160) : 96;
  return {
    width: `${w}px`,
    aspectRatio: cfg.aspectRatio === 'auto' ? '1 / 1' : cfg.aspectRatio.replace('/', ' / '),
    borderRadius: cfg.borderRadiusPx >= 0 ? `${cfg.borderRadiusPx}px` : '12px',
  };
});

function updateCrop(patch: Partial<AvatarCropRule>) {
  const cfg = appStore.settings.avatar;
  if (selectedAvatarKey.value === '__global__') {
    cfg.defaultCrop = { ...cfg.defaultCrop, ...patch };
  } else {
    const prev = cfg.perCharacterCrop[selectedAvatarKey.value] || { ...cfg.defaultCrop };
    cfg.perCharacterCrop[selectedAvatarKey.value] = { ...prev, ...patch };
  }
}

function resetCurrentCrop() {
  const cfg = appStore.settings.avatar;
  if (selectedAvatarKey.value === '__global__') {
    cfg.defaultCrop = { posX: 50, posY: 25, scale: 1 };
    showToast('info', '已重置全局头像裁剪位置');
  } else {
    delete cfg.perCharacterCrop[selectedAvatarKey.value];
    showToast('info', '已恢复该角色跟随全局默认裁剪');
  }
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
            <span>精简头像管理</span>
          </div>
          <button type="button" class="tc-icon-btn" @click="close">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div class="tc-modal-body">
          <!-- 1. 快捷替换角色 / 用户头像 -->
          <div class="tc-section">
            <div class="tc-subtitle">快捷替换头像</div>
            <div class="tc-row-inline">
              <button type="button" class="tc-btn primary" @click="triggerReplaceCharacterAvatar">
                <i class="fa-solid fa-file-image"></i> 替换当前角色卡头像
              </button>
              <button type="button" class="tc-btn" @click="triggerReplaceUserAvatar">
                <i class="fa-solid fa-user-circle"></i> 替换当前用户头像
              </button>
            </div>
            <label class="tc-switch-row">
              <input v-model="appStore.settings.avatar.enableReplaceButton" type="checkbox" />
              <span>在角色卡 / 用户详情页底部注入快捷替换头像按钮</span>
            </label>
          </div>

          <div class="tc-divider"></div>

          <!-- 2. 头像大小与比例 -->
          <div class="tc-section">
            <label class="tc-switch-row">
              <input v-model="appStore.settings.avatar.enabled" type="checkbox" />
              <span>启用自定义头像大小与裁剪位置</span>
            </label>

            <div class="tc-grid-3" :class="{ 'tc-disabled': !appStore.settings.avatar.enabled }">
              <label class="tc-field">
                <span>头像宽度：{{ appStore.settings.avatar.sizePx === 0 ? '跟随主题' : `${appStore.settings.avatar.sizePx}px` }}</span>
                <input
                  v-model.number="appStore.settings.avatar.sizePx"
                  type="range"
                  min="0"
                  max="140"
                  step="2"
                />
              </label>

              <label class="tc-field">
                <span>宽高比</span>
                <select v-model="appStore.settings.avatar.aspectRatio" class="tc-select">
                  <option value="auto">跟随主题默认</option>
                  <option value="1/1">1:1 方形</option>
                  <option value="3/4">3:4 竖版</option>
                  <option value="2/3">2:3 立绘竖版</option>
                </select>
              </label>

              <label class="tc-field">
                <span>圆角：{{ appStore.settings.avatar.borderRadiusPx < 0 ? '跟随主题' : `${appStore.settings.avatar.borderRadiusPx}px` }}</span>
                <input
                  v-model.number="appStore.settings.avatar.borderRadiusPx"
                  type="range"
                  min="-1"
                  max="60"
                  step="1"
                />
              </label>
            </div>
          </div>

          <div class="tc-divider"></div>

          <!-- 3. 角色头像位置裁剪 -->
          <div class="tc-section" :class="{ 'tc-disabled': !appStore.settings.avatar.enabled }">
            <div class="tc-subtitle">头像位置与缩放裁剪</div>
            <div class="tc-row-inline">
              <select v-model="selectedAvatarKey" class="tc-select" style="flex: 1">
                <option value="__global__">🌐 全局默认裁剪（所有未单独设置的角色）</option>
                <option v-for="c in characters" :key="c.avatar" :value="c.avatar">
                  👤 {{ c.name }}{{ appStore.settings.avatar.perCharacterCrop[c.avatar] ? '（已单独裁剪）' : '' }}
                </option>
              </select>
              <button type="button" class="tc-btn" @click="resetCurrentCrop">重置</button>
            </div>

            <div class="tc-crop-workbench">
              <div class="tc-crop-preview-box" :style="previewBoxStyle">
                <img v-if="previewSrc" :src="previewSrc" :style="previewImgStyle" alt="avatar preview" />
                <div v-else class="tc-crop-placeholder">
                  <i class="fa-regular fa-user"></i>
                </div>
              </div>

              <div class="tc-crop-sliders">
                <label class="tc-field">
                  <span>水平位置 (X)：{{ currentCrop.posX }}%</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    :value="currentCrop.posX"
                    @input="updateCrop({ posX: Number(($event.target as HTMLInputElement).value) })"
                  />
                </label>
                <label class="tc-field">
                  <span>垂直位置 (Y)：{{ currentCrop.posY }}%</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    :value="currentCrop.posY"
                    @input="updateCrop({ posY: Number(($event.target as HTMLInputElement).value) })"
                  />
                </label>
                <label class="tc-field">
                  <span>画面缩放：{{ currentCrop.scale.toFixed(2) }}x</span>
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
  </Teleport>
</template>
