export interface ThemeObject {
  name: string;
  main_text_color?: string;
  italics_text_color?: string;
  underline_text_color?: string;
  quote_text_color?: string;
  blur_tint_color?: string;
  chat_tint_color?: string;
  user_mes_blur_tint_color?: string;
  bot_mes_blur_tint_color?: string;
  shadow_color?: string;
  border_color?: string;
  blur_strength?: number;
  shadow_width?: number;
  font_scale?: number;
  chat_width?: number;
  custom_css?: string;
  /** 酒馆匣可选元数据 */
  _xia?: {
    tags?: string[];
    category?: string;
    bg?: string;
  };
  [key: string]: unknown;
}

export interface TagItem {
  id: string;
  name: string;
  parentId?: string | null;
  themes: string[];
}

export interface DayNightPair {
  id: string;
  dayTheme: string;
  nightTheme: string;
}

export interface AutoThemeConfig {
  enabled: boolean;
  mode: 'system' | 'time';
  dayStart: string; // HH:mm
  nightStart: string; // HH:mm
  dayTarget: string; // 主题名 或 '[Tag] tagId'
  nightTarget: string;
}

export interface AvatarCropRule {
  /** object-position X (0 - 100%) */
  posX: number;
  /** object-position Y (0 - 100%) */
  posY: number;
  /** 缩放倍率 (1.0 - 2.5) */
  scale: number;
}

export interface AvatarGalleryItem {
  id: string;
  source: 'idb' | 'url';
  url?: string;
  name?: string;
}

export interface AvatarConfig {
  enabled: boolean;
  /** 全局头像宽度 (px, 0 表示跟随主题默认) */
  sizePx: number;
  /** 宽高比: '1/1' | '2/3' | '3/4' | 'auto' */
  aspectRatio: '1/1' | '2/3' | '3/4' | 'auto';
  /** 圆角 (px, -1 表示跟随主题默认) */
  borderRadiusPx: number;
  /** 是否在角色/用户详情页注入快捷替换头像按钮 */
  enableReplaceButton: boolean;
  /** 默认全局裁剪位置 */
  defaultCrop: AvatarCropRule;
  /** 按角色头像文件名单独覆盖的裁剪规则 */
  perCharacterCrop: Record<string, AvatarCropRule>;
  /** 角色专属图库：charAvatar -> items */
  perCharacterGallery: Record<string, AvatarGalleryItem[]>;
  /** 全局用户图库 */
  userGallery: AvatarGalleryItem[];
  /** 头像视觉覆盖：key (charAvatar 或 '__user__') -> gallery item id */
  avatarOverrides: Record<string, string>;
}

export interface CompanionSettings {
  version: number;
  collapsed: boolean;
  favorites: string[];
  tags: TagItem[];
  /** themeName -> backgroundFileName */
  backgroundBindings: Record<string, string>;
  /** characterAvatarFileName -> themeName | '[Tag] tagId' */
  characterBindings: Record<string, string>;
  dayNightPairs: DayNightPair[];
  autoTheme: AutoThemeConfig;
  avatar: AvatarConfig;
  /** 是否在打开面板/切回窗口时静默同步磁盘新增主题 */
  autoSyncOnFocus: boolean;
}

export interface StVaultThemePushedDetail {
  theme: ThemeObject;
  tags?: string[];
  category?: string;
  autoApply?: boolean;
  bg?: string;
}
