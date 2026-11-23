import { watch } from 'vue';
import { getMainDoc, showToast } from '../bridge/host';
import { appStore } from '../store/appStore';

const STYLE_ELEMENT_ID = 'tc-avatar-dynamic-style';

function escapeAttrValue(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * 根据当前 avatar 配置生成并注入精准 CSS（大小、宽高比、圆角、位置裁剪与缩放）
 */
export function applyAvatarStyles(): void {
  const doc = getMainDoc();
  let styleEl = doc.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  const cfg = appStore.settings.avatar;

  if (!cfg.enabled) {
    if (styleEl) styleEl.remove();
    return;
  }

  if (!styleEl) {
    styleEl = doc.createElement('style');
    styleEl.id = STYLE_ELEMENT_ID;
    doc.head.appendChild(styleEl);
  }

  const rules: string[] = [];

  // 1. 头像容器大小、比例、圆角
  const containerProps: string[] = [];
  if (cfg.sizePx > 0) {
    containerProps.push(`width: ${cfg.sizePx}px !important;`);
    containerProps.push(`min-width: ${cfg.sizePx}px !important;`);
    if (cfg.aspectRatio === 'auto') {
      containerProps.push(`height: ${cfg.sizePx}px !important;`);
    } else {
      containerProps.push(`height: auto !important;`);
      containerProps.push(`aspect-ratio: ${cfg.aspectRatio} !important;`);
    }
  } else if (cfg.aspectRatio !== 'auto') {
    containerProps.push(`height: auto !important;`);
    containerProps.push(`aspect-ratio: ${cfg.aspectRatio} !important;`);
  }

  if (cfg.borderRadiusPx >= 0) {
    containerProps.push(`border-radius: ${cfg.borderRadiusPx}px !important;`);
  }

  if (containerProps.length > 0) {
    rules.push(`
      #chat .mes .avatar,
      #chat .mes .mesAvatarWrapper .avatar {
        ${containerProps.join('\n        ')}
        overflow: hidden !important;
      }
    `);
  }

  // 2. 全局默认图片裁剪位置 & 缩放
  const def = cfg.defaultCrop;
  const imgRadius = cfg.borderRadiusPx >= 0 ? `border-radius: ${cfg.borderRadiusPx}px !important;` : '';
  const scaleTransform = def.scale !== 1 ? `transform: scale(${def.scale}) !important;` : '';

  rules.push(`
    #chat .mes .avatar img {
      width: 100% !important;
      height: 100% !important;
      object-fit: cover !important;
      object-position: ${def.posX}% ${def.posY}% !important;
      ${scaleTransform}
      ${imgRadius}
      transform-origin: ${def.posX}% ${def.posY}% !important;
    }
  `);

  // 3. 单角色专属位置裁剪与缩放覆盖
  for (const [avatarFile, crop] of Object.entries(cfg.perCharacterCrop)) {
    if (!avatarFile || !crop) continue;
    const encoded = escapeAttrValue(encodeURIComponent(avatarFile));
    const raw = escapeAttrValue(avatarFile);
    const scaleRule = crop.scale !== 1 ? `transform: scale(${crop.scale}) !important;` : 'transform: none !important;';
    rules.push(`
      #chat .mes .avatar img[src*="${encoded}"],
      #chat .mes .avatar img[src*="${raw}"] {
        object-position: ${crop.posX}% ${crop.posY}% !important;
        transform-origin: ${crop.posX}% ${crop.posY}% !important;
        ${scaleRule}
      }
    `);
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
    showToast('warning', '请先打开一个角色卡详情页再替换头像');
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

function injectReplaceButtons(): void {
  const doc = getMainDoc();
  if (!appStore.settings.avatar.enableReplaceButton) {
    doc.getElementById('tc-char-replace-avatar-btn')?.remove();
    doc.getElementById('tc-user-replace-avatar-btn')?.remove();
    return;
  }

  // 1. 角色卡详情页按钮
  const charBlock = doc.querySelector('.form_create_bottom_buttons_block');
  if (charBlock && !doc.getElementById('tc-char-replace-avatar-btn')) {
    const btn = doc.createElement('div');
    btn.id = 'tc-char-replace-avatar-btn';
    btn.className = 'menu_button fa-solid fa-image';
    btn.title = '替换角色卡头像';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      triggerReplaceCharacterAvatar();
    });
    const delBtn = charBlock.querySelector('#delete_button');
    if (delBtn) charBlock.insertBefore(btn, delBtn);
    else charBlock.appendChild(btn);
  }

  // 2. 用户 Persona 详情页按钮
  const userBlock = doc.querySelector('.persona_controls_buttons_block');
  if (userBlock && !doc.getElementById('tc-user-replace-avatar-btn')) {
    const btn = doc.createElement('div');
    btn.id = 'tc-user-replace-avatar-btn';
    btn.className = 'menu_button fa-solid fa-image';
    btn.title = '替换用户头像';
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
 * 启动头像样式响应 & 详情页快捷替换按钮（纯事件驱动，无轮询）
 */
export function startAvatarFeature(): () => void {
  applyAvatarStyles();
  injectReplaceButtons();

  const stopWatch = watch(
    () => appStore.settings.avatar,
    () => {
      applyAvatarStyles();
      injectReplaceButtons();
    },
    { deep: true },
  );

  const doc = getMainDoc();
  const onDocClick = (e: Event) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('#rightNavDrawerIcon, .character_select, .persona_item, #user_avatar_block, .drawer-icon')) {
      setTimeout(injectReplaceButtons, 150);
    }
  };
  doc.addEventListener('click', onDocClick);

  return () => {
    stopWatch();
    doc.removeEventListener('click', onDocClick);
    doc.getElementById(STYLE_ELEMENT_ID)?.remove();
    doc.getElementById('tc-char-replace-avatar-btn')?.remove();
    doc.getElementById('tc-user-replace-avatar-btn')?.remove();
  };
}
