# Changelog

本文件记录严肃阅读的版本变更历史。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [1.1.0] - 2026-07-03

### 变更

- 插件名称从 "Serious Reading" 改为 "严肃阅读"（plugin.json title、UI 标题、README、index.html）

### 安全修复

- **XSS 漏洞修复** — EPUB 章节内容的 HTML 清洗从正则替换改为 DOMPurify，防止恶意 EPUB 通过 XSS 载荷读取本地文件 (`src/shared/parser.ts`)

### Bug 修复

- **EPUB 嵌套分页** — 高度测量分页算法改为递归展平嵌套块级元素，修复 EPUB 章节被 `<div>` 包裹时整章塞入一页导致内容截断的问题 (`src/reader/App.tsx`)
- **搜索定位跳转末章** — 搜索结果落在章节标题空隙时不再错误跳转到最后一章，改用下一章节的 charOffset 作为上界判断 (`src/main/components/SearchDialog.tsx`)
- **EPUB 冗余解析** — 打开 EPUB 文件时不再重复调用 `readEpub`，首次解析结果缓存后直接复用提取封面 (`src/main/App.tsx`)
- **preload 全局引用** — `preload/main.js` 和 `preload/reader.js` 中裸 `ztools` 引用改为 `window.ztools`，避免上下文隔离环境下 ReferenceError (`preload/main.js`, `preload/reader.js`)
- **EPUB 章节标题不一致** — 阅读窗 preload 的 `readEpub` 引入 NCX TOC 解析，与主窗 preload 保持一致，不再将所有章节标题硬编码为"第 X 章" (`preload/reader.js`)

## [1.0.0] - 2026-07-03

### 新增

- 字体选择下拉菜单，内置 11 种中英文字体
- 「清理空行」阅读选项，压缩 TXT 连续空行为单个段落间距
- `toggle_reader` 命令（切换阅读窗显隐）
- `reader_open` 文件打开命令，支持拖入 TXT/EPUB/PDF 直接阅读

### 变更

- Logo 由 `logo.png` 更换为 `logo.svg`
- 字体设置从文本输入框改为下拉菜单选择
- TXT 渲染逻辑重构：默认保留原文换行，「清理空行」模式压缩连续空行
- `keepFormat` 设置项重命名为 `cleanEmptyLines`

## [0.1.0] - 2026-06-30

### 新增

- TXT/EPUB/PDF 三格式支持（编码检测、章节解析、PDF canvas 渲染）
- 书架管理（网格书架、封面缩略图、进度展示、最近阅读历史）
- 章节跳转、全文搜索、百分比跳转
- 高度测量自动分页
- 透明留窗（Stealth）伪装模式、真隐藏、三功能触发器自定义
- 自动翻页、阅读窗拖拽/缩放、窗口位置记忆
- 明暗主题、阅读配色、全屏截图取色、排版控制
- React 18 + TypeScript + Vite 双入口架构
