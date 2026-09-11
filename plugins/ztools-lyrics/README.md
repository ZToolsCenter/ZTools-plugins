# 歌词搜索 (ztools-lyrics)

一个 ZTools 插件：搜索歌曲并阅读歌词，支持翻译对照、逐行复制、收藏、保存为 TXT。

## 功能

- **搜索歌曲**：主搜索框输入任意文字 → 选择「搜歌词」进入；或输入 `歌词` / `搜歌词` / `lyric` / `gc` 进入插件后再搜索。插件激活后主搜索框变为实时搜索框（防抖 400ms）。
- **歌词阅读**：LRC 歌词按时间排序展示，带翻译的歌曲可勾选「显示翻译」对照阅读（默认开启）。
- **逐行复制**：点击歌词任意一行，该行内容即复制到剪贴板。
- **复制全部 / 保存 TXT**：一键复制整篇歌词，或通过系统保存对话框导出 `.txt`（含翻译）。
- **收藏**：常用歌曲可收藏，收藏列表在插件空状态下展示，点击直接看词。
- **深色模式**：自动跟随 ZTools 主题。
- **双数据源**：网易云音乐 API 为主（LRC + 翻译），失败或无结果时自动回落到 lrclib.net（免鉴权）。

## 目录结构

```
ztools-lyrics/
├── plugin.json   # 插件配置（features 定义了文本指令 + over 全局指令）
├── preload.js    # Node.js 网络请求（网易云 / lrclib）、保存文件
├── index.html    # 界面
├── index.js      # 前端逻辑
├── index.css     # 样式（浅色 / 深色两套 CSS 变量）
└── logo.png      # 插件图标
```

零第三方依赖，无需编译，整个目录即是可用的插件应用。

## 安装（开发模式）

1. 打开 ZTools → 设置 → 开发者
2. 「新增」选择本目录下的 `plugin.json`
3. 在主搜索框输入 `歌词` 或任意文字选「搜歌词」即可使用

## 发布到插件中心

本项目满足发布条件（纯源码、preload 未压缩混淆、无 node_modules），在项目目录执行：

```bash
npm install -g @ztools-center/plugin-cli
git init && git add . && git commit -m "feat: 歌词搜索插件"
ztools publish
```

## 接口说明

| 用途 | 接口 |
| --- | --- |
| 搜索歌曲 | `POST https://music.163.com/api/search/get/` |
| 获取歌词/翻译 | `GET https://music.163.com/api/song/lyric?os=pc&id=...&lv=-1&tv=-1` |
| 兜底搜索+歌词 | `GET https://lrclib.net/api/search?q=...` |
