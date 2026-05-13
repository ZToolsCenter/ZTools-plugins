# 纯文本编辑器插件 — 设计文档

## 概述

ZTools 平台插件，提供即开即写的纯文本编辑体验，支持 Markdown 预览。进入即续写，自动持久化，极简交互。

## 功能入口

`plugin.json` 使用 `text` 类型命令，匹配关键词：`wb`、`bj`、`edit`、`编辑`、`记事`、`笔记`、`文本`。

进入插件后自动恢复上次编辑的笔记，光标定位到内容末尾。

## 编辑模式

### 纯文本模式（默认）

- 纯文本 textarea 编辑，左侧淡显行号（可切换显示）
- 自动检测链接，蓝色高亮可点击
- 每次输入变更 debounce 写入 localStorage

### Markdown 模式

- 点击底栏 MD 按钮切换进入
- 左右分栏：左侧编辑源码，右侧实时渲染预览
- 再次点击 MD 按钮回到纯文本模式

## 多笔记管理

- 支持多笔记，抽屉式列表管理
- 抽屉默认隐藏，点击底栏☰按钮从左侧浮动滑出
- 抽屉浮动覆盖在编辑区上方，带半透明遮罩
- 笔记列表显示标题（自动取前 20 字符）和更新时间
- 当前笔记以棕色调 `#a68a64` 左侧边框标识
- 点击遮罩或✕关闭抽屉
- 抽屉底部有"新建笔记"按钮

## 导出

- 纯文本模式导出 `.txt`，Markdown 模式导出 `.md`
- 触发方式：底栏↓按钮 或 `Ctrl+S` / `Cmd+S` 快捷键
- 通过 `window.services.writeTextFile` 写入下载目录
- 导出后调用 `window.ztools.shellShowItemInFolder` 在文件管理器中显示

## 视觉设计

### 风格：纸张白净

- 编辑区背景 `#faf8f5`，外框 `#e8e4df`
- 等宽字体编辑区，行号淡灰 `rgba(0,0,0,0.12)`
- 正文颜色 `rgba(0,0,0,0.7)`
- 链接高亮 `#1565c0`
- 当前笔记标识 `#a68a64`（棕色调）
- Markdown 预览区使用系统字体，保持纸张白净风格

### 布局

- 浮动底栏：胶囊形状，圆形按钮，悬浮在底部中央
  - ☰ 列表 — 打开抽屉
  - ＋ 新建 — 快速新建笔记
  - MD 切换 — 纯文本/Markdown 模式切换
  - ↓ 导出 — 导出文件
- 抽屉：左侧浮动覆盖，宽度约 200px，带半透明遮罩

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| Ctrl+S / Cmd+S | 导出当前笔记 |

## 数据模型

```typescript
interface Note {
  id: string        // 时间戳生成的唯一 ID
  title: string     // 自动取前 20 字符作为标题
  content: string   // 文本内容
  mode: 'text' | 'markdown'  // 编辑模式
  updatedAt: number // 更新时间戳
}

// localStorage keys
"plain-text-notes": Note[]          // 所有笔记
"plain-text-active": string         // 当前活跃笔记 id
```

## 文件结构

```
src/
  App.tsx                — 路由：根据 action.code 渲染 Editor
  Editor/
    index.tsx            — 编辑器主组件（含模式切换、抽屉、底栏）
    index.css            — 编辑器样式（含 Markdown 预览样式）
  stores/
    notes.ts             — localStorage 读写逻辑
public/
  plugin.json            — 功能注册（替换现有 hello/read/write）
  preload/
    services.js          — 保持不变，复用 writeTextFile
```

## 不做的事

- 不支持富文本编辑（所见即所得）
- 不支持文件导入（只做 localStorage 存储 + 导出）
- 不做云同步
- 不做笔记搜索
- 不做 Markdown 编辑器语法高亮（源码区就是纯文本）
