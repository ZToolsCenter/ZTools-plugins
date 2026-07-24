# 繁简转换（ZTools 插件）

基于 [OpenCC](https://github.com/BYVoid/OpenCC)（`opencc-js`）的繁体字与简体字互转，支持台湾地区 / 香港地区与大陆简体之间的用词差异。

## 功能

- 界面**左侧为原文**，**右侧为转换结果**，可对照查看。
- 在 ZTools 中复制文本后呼出启动器：剪贴板有内容时会出现 **「繁简转换（剪贴板）」**，进入插件后自动填入**原文**侧；在右侧点击 **繁 → 简** 或 **简 → 繁** 生成结果。
- 剪贴板为空时，可搜索 **「繁简转换」** 或 **「繁简」** 手动打开。
- **繁体标准**可在界面选择 **台湾（tw）** 或 **香港（hk）**，会影响词语级转换。

## 安装依赖

在插件根目录执行：

```bash
npm install
```

需存在 `node_modules/opencc-js`（ZTools 通过 `preload.js` 以 CommonJS 加载）。

## 在 ZTools 中加载

1. 将本目录准备完整（含 `logo.png`、`plugin.json`、`preload.js`、`index.html` 等）。
2. ZTools → **设置** → **开发者** → **加载本地插件**，选择本插件目录。
3. 修改 `preload.js` 后若未生效，请对该插件 **卸载再重新加载**（preload 通常不热重载）。

## 文件说明

| 文件 | 说明 |
|------|------|
| `plugin.json` | 插件元数据、主搜索框推送（剪贴板入口）与手动打开关键字 |
| `preload.js` | 读取剪贴板、`opencc-js` 转换逻辑、`onMainPush` / `onPluginEnter` |
| `index.html` / `index.js` | 双栏界面与交互 |
| `package.json` | 声明 `opencc-js` 依赖 |
