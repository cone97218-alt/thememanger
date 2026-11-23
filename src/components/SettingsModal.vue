<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  addDayNightPair,
  appStore,
  createTag,
  deleteTag,
  getFlattenedTagTree,
  getTagThemeCount,
  removeDayNightPair,
  setCharacterThemeBinding,
  setThemeBackgroundBinding,
  syncThemesWithDisk,
} from '../store/appStore';
import { getCharacters, type CharacterBrief } from '../bridge/st-api';
import { showToast } from '../bridge/host';
import { evaluateAutoTheme } from '../features/autoTheme';
import { hasLegacyData, migrateLegacyDataInto } from '../bridge/legacy-migration';
import { startBackgroundBinding } from '../features/bgBinding';

const activeTab = ref<'auto' | 'bindings' | 'tags' | 'sync'>('auto');

// 日夜配对表单
const newDayTheme = ref('');
const newNightTheme = ref('');

// 背景与角色绑定
const characters = ref<CharacterBrief[]>([]);
const bindThemeName = ref('');
const bindCharAvatar = ref('');
const bindCharTarget = ref('');

// 层级标签管理
const newTagName = ref('');
const newTagParentId = ref<string>('');

// 旧版迁移
const legacyAvailable = ref(false);

const flattenedTags = computed(() => getFlattenedTagTree());

watch(
  () => appStore.showSettingsModal,
  (open) => {
    if (open) {
      legacyAvailable.value = hasLegacyData();
      characters.value = getCharacters();
      if (!bindThemeName.value && appStore.activeTheme) {
        bindThemeName.value = appStore.activeTheme;
      }
    }
  },
  { immediate: true },
);

function close() {
  appStore.showSettingsModal = false;
}

function handleAddPair() {
  if (!newDayTheme.value && !newNightTheme.value) {
    showToast('warning', '请选择美化');
    return;
  }
  addDayNightPair(newDayTheme.value, newNightTheme.value);
  newDayTheme.value = '';
  newNightTheme.value = '';
  showToast('success', '已添加配对');
}

function handlePickBackgroundFromDrawer() {
  if (!bindThemeName.value) {
    showToast('warning', '请先选择美化');
    return;
  }
  startBackgroundBinding(bindThemeName.value);
}

function handleSaveCharBinding() {
  if (!bindCharAvatar.value || !bindCharTarget.value) {
    showToast('warning', '请选择角色与美化');
    return;
  }
  setCharacterThemeBinding(bindCharAvatar.value, bindCharTarget.value);
  showToast('success', '已保存绑定');
}

function getCharDisplayName(avatar: string): string {
  const found = characters.value.find((c) => c.avatar === avatar);
  return found ? found.name : avatar;
}

function getTargetLabel(target: string): string {
  if (target.startsWith('[Tag] ')) {
    const id = target.slice(6);
    const tag = appStore.settings.tags.find((t) => t.id === id);
    return tag ? tag.name : target;
  }
  return target;
}

function handleAddTag() {
  if (!newTagName.value.trim()) return;
  createTag(newTagName.value, newTagParentId.value || null);
  newTagName.value = '';
}

function handleLegacyMigration() {
  const summary = migrateLegacyDataInto(appStore.settings);
  const parts = [
    `收藏 ${summary.favoritesCount}`,
    `标签 ${summary.tagsCount}`,
    `背景 ${summary.bgBindingsCount}`,
    `角色 ${summary.charBindingsCount}`,
    `配对 ${summary.pairsCount}`,
  ];
  showToast('success', `迁移完成：${parts.join(' / ')}`);
}
</script>

<template>
  <div v-if="appStore.showSettingsModal" class="tc-modal-mask" @click.self="close">
      <div class="tc-modal">
        <div class="tc-modal-header">
          <div class="tc-modal-title">
            <i class="fa-solid fa-gear"></i>
            <span>美化管理</span>
          </div>
          <button type="button" class="tc-icon-btn" title="关闭" @click="close">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div class="tc-tabs">
          <button
            type="button"
            class="tc-tab"
            :class="{ active: activeTab === 'auto' }"
            @click="activeTab = 'auto'"
          >
            <i class="fa-solid fa-circle-half-stroke"></i>
            <span>日夜</span>
          </button>
          <button
            type="button"
            class="tc-tab"
            :class="{ active: activeTab === 'bindings' }"
            @click="activeTab = 'bindings'"
          >
            <i class="fa-solid fa-link"></i>
            <span>绑定</span>
          </button>
          <button
            type="button"
            class="tc-tab"
            :class="{ active: activeTab === 'tags' }"
            @click="activeTab = 'tags'"
          >
            <i class="fa-solid fa-tags"></i>
            <span>标签</span>
          </button>
          <button
            type="button"
            class="tc-tab"
            :class="{ active: activeTab === 'sync' }"
            @click="activeTab = 'sync'"
          >
            <i class="fa-solid fa-rotate"></i>
            <span>同步</span>
          </button>
        </div>

        <div class="tc-modal-body">
          <!-- Tab 1: 日夜切换 -->
          <div v-if="activeTab === 'auto'" class="tc-section">
            <div class="tc-row-between">
              <label class="tc-switch-row">
                <input v-model="appStore.settings.autoTheme.enabled" type="checkbox" />
                <span>自动日夜切换</span>
              </label>
              <button type="button" class="tc-btn" title="立即执行" @click="evaluateAutoTheme(true)">
                <i class="fa-solid fa-play"></i>
              </button>
            </div>

            <div class="tc-grid-2">
              <label class="tc-field">
                <span>触发方式</span>
                <select v-model="appStore.settings.autoTheme.mode" class="tc-select">
                  <option value="system">跟随系统</option>
                  <option value="time">定时切换</option>
                </select>
              </label>
              <div v-if="appStore.settings.autoTheme.mode === 'time'" class="tc-grid-2">
                <label class="tc-field">
                  <span>日间</span>
                  <input v-model="appStore.settings.autoTheme.dayStart" type="time" class="tc-input" />
                </label>
                <label class="tc-field">
                  <span>夜间</span>
                  <input v-model="appStore.settings.autoTheme.nightStart" type="time" class="tc-input" />
                </label>
              </div>
            </div>

            <div class="tc-grid-2">
              <label class="tc-field">
                <span>日间美化</span>
                <select v-model="appStore.settings.autoTheme.dayTarget" class="tc-select">
                  <option value="">不指定</option>
                  <optgroup v-if="flattenedTags.length > 0" label="标签随机">
                    <option
                      v-for="node in flattenedTags"
                      :key="node.tag.id"
                      :value="`[Tag] ${node.tag.id}`"
                    >
                      {{ '　'.repeat(node.depth) }}{{ node.tag.name }}
                    </option>
                  </optgroup>
                  <optgroup label="美化">
                    <option v-for="t in appStore.themes" :key="t.name" :value="t.name">{{ t.name }}</option>
                  </optgroup>
                </select>
              </label>
              <label class="tc-field">
                <span>夜间美化</span>
                <select v-model="appStore.settings.autoTheme.nightTarget" class="tc-select">
                  <option value="">不指定</option>
                  <optgroup v-if="flattenedTags.length > 0" label="标签随机">
                    <option
                      v-for="node in flattenedTags"
                      :key="node.tag.id"
                      :value="`[Tag] ${node.tag.id}`"
                    >
                      {{ '　'.repeat(node.depth) }}{{ node.tag.name }}
                    </option>
                  </optgroup>
                  <optgroup label="美化">
                    <option v-for="t in appStore.themes" :key="t.name" :value="t.name">{{ t.name }}</option>
                  </optgroup>
                </select>
              </label>
            </div>

            <div class="tc-divider"></div>
            <div class="tc-subtitle">日夜配对</div>
            <div class="tc-form-row">
              <select v-model="newDayTheme" class="tc-select tc-flex-1">
                <option value="">日间美化</option>
                <option v-for="t in appStore.themes" :key="t.name" :value="t.name">{{ t.name }}</option>
              </select>
              <select v-model="newNightTheme" class="tc-select tc-flex-1">
                <option value="">夜间美化</option>
                <option v-for="t in appStore.themes" :key="t.name" :value="t.name">{{ t.name }}</option>
              </select>
              <button type="button" class="tc-btn primary" title="添加" @click="handleAddPair">
                <i class="fa-solid fa-plus"></i>
              </button>
            </div>

            <div class="tc-list-box">
              <div v-if="appStore.settings.dayNightPairs.length === 0" class="tc-muted">暂无配对</div>
              <div v-for="p in appStore.settings.dayNightPairs" :key="p.id" class="tc-kv-row">
                <span class="tc-kv-label">
                  <i class="fa-solid fa-sun tc-kv-icon"></i>
                  <span class="tc-truncate">{{ p.dayTheme || '未设' }}</span>
                  <i class="fa-solid fa-right-left tc-kv-sep"></i>
                  <i class="fa-solid fa-moon tc-kv-icon"></i>
                  <span class="tc-truncate">{{ p.nightTheme || '未设' }}</span>
                </span>
                <button
                  type="button"
                  class="tc-row-btn tc-danger"
                  title="删除"
                  @click="removeDayNightPair(p.id)"
                >
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
            </div>
          </div>

          <!-- Tab 2: 背景与角色绑定 -->
          <div v-if="activeTab === 'bindings'" class="tc-section">
            <div class="tc-subtitle">背景图绑定</div>
            <div class="tc-form-row">
              <select v-model="bindThemeName" class="tc-select tc-flex-1">
                <option value="">选择美化</option>
                <option v-for="t in appStore.themes" :key="t.name" :value="t.name">{{ t.name }}</option>
              </select>
              <button
                type="button"
                class="tc-btn primary"
                title="前往背景图抽屉选择"
                @click="handlePickBackgroundFromDrawer"
              >
                <i class="fa-solid fa-image"></i>
                <span>选择背景</span>
              </button>
            </div>
            <div class="tc-list-box">
              <div
                v-if="Object.keys(appStore.settings.backgroundBindings).length === 0"
                class="tc-muted"
              >
                暂无绑定
              </div>
              <div
                v-for="(bg, themeName) in appStore.settings.backgroundBindings"
                :key="themeName"
                class="tc-kv-row"
              >
                <span class="tc-kv-label">
                  <i class="fa-solid fa-palette tc-kv-icon"></i>
                  <span class="tc-truncate">{{ themeName }}</span>
                  <i class="fa-solid fa-arrow-right tc-kv-sep"></i>
                  <i class="fa-regular fa-image tc-kv-icon"></i>
                  <span class="tc-truncate">{{ bg }}</span>
                </span>
                <button
                  type="button"
                  class="tc-row-btn tc-danger"
                  title="解绑"
                  @click="setThemeBackgroundBinding(String(themeName), '')"
                >
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
            </div>

            <div class="tc-divider"></div>
            <div class="tc-subtitle">角色绑定</div>
            <div class="tc-form-row">
              <select v-model="bindCharAvatar" class="tc-select tc-flex-1">
                <option value="">选择角色</option>
                <option v-for="c in characters" :key="c.avatar" :value="c.avatar">{{ c.name }}</option>
              </select>
              <select v-model="bindCharTarget" class="tc-select tc-flex-1">
                <option value="">选择美化</option>
                <optgroup v-if="flattenedTags.length > 0" label="标签随机">
                  <option
                    v-for="node in flattenedTags"
                    :key="node.tag.id"
                    :value="`[Tag] ${node.tag.id}`"
                  >
                    {{ '　'.repeat(node.depth) }}{{ node.tag.name }}
                  </option>
                </optgroup>
                <optgroup label="美化">
                  <option v-for="t in appStore.themes" :key="t.name" :value="t.name">{{ t.name }}</option>
                </optgroup>
              </select>
              <button type="button" class="tc-btn primary" title="绑定" @click="handleSaveCharBinding">
                <i class="fa-solid fa-plus"></i>
              </button>
            </div>
            <div class="tc-list-box">
              <div
                v-if="Object.keys(appStore.settings.characterBindings).length === 0"
                class="tc-muted"
              >
                暂无绑定
              </div>
              <div
                v-for="(target, avatar) in appStore.settings.characterBindings"
                :key="avatar"
                class="tc-kv-row"
              >
                <span class="tc-kv-label">
                  <i class="fa-solid fa-user tc-kv-icon"></i>
                  <span class="tc-truncate">{{ getCharDisplayName(String(avatar)) }}</span>
                  <i class="fa-solid fa-arrow-right tc-kv-sep"></i>
                  <i class="fa-solid fa-palette tc-kv-icon"></i>
                  <span class="tc-truncate">{{ getTargetLabel(target) }}</span>
                </span>
                <button
                  type="button"
                  class="tc-row-btn tc-danger"
                  title="解绑"
                  @click="setCharacterThemeBinding(String(avatar), '')"
                >
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
            </div>
          </div>

          <!-- Tab 3: N 级标签管理 -->
          <div v-if="activeTab === 'tags'" class="tc-section">
            <div class="tc-subtitle">标签层级</div>
            <div class="tc-form-row">
              <select v-model="newTagParentId" class="tc-select tc-flex-1">
                <option value="">顶级分类</option>
                <option v-for="node in flattenedTags" :key="node.tag.id" :value="node.tag.id">
                  {{ '　'.repeat(node.depth) }}{{ node.tag.name }}
                </option>
              </select>
              <input
                v-model="newTagName"
                type="text"
                class="tc-input tc-flex-1"
                placeholder="标签名称"
                @keyup.enter="handleAddTag"
              />
              <button type="button" class="tc-btn primary" title="新建" @click="handleAddTag">
                <i class="fa-solid fa-plus"></i>
              </button>
            </div>
            <div class="tc-list-box tc-list-tall">
              <div v-if="flattenedTags.length === 0" class="tc-muted">暂无标签</div>
              <div
                v-for="node in flattenedTags"
                :key="node.tag.id"
                class="tc-kv-row"
                :style="{ paddingLeft: `${8 + node.depth * 16}px` }"
              >
                <span class="tc-kv-label">
                  <i
                    :class="node.hasChildren ? 'fa-solid fa-folder' : 'fa-solid fa-tag'"
                    class="tc-kv-icon"
                  ></i>
                  <span class="tc-truncate">{{ node.tag.name }}</span>
                  <span class="tc-tag-num">{{ getTagThemeCount(node.tag.id) }}</span>
                </span>
                <button
                  type="button"
                  class="tc-row-btn tc-danger"
                  title="删除"
                  @click="deleteTag(node.tag.id)"
                >
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
            </div>
          </div>

          <!-- Tab 4: 同步与迁移 -->
          <div v-if="activeTab === 'sync'" class="tc-section">
            <label class="tc-switch-row">
              <input v-model="appStore.settings.autoSyncOnFocus" type="checkbox" />
              <span>切回窗口自动同步</span>
            </label>

            <div class="tc-row-inline">
              <button
                type="button"
                class="tc-btn"
                :disabled="appStore.isSyncing"
                @click="syncThemesWithDisk({ silent: false })"
              >
                <i class="fa-solid fa-rotate"></i>
                <span>立即同步</span>
              </button>
              <button type="button" class="tc-btn primary" @click="handleLegacyMigration">
                <i class="fa-solid fa-download"></i>
                <span>{{ legacyAvailable ? '迁移旧版数据' : '导入旧版数据' }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
</template>
