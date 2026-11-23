import { watch } from 'vue';
import { getMainDoc, showToast } from '../bridge/host';
import { getCurrentCharacter, onSTEvent } from '../bridge/st-api';
import { appStore } from '../store/appStore';
import { resolveOverrideUrl } from './avatarGallery';

const STYLE_ELEMENT_ID = 'tc-avatar-dynamic-style';
const WAND_MENU_ITEM_ID = 'tc-wand-avatar-btn';

function escapeAttrValue(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * 根据当前 avatar 配置与图库覆盖生成并注入精准 CSS
 * 严格遵循惰性注入原则：未修改的尺寸/裁剪项绝不覆写原生宽高，避免破坏主题原有头像大小
 */
export function applyAvatarStyles(): void {
  const doc = getMainDoc();
  let styleEl = doc.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  const cfg = appStore.settings.avatar;
  const rules: string[] = [];

  // 1. 图库视觉覆盖（当前角色绑定的用户头像优先于全局用户头像）
  const activeChar = getCurrentCharacter();
  const charBoundUserUrl = activeChar?.avatar
    ? resolveOverrideUrl(`__user_char__:${activeChar.avatar}`)
    : '';
  const userOverrideUrl = charBoundUserUrl || resolveOverrideUrl('__user__');
  if (userOverrideUrl) {
    rules.push(`
      #chat .mes[is_user="true"] .avatar img,
      #chat .mes[is_user="true"] .mesAvatarWrapper .avatar img {
        content: url("${escapeAttrValue(userOverrideUrl)}") !important;
        object-fit: cover !important;
      }
    `);
  }

  for (const [key] of Object.entries(cfg.avatarOverrides || {})) {
    if (!key || key === '__user__' || key.startsWith('__user_char__:')) continue;
    const url = resolveOverrideUrl(key);
    if (!url) continue;
    const encoded = escapeAttrValue(encodeURIComponent(key));
    const raw = escapeAttrValue(key);
    rules.push(`
      #chat .mes[is_user="false"] .avatar img[src*="${encoded}"],
      #chat .mes[is_user="false"] .avatar img[src*="${raw}"] {
        content: url("${escapeAttrValue(url)}") !important;
        object-fit: cover !important;
      }
    `);
  }

  // 2. 头像大小、比例、圆角与裁剪（仅在用户实际修改对应项时才注入，绝不强写 width: 100% 撑爆原布局）
  if (cfg.enabled) {
    const containerProps: string[] = [];
    const imgSizeProps: string[] = [];

    if (cfg.sizePx > 0) {
      containerProps.push(`width: ${cfg.sizePx}px !important;`);
      containerProps.push(`min-width: ${cfg.sizePx}px !important;`);
      if (cfg.aspectRatio === 'auto') {
        containerProps.push(`height: ${cfg.sizePx}px !important;`);
      } else {
        containerProps.push(`height: auto !important;`);
        containerProps.push(`aspect-ratio: ${cfg.aspectRatio} !important;`);
      }
      imgSizeProps.push(`width: 100% !important;`);
      imgSizeProps.push(`height: 100% !important;`);
    } else if (cfg.aspectRatio !== 'auto') {
      imgSizeProps.push(`height: auto !important;`);
      imgSizeProps.push(`aspect-ratio: ${cfg.aspectRatio} !important;`);
    }

    if (cfg.borderRadiusPx >= 0) {
      containerProps.push(`border-radius: ${cfg.borderRadiusPx}px !important;`);
      imgSizeProps.push(`border-radius: ${cfg.borderRadiusPx}px !important;`);
    }

    if (containerProps.length > 0) {
      rules.push(`
        #chat .mes .avatar,
        #chat .mes .mesAvatarWrapper .avatar {
          ${containerProps.join('\n          ')}
          overflow: hidden !important;
        }
      `);
    }

    const def = cfg.defaultCrop;
    const hasCustomDefCrop = def.posX !== 50 || def.posY !== 50 || def.scale !== 1;
    const imgRules: string[] = [...imgSizeProps];

    if (hasCustomDefCrop || cfg.sizePx > 0 || cfg.aspectRatio !== 'auto') {
      imgRules.push(`object-fit: cover !important;`);
    }
    if (hasCustomDefCrop) {
      imgRules.push(`object-position: ${def.posX}% ${def.posY}% !important;`);
      imgRules.push(`transform-origin: ${def.posX}% ${def.posY}% !important;`);
      if (def.scale !== 1) {
        imgRules.push(`transform: scale(${def.scale}) !important;`);
      }
    }

    if (imgRules.length > 0) {
      rules.push(`
        #chat .mes .avatar img {
          ${imgRules.join('\n          ')}
        }
      `);
    }

    for (const [avatarFile, crop] of Object.entries(cfg.perCharacterCrop)) {
      if (!avatarFile || !crop) continue;
      if (crop.posX === 50 && crop.posY === 50 && crop.scale === 1 && !hasCustomDefCrop) continue;
      const encoded = escapeAttrValue(encodeURIComponent(avatarFile));
      const raw = escapeAttrValue(avatarFile);
      const scaleRule =
        crop.scale !== 1
          ? `transform: scale(${crop.scale}) !important;`
          : 'transform: none !important;';
      rules.push(`
        #chat .mes .avatar img[src*="${encoded}"],
        #chat .mes .avatar img[src*="${raw}"] {
          object-fit: cover !important;
          object-position: ${crop.posX}% ${crop.posY}% !important;
          transform-origin: ${crop.posX}% ${crop.posY}% !important;
          ${scaleRule}
        }
      `);
    }
  }

  if (rules.length === 0) {
    styleEl?.remove();
    return;
  }

  if (!styleEl) {
    styleEl = doc.createElement('style');
    styleEl.id = STYLE_ELEMENT_ID;
    doc.head.appendChild(styleEl);
  }
  styleEl.textContent = rules.join('\n');
}

/**
 * 触发当前角色卡头像替换（复用酒馆原生上传入口）
 */
export function triggerReplaceCharacterAvatar(): void {
  const doc = getMainDoc();
  const btn = doc.getElementById('add_avatar_button');
  if (btn) {
    btn.click();
  } else {
    showToast('warning', '请先打开角色卡详情页');
  }
}

/**
 * 触发当前用户头像替换
 */
export function triggerReplaceUserAvatar(): void {
  const doc = getMainDoc();
  const personaBtn = doc.getElementById('persona_set_image_button');
  if (personaBtn) {
    personaBtn.click();
    return;
  }
  const input = doc.getElementById('avatar_upload_file');
  if (input) {
    input.click();
  } else {
    showToast('warning', '未找到用户头像上传入口');
  }
}

/**
 * 将「头像管理」注入酒馆输入框旁的魔法棒菜单 (#extensionsMenu)
 */
function injectWandMenuItem(): boolean {
  const doc = getMainDoc();
  const menu = doc.getElementById('extensionsMenu');
  if (!menu) return false;
  if (doc.getElementById(WAND_MENU_ITEM_ID)) return true;

  const item = doc.createElement('div');
  item.id = WAND_MENU_ITEM_ID;
  item.className = 'list-group-item flex-container flexGap5 interactable';
  item.tabIndex = 0;
  item.innerHTML = `
    <div class="fa-fw fa-solid fa-user-pen extensionsMenuExtensionButton"></div>
    <span>头像管理</span>
  `;
  item.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    menu.style.display = 'none';
    appStore.showAvatarModal = true;
  });

  menu.appendChild(item);
  return true;
}

function injectReplaceButtons(): void {
  const doc = getMainDoc();
  if (!appStore.settings.avatar.enableReplaceButton) {
    doc.getElementById('tc-char-replace-avatar-btn')?.remove();
    doc.getElementById('tc-user-replace-avatar-btn')?.remove();
    return;
  }

  const charBlock = doc.querySelector('.form_create_bottom_buttons_block');
  if (charBlock && !doc.getElementById('tc-char-replace-avatar-btn')) {
    const btn = doc.createElement('div');
    btn.id = 'tc-char-replace-avatar-btn';
    btn.className = 'menu_button fa-solid fa-image';
    btn.title = '替换头像';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      triggerReplaceCharacterAvatar();
    });
    const delBtn = charBlock.querySelector('#delete_button');
    if (delBtn) charBlock.insertBefore(btn, delBtn);
    else charBlock.appendChild(btn);
  }

  const userBlock = doc.querySelector('.persona_controls_buttons_block');
  if (userBlock && !doc.getElementById('tc-user-replace-avatar-btn')) {
    const btn = doc.createElement('div');
    btn.id = 'tc-user-replace-avatar-btn';
    btn.className = 'menu_button fa-solid fa-image';
    btn.title = '替换头像';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      triggerReplaceUserAvatar();
    });
    const delBtn = userBlock.querySelector('#persona_delete_button');
    if (delBtn) userBlock.insertBefore(btn, delBtn);
    else userBlock.appendChild(btn);
  }
}

/**
 * 启动头像样式、图库覆盖、魔法棒菜单入口与详情页替换按钮
 */
export function startAvatarFeature(): () => void {
  applyAvatarStyles();
  injectReplaceButtons();
  injectWandMenuItem();

  let wandRetries = 0;
  const wandTimer = setInterval(() => {
    wandRetries++;
    if (injectWandMenuItem() || wandRetries >= 20) {
      clearInterval(wandTimer);
    }
  }, 500);

  const stopWatch = watch(
    () => [appStore.settings.avatar, appStore.galleryCacheVersion],
    () => {
      applyAvatarStyles();
      injectReplaceButtons();
    },
    { deep: true },
  );

  const doc = getMainDoc();

  const onCaptureAvatarClick = (e: Event) => {
    if (!appStore.settings.avatar.disableAvatarZoom) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('#chat .mes .avatar')) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  doc.addEventListener('click', onCaptureAvatarClick, true);

  const unsubChatChanged = onSTEvent('CHAT_CHANGED', () => {
    setTimeout(applyAvatarStyles, 60);
  });

  const onDocClick = (e: Event) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('#extensionsMenuButton')) {
      injectWandMenuItem();
    }
    if (
      target.closest(
        '#rightNavDrawerIcon, .character_select, .persona_item, #user_avatar_block, .drawer-icon',
      )
    ) {
      setTimeout(injectReplaceButtons, 150);
    }
  };
  doc.addEventListener('click', onDocClick);

  return () => {
    clearInterval(wandTimer);
    stopWatch();
    unsubChatChanged();
    doc.removeEventListener('click', onCaptureAvatarClick, true);
    doc.removeEventListener('click', onDocClick);
    doc.getElementById(STYLE_ELEMENT_ID)?.remove();
    doc.getElementById(WAND_MENU_ITEM_ID)?.remove();
    doc.getElementById('tc-char-replace-avatar-btn')?.remove();
    doc.getElementById('tc-user-replace-avatar-btn')?.remove();
  };
}
