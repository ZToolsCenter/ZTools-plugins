# Skill Hub

> 一个 ZTools 插件 — AI 编写代码，本人负责使用与维护。

Vue 3 + Vite + TypeScript 构建的技能商店与一键分发工具。浏览 GitHub / skills.sh / 本地的 SKILL.md，扫描项目或 AI Agent 中的已有技能，并通过符号链接或复制的方式一键分发到多个 AI 平台。

## 快速开始

```bash
pnpm dev       # 开发服务器 → http://localhost:5173
pnpm build     # vue-tsc 类型检查 → vite 构建 → dist/
```

## 功能

### 我的 Skill（默认首页）

列出已下载的技能，支持按分类筛选（全部/收藏/已分发/待分发）。每个技能卡片显示名称、作者、标签、来源，可一键安装到已检测到的 AI Agent 平台，或卸载、收藏、查看详情。

### Skill 商店

从多个来源浏览和搜索技能：

- **Claude Code** — 官方 [anthropics/skills](https://github.com/anthropics/skills) 仓库
- **OpenAI Codex** — 官方 [openai/skills](https://github.com/openai/skills) 仓库
- **skills.sh** — 社区技能市场，支持搜索、热门排序、精选作者
- **自定义源** — 可添加任意 GitHub 仓库或本地目录作为来源

商店支持模糊搜索和语义搜索，提供技能安全审计信息（风险等级、审查摘要）。

### 项目 Skill

注册本地项目目录，自动扫描其中约定的子目录（`.claude/skills`、`.agents/skills`、`skills`、`.cursor/skills`、`.windsurf/skills` 等），识别项目内定义的 SKILL.md 文件。支持添加、编辑、删除项目，查看项目内技能的原始内容和元数据。

### Agent Skill

自动检测本地已安装的 AI Agent 平台（Claude Code / Codex / Cursor / Windsurf / Cline 等），扫描各平台的技能目录，列出已有技能。支持查看技能详情和原始文件内容。

### 商店源管理

管理自定义技能来源，支持三种类型：

- **GitHub 仓库** — 指定仓库名、分支和子目录
- **skills.sh 源** — 社区市场
- **本地目录** — 文件系统中的任意目录

### 设置

- 默认安装模式（符号链接/复制）
- GitHub Token 配置（用于 API 限频提升）
- 各 AI Agent 平台的路径自定义
- 界面主题（浅色/深色/跟随系统）
- 主题色系（雾霾蓝/烟熏紫/豆沙绿/杏色橙/青碧色等莫兰迪色系）
- 字体大小、动画偏好、紧凑模式
- 自定义背景图片
- AI 翻译模型配置（用于技能内容的翻译）

## 架构

```
src/
├── views/            页面视图（8 个路由页面）
│   ├── MySkills/     我的技能库
│   ├── SkillStore/   技能商店（列表 + 详情）
│   ├── ProjectSkills/ 项目技能管理
│   ├── AgentSkills/   Agent 平台技能（列表 + 详情）
│   ├── Sources/      商店源管理
│   └── Settings/     设置页面
├── components/       共享组件（15 个）
│   ├── Modal 家族     AddProjectModal / SkillDetailModal / ConfirmModal 等
│   ├── AppToast      全局 Toast 提示
│   ├── DownloadIndicator 下载进度指示器
│   ├── PlatformIcon  平台图标
│   ├── QuickSwitcher 快捷切换
│   └── ...           编辑器、选择器等
├── composables/      Vue 组合式函数
│   ├── useSettings   设置读写与持久化
│   ├── useProjectState 项目状态管理
│   └── useDownloadQueue 下载队列
├── utils/            工具函数（9 个）
│   ├── storage.ts    本地存储（localStorage 封装）
│   ├── ai.ts         AI 翻译与模型调用
│   ├── theme.ts      主题切换
│   ├── github.ts     GitHub API 调用
│   ├── frontmatter.ts SKILL.md 解析
│   ├── skill-registry.ts 技能注册表
│   ├── skills-sh.ts  skills.sh API 客户端
│   ├── source-info.ts 来源信息
│   └── translate.ts  翻译服务
├── data/             静态数据
│   ├── platforms.ts   AI Agent 平台定义
│   ├── ai-providers.ts AI 提供方配置
│   └── skill-categories.ts 技能分类
└── types.ts          全部 TypeScript 类型定义

public/
├── plugin.json       ZTools 插件配置（4 个 feature / 命令词）
└── preload/
    └── services.js   Node.js 桥接层（30+ 方法）
```

## 平台支持

自动检测以下 AI Agent 平台的安装位置，支持一键分发技能：

| 平台 | 类型 |
|---|---|
| Claude Code | 官方 |
| OpenAI Codex | 官方 |
| Cursor | 官方 |
| Windsurf | 官方 |
| Cline | 社区 |
| Gemini | 官方 |
| Trae | 社区 |
| Cherry Studio | 社区 |
| Kiro | 社区 |
| 及其他社区客户端 | — |

## 技术栈

- **框架** Vue 3 + TypeScript
- **构建** Vite 6
- **编辑器** CodeMirror 6（支持 YAML / JSON / Markdown / Python / JS / CSS / HTML 语法高亮）
- **后端** ZTools Preload 机制（Node.js 桥接）
- **包管理** pnpm

## 说明

- 源代码由 AI 辅助生成，本人负责功能设计、使用与持续维护。
- 详细开发约束与项目规范见 `AGENTS.md`。
