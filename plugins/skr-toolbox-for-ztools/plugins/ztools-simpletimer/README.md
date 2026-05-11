# ztools-simpletimer

一个从 uTools 计时器插件迁移到 ZTools 的简单悬浮窗计时器。

## 功能

- 正计时：输入 `正计时`、`stopwatch` 或 `计时器` 启动。
- 倒计时：输入 `倒计时`、`countdown` 或 `计时器` 启动。
- 启动后直接创建透明置顶悬浮窗，并隐藏 ZTools 主窗口。
- 倒计时支持提示音、系统通知、常用预设和自定义时间保存。

## 开发

```bash
npm install
npm run dev
```

开发地址是 `http://127.0.0.1:5173`，`public/plugin.json` 已配置 `development.main`。

## 构建

```bash
npm run build
```

构建产物会输出到 `dist/`，包含：

- `plugin.json`
- `index.html`
- `cue.mp3`
- `logo.png`
- `preload/services.js`

## 迁移说明

- ZTools 插件配置使用 `public/plugin.json`，入口仍是 `main` + `preload`。
- 原 uTools 的 `utools.createBrowserWindow`、`hideMainWindow`、`outPlugin`、`db` 已迁移为对应的 `window.ztools` API。
- 悬浮窗由 Vue 组件 `src/TimerWindow.vue` 渲染，`public/preload/services.js` 通过 `createBrowserWindow` 打开 `timer.html?mode=...`。
