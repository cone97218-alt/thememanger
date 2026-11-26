# 美化管理（Theme Companion）外部 API 文档

本插件在 SillyTavern 主窗口全局对象上挂载了 **`window.themeManager`**，供其他酒馆扩展、酒馆助手（TavernHelper）脚本或自定义前端界面直接读取美化名单、切换美化、按标签筛选及监听状态变更。

> 如果你的代码运行在 iframe 沙箱中（例如部分酒馆助手脚本），请通过 `window.parent.themeManager`（或 `const hostWin = window.parent || window; hostWin.themeManager`）访问。

---

## 一、快速上手

### 1. 检查或等待 API 就绪

由于扩展加载顺序不固定，推荐封装一个等待辅助函数：

```js
function waitForThemeManager(timeoutMs = 15000) {
  const hostWin = window.parent || window;
  const hostDoc = hostWin.document || document;

  if (hostWin.themeManager?.isReady?.()) {
    return Promise.resolve(hostWin.themeManager);
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      hostDoc.removeEventListener('themeManager:ready', onReady);
      reject(new Error('themeManager 加载超时'));
    }, timeoutMs);

    const onReady = () => {
      clearTimeout(timer);
      resolve(hostWin.themeManager);
    };

    hostDoc.addEventListener('themeManager:ready', onReady, { once: true });
  });
}

// 使用示例
const tm = await waitForThemeManager();
console.log('全部美化名单:', tm.getThemes());
console.log('当前激活美化:', tm.getActiveTheme());
tm.switchTheme('你的美化名称');
```

---

## 二、接口总览

### 基础信息

| 方法 / 属性 | 返回值 | 说明 |
| --- | --- | --- |
| `version` | `string` | API 版本号（当前为 `'3.2.0'`） |
| `isReady()` | `boolean` | 插件是否已初始化就绪 |

---

### 美化名单与查询

#### `getThemes(options?)`
获取美化名称数组（`string[]`）。支持可选筛选参数 `ThemeFilterOptions`：

```ts
interface ThemeFilterOptions {
  tagId?: string;          // 按标签 ID 筛选
  tagName?: string;        // 按标签名称筛选（支持精确名或 "父级/子级" 路径）
  favoriteOnly?: boolean;  // 仅返回已收藏的美化
  search?: string;         // 按名称关键字模糊搜索（不区分大小写）
  includeSubTags?: boolean;// 按标签筛选时是否包含子标签（默认 true）
}
```

```js
// 全部美化名称
const allNames = tm.getThemes();

// 仅收藏
const favNames = tm.getThemes({ favoriteOnly: true });

// 按标签名筛选（含子标签）
const darkNames = tm.getThemes({ tagName: '暗色' });

// 按多级标签路径筛选
const subNames = tm.getThemes({ tagName: '风格/极简' });

// 关键字搜索
const matched = tm.getThemes({ search: 'pink' });
```

#### `getThemeList(options?)`
获取带完整元数据的美化清单（`ThemeSummary[]`），同样支持 `ThemeFilterOptions` 筛选：

```ts
interface ThemeSummary {
  name: string;            // 美化名称
  isActive: boolean;       // 是否为当前激活美化
  isFavorite: boolean;     // 是否已收藏
  tagIds: string[];        // 所属标签 ID 列表
  tagNames: string[];      // 所属标签名称列表
  usageCount: number;      // 使用次数
  background: string | null; // 绑定的背景图文件名（无则为 null）
}
```

```js
const list = tm.getThemeList({ favoriteOnly: true });
// => [{ name: 'Moonlight', isActive: true, isFavorite: true, tagIds: [...], tagNames: ['暗色'], usageCount: 12, background: 'night.jpg' }]
```

#### `getThemeDetails(themeName)`
获取指定美化的完整深拷贝配置对象（包含颜色、`custom_css`、`blur_strength` 等字段），不存在返回 `null`。

```js
const detail = tm.getThemeDetails('Moonlight');
```

#### `getActiveTheme()`
返回当前激活的美化名称（`string`）。

#### `getFavorites()`
返回已收藏的美化名称数组（`string[]`）。

#### `hasTheme(themeName)`
判断指定名称的美化是否存在（`boolean`）。

#### `syncThemes(options?)`
主动触发一次与磁盘的增量同步，返回 `Promise<{ added: string[]; removed: string[] }>`。默认静默（不弹 Toast），传入 `{ silent: false }` 可显示提示。

```js
const { added, removed } = await tm.syncThemes();
```

---

### 切换与控制

> 所有切换方法均走本插件统一的 `selectTheme` 管线：自动同步酒馆原生主题、兼容免刷新导入/酒馆匣推送的美化、更新使用次数，并自动应用该美化绑定的背景图。

#### `switchTheme(themeName)` / `applyTheme(themeName)`
切换到指定名称的美化，返回是否切换成功（`boolean`）。`applyTheme` 是 `switchTheme` 的别名。

```js
const ok = tm.switchTheme('Moonlight');
```

#### `switchRandomTheme(options?)`
随机切换一个美化，返回实际切换到的美化名称（无候选时返回 `null`）。支持 `ThemeFilterOptions` 的全部筛选条件，额外支持：
- `excludeCurrent?: boolean` — 是否排除当前正在使用的美化（默认 `true`，仅剩 1 个候选时自动回退）

```js
// 全局随机切换
tm.switchRandomTheme();

// 在「暗色」标签内随机切换
tm.switchRandomTheme({ tagName: '暗色' });

// 在收藏列表中随机切换
tm.switchRandomTheme({ favoriteOnly: true });
```

#### `switchNextTheme(options?)` / `switchPrevTheme(options?)`
在全部（或筛选后的）美化名单中循环切换到下一个 / 上一个美化，返回切换后的美化名称（无候选返回 `null`）。

```js
// 切换到下一个收藏美化
const next = tm.switchNextTheme({ favoriteOnly: true });

// 切换到上一个美化
const prev = tm.switchPrevTheme();
```

#### `toggleFavorite(themeName)`
切换指定美化的收藏状态，返回切换后的收藏状态（`boolean`）。

---

### 标签查询

| 方法 | 参数 | 返回值 | 说明 |
| --- | --- | --- | --- |
| `getTags()` | — | `TagItem[]` | 获取全部标签（含层级 `parentId` 与 `themes` 列表） |
| `getThemeTags(themeName)` | `string` | `string[]` | 获取指定美化所属的标签 ID 列表 |
| `getThemesByTag(tagIdOrName, options?)` | `string, { includeSubTags?: boolean }` | `string[]` | 按标签 ID、标签名或 `父级/子级` 路径获取美化名称列表 |

```ts
interface TagItem {
  id: string;
  name: string;
  parentId?: string | null;
  themes: string[];
}
```

---

## 三、事件监听

提供 **回调订阅** 和 **主文档 DOM CustomEvent** 两种方式，二选一即可：

### 1. 回调订阅（推荐，返回取消订阅函数）

```js
// 监听当前激活美化变化
const offTheme = tm.onThemeChanged((themeName, prevThemeName) => {
  console.log(`美化已切换: ${prevThemeName} -> ${themeName}`);
});

// 监听美化名单增删/同步变化
const offList = tm.onThemesUpdated((themeNames) => {
  console.log('最新美化数量:', themeNames.length);
});

// 监听标签变化
const offTags = tm.onTagsChanged((tags) => {
  console.log('最新标签列表:', tags);
});

// 需要销毁时取消订阅
offTheme();
offList();
offTags();
```

### 2. 主文档 `CustomEvent` 监听

监听目标为酒馆主文档 `const hostDoc = (window.parent || window).document`：

| 事件名 | `event.detail` 结构 | 触发时机 |
| --- | --- | --- |
| `themeManager:ready` | `{ version: string, themes: string[], activeTheme: string }` | 插件挂载并初始化完成时 |
| `themeManager:themeChanged` | `{ theme: string, previousTheme: string }` | 当前激活美化发生变化时 |
| `themeManager:themesUpdated` | `{ themes: string[] }` | 美化名单发生新增、删除、重命名或同步变化时 |
| `themeManager:tagsChanged` | `TagItem[]` | 标签新增、删除、排序或归属变化时 |

```js
const hostDoc = (window.parent || window).document;

hostDoc.addEventListener('themeManager:themeChanged', (e) => {
  const { theme, previousTheme } = e.detail;
  console.log('切换到了:', theme, '上一个:', previousTheme);
});
```

---

## 四、常见扩展集成示例

### 示例 1：在其他扩展中渲染一个美化下拉选择器

```js
async function mountThemeSelector(selectEl) {
  const tm = await waitForThemeManager();

  const render = () => {
    const list = tm.getThemeList();
    selectEl.innerHTML = '';
    for (const item of list) {
      const opt = document.createElement('option');
      opt.value = item.name;
      opt.textContent = item.isFavorite ? `★ ${item.name}` : item.name;
      opt.selected = item.isActive;
      selectEl.appendChild(opt);
    }
  };

  render();

  selectEl.addEventListener('change', () => {
    tm.switchTheme(selectEl.value);
  });

  // 双向同步：美化管理面板切换或增删时自动更新下拉框
  tm.onThemeChanged(() => render());
  tm.onThemesUpdated(() => render());
}
```

### 示例 2：一键随机切换收藏美化按钮

```js
btn.addEventListener('click', () => {
  const tm = (window.parent || window).themeManager;
  if (!tm) return;
  const picked = tm.switchRandomTheme({ favoriteOnly: true });
  if (!picked) {
    // 若没有收藏，则从全部美化中随机
    tm.switchRandomTheme();
  }
});
```
