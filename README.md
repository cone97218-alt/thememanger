# 美化管理伴侣 v3 (ST Theme Companion)

基于 **Vue 3 + TypeScript + Vite** 从零重构的 SillyTavern 轻量化美化管理伴侣，以 **酒馆助手热更新脚本** 形式运行，专为搭配「酒馆匣」使用而设计。

## 核心特性

- **与「酒馆匣」0 延迟实时联动**：监听 `stvault:themePushed` 事件，酒馆匣推送美化后自动入列、自动承接分类标签、无需刷新网页。
- **切窗静默 Diff 同步**：手动拖进 `themes/` 文件夹的美化也能在切回酒馆窗口或点击刷新时自动增量同步。
- **纯粹流畅的切换体验**：搜索、收藏置顶、轻量标签筛选、重命名/删除、单文件 JSON 快速导入。
- **自动化联动**：
  - 日夜间自动切换（跟随系统深浅色 / 按时间段）+ 专属日夜配对一键切换
  - 主题 ↔ 背景图绑定
  - 角色 ↔ 美化绑定（基于官方 `CHAT_CHANGED` 事件）
- **精简头像管理**：快捷替换角色/用户头像、头像大小/比例/圆角设置、全局及单角色可视化位置与缩放裁剪。
- **平滑过渡**：配置统一存储在 ST 官方 `extension_settings`，内置旧版 `localStorage` 一键迁移，完整保留 `window.themeManager` 对外标签联动 API。

## 安装（酒馆助手热更新）

1. 将本仓库的 `loader.json` 导入酒馆助手（JS-Slash-Runner / TavernHelper）的全局脚本中并启用。
2. 脚本会自动从 `cone97218-alt/thememanger` 的 `main` 分支拉取最新编译好的 `dist/theme-companion.js`（支持 GitHub Raw 与 jsDelivr 双兜底）。

## 本地开发与构建

```bash
npm install
npm run typecheck
npm run build
```

构建产物位于 `dist/theme-companion.js`（单文件自包含，CSS 已自动内联注入）。
