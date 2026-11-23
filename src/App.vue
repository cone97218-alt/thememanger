<script setup lang="ts">
import { computed } from 'vue';
import ThemePanel from './components/ThemePanel.vue';
import SettingsModal from './components/SettingsModal.vue';
import AvatarManagerModal from './components/AvatarManagerModal.vue';
import { appStore } from './store/appStore';
import { getMainDoc } from './bridge/host';
import { cancelBackgroundBinding } from './features/bgBinding';

const teleportTarget = computed(() => getMainDoc().body);
</script>

<template>
  <ThemePanel />
  <SettingsModal />
  <AvatarManagerModal />

  <Teleport :to="teleportTarget">
    <div v-if="appStore.bgBindingTheme" id="tc-bg-binding-banner" class="tc-binding-banner">
      <i class="fa-solid fa-image"></i>
      <span class="tc-binding-banner-text">点击背景图绑定至「{{ appStore.bgBindingTheme }}」</span>
      <button type="button" class="tc-icon-btn" title="取消" @click="cancelBackgroundBinding">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
  </Teleport>
</template>
