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
  /** 禁用点击聊天头像放大预览 */
  disableAvatarZoom: boolean;
  /** 默认全局裁剪位置 */
  defaultCrop: AvatarCropRule;
  /** 按角色头像文件名单独覆盖的裁剪规则 */
  perCharacterCrop: Record<string, AvatarCropRule>;
  /** 角色专属图库：charAvatar -> items */
  perCharacterGallery: Record<string, AvatarGalleryItem[]>;
  /** 全局用户图库 */
  userGallery: AvatarGalleryItem[];
  /** 按当前聊天角色绑定的用户图库：charAvatar -> items */
  perCharUserGallery: Record<string, AvatarGalleryItem[]>;
  /** 头像视觉覆盖：key (charAvatar | '__user__' | '__user_char__:' + charAvatar) -> gallery item id */
  avatarOverrides: Record<string, string>;
}

export type SortMode = 'name-asc' | 'name-desc' | 'favorite-first' | 'usage-desc' | 'usage-asc';
export type ListMode = 'scroll' | 'page';

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
  /** 是否在切回窗口时静默同步磁盘新增主题 */
  autoSyncOnFocus: boolean;
  /** 排序规则 */
  sortBy: SortMode;
  /** 列表显示模式 */
  listMode: ListMode;
  /** 分页每页条数 */
  pageSize: number;
  /** 使用次数统计：themeName -> count */
  usageCounts: Record<string, number>;
  /** 是否在列表项旁显示使用次数 */
  showUsageCount: boolean;
  /** 用户最后一次选定的激活美化名称（用于拦截 TT 酒馆上下文回滚与跨会话恢复） */
  lastActiveTheme: string;
}

export interface StVaultThemePushedDetail {
  theme: ThemeObject;
  tags?: string[];
  category?: string;
  autoApply?: boolean;
  bg?: string;
}
