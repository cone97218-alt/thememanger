<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  addDayNightPair,
  appStore,
  createTag,
  deleteTag,
  removeDayNightPair,
  setCharacterThemeBinding,
  setThemeBackgroundBinding,
  syncThemesWithDisk,
} from '../store/appStore';
import { fetchBackgroundList, getCharacters, type CharacterBrief } from '../bridge/st-api';
import { getMainDoc, showToast } from '../bridge/host';
import { evaluateAutoTheme } from '../features/autoTheme';
import { hasLegacyData, migrateLegacyDataInto } from '../bridge/legacy-migration';

const activeTab = ref<'auto' | 'bindings' | 'tags' | 'sync'>('auto');
const teleportTarget = computed(() => getMainDoc().body);

// 日夜配对表单
const newDayTheme = ref('');
const newNightTheme = ref('');

// 背景与角色绑定
const backgrounds = ref<string[]>([]);
const characters = ref<CharacterBrief[]>([]);
const bindThemeName = ref('');
const bindBgFile = ref('');
const bindCharAvatar = ref('');
const bindCharTarget = ref('');

// 标签管理
const newTagName = ref('');

// 旧版迁移
const legacyAvailable = ref(false);

onMounted(async () => {
  legacyAvailable.value = hasLegacyData();
  characters.value = getCharacters();
  backgrounds.value = await fetchBackgroundList();
  if (!bindThemeName.value && appStore.activeTheme) {
    bindThemeName.value = appStore.activeTheme;
  }
});

function close() {
  appStore.showSettingsModal = false;
}

function handleAddPair() {
  if (!newDayTheme.value && !newNightTheme.value) {
    showToast('warning', '请至少选择一个日间或夜间美化');
    return;
  }
  addDayNightPair(newDayTheme.value, newNightTheme.value);
  newDayTheme.value = '';
  newNightTheme.value = '';
  showToast('success', '已添加日夜配对');
}

function handleSaveBgBinding() {
  if (!bindThemeName.value || !bindBgFile.value) {
    showToast('warning', '请选择美化和背景图');
    return;
  }
  setThemeBackgroundBinding(bindThemeName.value, bindBgFile.value);
  showToast('success', `已绑定：${bindThemeName.value} → ${bindBgFile.value}`);
}

function handleSaveCharBinding() {
  if (!bindCharAvatar.value || !bindCharTarget.value) {
    showToast('warning', '请选择角色和目标美化');
    return;
  }
  setCharacterThemeBinding(bindCharAvatar.value, bindCharTarget.value);
  showToast('success', '角色美化绑定已保存');
}

function getCharDisplayName(avatar: string): string {
  const found = characters.value.find((c) => c.avatar === avatar);
  return found ? found.name : avatar;
}

function getTargetLabel(target: string): string {
  if (target.startsWith('[Tag] ')) {
    const id = target.slice(6);
    const tag = appStore.settings.tags.find((t) => t.id === id);
    return tag ? `标签随机：${tag.name}` : target;
  }
  return target;
}

function handleAddTag() {
  if (!newTagName.value.trim()) return;
  createTag(newTagName.value);
  newTagName.value = '';
}

function handleLegacyMigration() {
  const summary = migrateLegacyDataInto(appStore.settings);
  const parts = [
    `收藏 ${summary.favoritesCount}`,
    `标签 ${summary.tagsCount}`,
    `背景绑定 ${summary.bgBindingsCount}`,
    `角色绑定 ${summary.charBindingsCount}`,
    `日夜配对 ${summary.pairsCount}`,
  ];
  showToast('success', `迁移完成：${parts.join(' / ')}`);
}
</script>

<template>
  <Teleport :to="teleportTarget">
    <div v-if="appStore.showSettingsModal" class="tc-modal-mask" @click.self="close">
      <div class="tc-modal">
        <div class="tc-modal-header">
          <div class="tc-modal-title">
            <i class="fa-solid fa-sliders"></i>
            <span>美化管理伴侣 · 设置</span>
          </div>
          <button type="button" class="tc-icon-btn" @click="close">
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
            日夜切换
          </button>
          <button
            type="button"
            class="tc-tab"
            :class="{ active: activeTab === 'bindings' }"
            @click="activeTab = 'bindings'"
          >
            背景 / 角色绑定
          </button>
          <button
            type="button"
            class="tc-tab"
            :class="{ active: activeTab === 'tags' }"
            @click="activeTab = 'tags'"
          >
            标签管理
          </button>
          <button
            type="button"
            class="tc-tab"
            :class="{ active: activeTab === 'sync' }"
            @click="activeTab = 'sync'"
          >
            同步与迁移
          </button>
        </div>

        <div class="tc-modal-body">
          <!-- Tab 1: 日夜自动切换与配对 -->
          <div v-if="activeTab === 'auto'" class="tc-section">
            <label class="tc-switch-row">
              <input v-model="appStore.settings.autoTheme.enabled" type="checkbox" />
              <span>启用自动日夜间美化切换</span>
            </label>

            <div class="tc-grid-2">
              <label class="tc-field">
                <span>触发方式</span>
                <select v-model="appStore.settings.autoTheme.mode" class="tc-select">
                  <option value="system">跟随系统深浅色</option>
                  <option value="time">按时间段切换</option>
                </select>
              </label>
              <div class="tc-field" style="justify-content: flex-end">
                <button type="button" class="tc-btn" @click="evaluateAutoTheme(true)">
                  立即执行一次判定
                </button>
              </div>
            </div>

            <div v-if="appStore.settings.autoTheme.mode === 'time'" class="tc-grid-2">
              <label class="tc-field">
                <span>日间开始时间</span>
                <input v-model="appStore.settings.autoTheme.dayStart" type="time" class="tc-input" />
              </label>
              <label class="tc-field">
                <span>夜间开始时间</span>
                <input v-model="appStore.settings.autoTheme.nightStart" type="time" class="tc-input" />
              </label>
            </div>

            <div class="tc-grid-2">
              <label class="tc-field">
                <span>默认日间美化</span>
                <select v-model="appStore.settings.autoTheme.dayTarget" class="tc-select">
                  <option value="">-- 不指定 --</option>
                  <optgroup v-if="appStore.settings.tags.length > 0" label="按标签随机">
                    <option v-for="tag in appStore.settings.tags" :key="tag.id" :value="`[Tag] ${tag.id}`">
                      [标签] {{ tag.name }}
                    </option>
                  </optgroup>
                  <optgroup label="具体美化">
                    <option v-for="t in appStore.themes" :key="t.name" :value="t.name">{{ t.name }}</option>
                  </optgroup>
                </select>
              </label>
              <label class="tc-field">
                <span>默认夜间美化</span>
                <select v-model="appStore.settings.autoTheme.nightTarget" class="tc-select">
                  <option value="">-- 不指定 --</option>
                  <optgroup v-if="appStore.settings.tags.length > 0" label="按标签随机">
                    <option v-for="tag in appStore.settings.tags" :key="tag.id" :value="`[Tag] ${tag.id}`">
                      [标签] {{ tag.name }}
                    </option>
                  </optgroup>
                  <optgroup label="具体美化">
                    <option v-for="t in appStore.themes" :key="t.name" :value="t.name">{{ t.name }}</option>
                  </optgroup>
                </select>
              </label>
            </div>

            <div class="tc-divider"></div>
            <div class="tc-subtitle">专属日夜配对（切换时自动在配对内互切）</div>
            <div class="tc-grid-3">
              <select v-model="newDayTheme" class="tc-select">
                <option value="">选择日间美化...</option>
                <option v-for="t in appStore.themes" :key="t.name" :value="t.name">{{ t.name }}</option>
              </select>
              <select v-model="newNightTheme" class="tc-select">
                <option value="">选择夜间美化...</option>
                <option v-for="t in appStore.themes" :key="t.name" :value="t.name">{{ t.name }}</option>
              </select>
              <button type="button" class="tc-btn primary" @click="handleAddPair">添加配对</button>
            </div>

            <div class="tc-list-box">
              <div v-if="appStore.settings.dayNightPairs.length === 0" class="tc-muted">暂无日夜配对</div>
              <div v-for="p in appStore.settings.dayNightPairs" :key="p.id" class="tc-kv-row">
                <span>☀️ {{ p.dayTheme || '未设' }} ⇄ 🌙 {{ p.nightTheme || '未设' }}</span>
                <button type="button" class="tc-row-btn tc-danger" @click="removeDayNightPair(p.id)">
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
            </div>
          </div>

          <!-- Tab 2: 背景图绑定 & 角色绑定 -->
          <div v-if="activeTab === 'bindings'" class="tc-section">
            <div class="tc-subtitle">主题 ↔ 背景图绑定（切换美化时自动切换背景）</div>
            <div class="tc-grid-3">
              <select v-model="bindThemeName" class="tc-select">
                <option value="">选择美化...</option>
                <option v-for="t in appStore.themes" :key="t.name" :value="t.name">{{ t.name }}</option>
              </select>
              <select v-model="bindBgFile" class="tc-select">
                <option value="">选择背景图...</option>
                <option v-for="bg in backgrounds" :key="bg" :value="bg">{{ bg }}</option>
              </select>
              <button type="button" class="tc-btn primary" @click="handleSaveBgBinding">绑定</button>
            </div>
            <div class="tc-list-box">
              <div
                v-if="Object.keys(appStore.settings.backgroundBindings).length === 0"
                class="tc-muted"
              >
                暂无背景图绑定
              </div>
              <div
                v-for="(bg, themeName) in appStore.settings.backgroundBindings"
                :key="themeName"
                class="tc-kv-row"
              >
                <span>🎨 {{ themeName }} → 🖼️ {{ bg }}</span>
                <button
                  type="button"
                  class="tc-row-btn tc-danger"
                  @click="setThemeBackgroundBinding(String(themeName), '')"
                >
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
            </div>

            <div class="tc-divider"></div>
            <div class="tc-subtitle">角色 ↔ 美化绑定（切换聊天角色时自动切换美化）</div>
            <div class="tc-grid-3">
              <select v-model="bindCharAvatar" class="tc-select">
                <option value="">选择角色...</option>
                <option v-for="c in characters" :key="c.avatar" :value="c.avatar">{{ c.name }}</option>
              </select>
              <select v-model="bindCharTarget" class="tc-select">
                <option value="">选择目标美化...</option>
                <optgroup v-if="appStore.settings.tags.length > 0" label="按标签随机">
                  <option v-for="tag in appStore.settings.tags" :key="tag.id" :value="`[Tag] ${tag.id}`">
                    [标签] {{ tag.name }}
                  </option>
                </optgroup>
                <optgroup label="具体美化">
                  <option v-for="t in appStore.themes" :key="t.name" :value="t.name">{{ t.name }}</option>
                </optgroup>
              </select>
              <button type="button" class="tc-btn primary" @click="handleSaveCharBinding">绑定</button>
            </div>
            <div class="tc-list-box">
              <div
                v-if="Object.keys(appStore.settings.characterBindings).length === 0"
                class="tc-muted"
              >
                暂无角色绑定
              </div>
              <div
                v-for="(target, avatar) in appStore.settings.characterBindings"
                :key="avatar"
                class="tc-kv-row"
              >
                <span>👤 {{ getCharDisplayName(String(avatar)) }} → 🎨 {{ getTargetLabel(target) }}</span>
                <button
                  type="button"
                  class="tc-row-btn tc-danger"
                  @click="setCharacterThemeBinding(String(avatar), '')"
                >
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
            </div>
          </div>

          <!-- Tab 3: 标签管理 -->
          <div v-if="activeTab === 'tags'" class="tc-section">
            <div class="tc-subtitle">轻量标签管理（同时自动承接酒馆匣推送的分类）</div>
            <div class="tc-row-inline">
              <input
                v-model="newTagName"
                type="text"
                class="tc-input"
                placeholder="输入新标签名称..."
                @keyup.enter="handleAddTag"
              />
              <button type="button" class="tc-btn primary" @click="handleAddTag">新建标签</button>
            </div>
            <div class="tc-list-box">
              <div v-if="appStore.settings.tags.length === 0" class="tc-muted">暂无标签</div>
              <div v-for="tag in appStore.settings.tags" :key="tag.id" class="tc-kv-row">
                <span>🏷️ {{ tag.name }}（{{ tag.themes.length }} 个美化）</span>
                <button type="button" class="tc-row-btn tc-danger" @click="deleteTag(tag.id)">
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
            </div>
          </div>

          <!-- Tab 4: 同步与迁移 -->
          <div v-if="activeTab === 'sync'" class="tc-section">
            <div class="tc-subtitle">酒馆匣实时联动与磁盘同步</div>
            <label class="tc-switch-row">
              <input v-model="appStore.settings.autoSyncOnFocus" type="checkbox" />
              <span>切回酒馆窗口时自动静默检查磁盘新增美化（30 秒冷却）</span>
            </label>
            <div class="tc-hint">
              已开启 <code>stvault:themePushed</code> 事件实时监听：从「酒馆匣」推送美化到酒馆后，本面板会 0 延迟自动刷新列表并同步分类，无需刷新网页。
            </div>
            <div>
              <button
                type="button"
                class="tc-btn"
                :disabled="appStore.isSyncing"
                @click="syncThemesWithDisk({ silent: false })"
              >
                <i class="fa-solid fa-rotate"></i>
                立即与磁盘全量对照同步
              </button>
            </div>

            <div class="tc-divider"></div>
            <div class="tc-subtitle">从旧版美化管理助手迁移数据</div>
            <div class="tc-hint">
              新版配置统一保存在 SillyTavern 的 <code>extension_settings</code> 中。如果你之前用过旧版，可以一键把收藏、标签、背景绑定、角色绑定和日夜配对合并导入（不会删除旧版数据）。
            </div>
            <div>
              <button type="button" class="tc-btn primary" @click="handleLegacyMigration">
                <i class="fa-solid fa-download"></i>
                {{ legacyAvailable ? '检测到旧版数据，一键迁移' : '尝试迁移旧版 localStorage 数据' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
