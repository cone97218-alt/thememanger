<script setup lang="ts">
import SettingsModal from './components/SettingsModal.vue';
import AvatarManagerModal from './components/AvatarManagerModal.vue';
import { appStore } from './store/appStore';
import { cancelBackgroundBinding } from './features/bgBinding';
</script>

<template>
  <SettingsModal />
  <AvatarManagerModal />

  <div v-if="appStore.bgBindingTheme" id="tc-bg-binding-banner" class="tc-binding-banner">
    <i class="fa-solid fa-image"></i>
    <span class="tc-binding-banner-text">点击背景图绑定至「{{ appStore.bgBindingTheme }}」</span>
    <button type="button" class="tc-icon-btn" title="取消" @click="cancelBackgroundBinding">
      <i class="fa-solid fa-xmark"></i>
    </button>
  </div>
</template>
