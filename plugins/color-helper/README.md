# 颜色助手

颜色助手复刻，仅供学习交流。

## 特性

- 多格式颜色转换（HEX / RGB / HSL / HSV / HSI / CMYK / LAB）
- AI 智能配色方案生成
- 图片色卡提取与生成
- UI 色卡浏览（Material Design / Ant Design / Fluent / Flat UI / Open Color）
- 传统色浏览（中国传统色 384 种 / 日本传统色 465 种）
- 渐变色合集浏览
- 屏幕取色
- 颜色收藏管理
- 一键复制色值，支持去 `#` 设置
- 色彩和谐方案（互补色 / 类似色 / 三角色 / 四角色）

## 快速开始

### 环境要求

- **Node.js 22+**（vite 8 要求 `^20.19.0 || >=22.12.0`；Node 21 是已 EOL 的奇数版，不在支持范围）
- **pnpm 10.33.0** —— 已写入 `package.json` 的 `packageManager` 字段，
  用 corepack 可自动锁定：`corepack enable pnpm`

> ⚠️ 本项目使用 pnpm 管理依赖，**请勿使用 npm 安装**。
> 仓库根目录的 `pnpm-lock.yaml` 为唯一锁文件（lockfileVersion 9.0）；
> npm 6 等旧版本既无法解析该 lockfile 格式，其 `prepare` 流程还会破坏 pnpm 的
> `node_modules` 软链布局。原有的过期 `package-lock.json`（lockfileVersion 3，
> 且残留 `konva`/`react-konva` 等已移除依赖）已删除。

> ⚠️ 请确认 `pnpm -v` 输出为 **10.33.0**。某些 Node 发行版会自带更高主版本的 pnpm，
> 其内置的供应链策略（`minimumReleaseAge`）会拒绝安装锁文件中较新的包，
> 且不同主版本会使用不同的虚拟 store 目录，导致 `node_modules` 被重建。

### 安装与运行

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm run dev

# 构建生产版本（会先执行 tsc 类型检查）
pnpm run build

# 预览构建结果
pnpm run preview

# 运行测试（8 个文件 / 405 条断言）
pnpm run test:run
```

### 类型检查

`pnpm run build` 中的 `tsc` 会检查 `App.tsx` / `main.tsx` / `pages` / `utils` / `types` /
`data` / `tests`（见 `tsconfig.json` 的 `include`）。`pages/ImagePalettePage.tsx` 的
`*.jpg` 导入依赖根目录的 `vite-env.d.ts`（`/// <reference types="vite/client" />`），请勿删除。

## 项目结构

```
├── assets/                  # 静态资源（色卡封面图）
├── data/                    # 颜色数据
│   ├── gradients-*.json     # 渐变色数据
│   ├── traditional-*.json   # 传统色数据
│   └── ui-*.json            # UI 色卡数据
├── pages/                   # 页面组件
│   ├── ColorPage.tsx        # 颜色转换页
│   ├── AIPalettePage.tsx    # AI 配色页
│   ├── UIPalettesPage.tsx   # UI 色卡页
│   ├── TraditionalColorsPage.tsx  # 传统色页
│   ├── GradientsPage.tsx    # 渐变色页
│   ├── ImagePalettePage.tsx # 图片色卡页
│   └── CollectColorsPage.tsx # 收藏颜色页
├── public/                  # 公共资源
│   ├── logo.png
│   ├── plugin.json          # 插件配置
│   └── preload.cjs          # 预加载脚本
├── types/
│   └── index.ts             # 类型定义
├── utils/                   # 工具函数
│   ├── color.ts             # 深浅判定与文字配色（WCAG 判据）
│   ├── collect.ts           # 收藏颜色的文档形状与写入（提示条 / 收藏页共用）
│   ├── gradient.ts          # 渐变端点几何（Canvas 导出用）
│   ├── platform.ts          # 平台 API 适配层
│   └── quantize.ts          # 颜色量化算法（Median Cut）
├── App.tsx                  # 应用入口组件
├── main.tsx                 # 渲染入口
├── index.html               # HTML 模板
├── index.css                # 全局样式
├── vite.config.ts           # Vite 配置
├── vitest.config.ts         # Vitest 配置
├── vite-env.d.ts            # Vite 客户端类型引用
├── tests/                   # 测试（8 个文件 / 405 条断言）
├── tsconfig.json            # TypeScript 配置
├── tsconfig.node.json       # Node 侧 TS 配置
└── package.json             # 项目配置
```

## 技术栈

| 技术 | 用途 |
|------|------|
| React 19 | UI 框架 |
| TypeScript 5 | 类型安全 |
| Vite 8 | 构建工具（rolldown + oxc + lightningcss） |
| Vitest 4 | 测试框架（happy-dom 环境） |
| MUI 7 | UI 组件库（Emotion 引擎，`@emotion/cache` / `@emotion/css` 为显式 peer） |
| chroma-js 3 | 颜色空间转换与计算 |
| iro.js | 色轮选择器 |
## 核心功能说明

### 颜色转换

支持 HEX、RGB、HSL、HSV、HSI、CMYK、LAB 多种颜色格式的相互转换，提供色轮选择器与饱和度/明度滑块，并基于当前颜色生成互补色、类似色、三角色、四角色等和谐方案。

### AI 配色

基于用户选择的主色，结合风格、色系、配色数量等参数，调用 AI 模型生成配色方案，每个配色包含色值、名称和描述。

### 图片色卡

从图片中提取主要颜色，支持截图、本地图片导入，使用中位切分（Median Cut）量化算法进行颜色聚类，可生成色卡图片并复制导出。四种色卡版式在 `pages/ImagePalettePage.tsx` 的 `renderColorCard` 里绘制，改动后需同步该函数上方的版式说明。

### UI 色卡

内置 Material Design、Ant Design、Fluent、Flat UI、Open Color 五套主流 UI 设计系统的完整色板，方便查阅和取用。

### 传统色

收录故宫二十四节气相关的 384 种中国传统色和 465 种日本传统色，每种颜色附带名称与色值。

### 渐变色

提供多组精选渐变色方案，支持一键复制 CSS 渐变代码。

### 收藏颜色

点击任意色块复制色值后，提示条上可直接「收藏」当前颜色（星标点亮后点击进入收藏页）；收藏页支持命名、取色器录入与删除。颜色页 HEX/RGB 等各格式的复制按钮也走同一条提示条（提示条不显示无去处的「查看」）。两个入口写入同一份 db 文档（`utils/collect.ts`），改动字段形状需同时兼顾两边。

### 平台适配

通过 `utils/platform.ts` 统一适配层，支持插件平台 API（屏幕取色、截图、剪贴板、AI、存储等），同时在浏览器环境中提供 fallback 实现，确保独立运行时功能可用。

`window.platform` 的类型声明在 `types/index.ts`，逐条对齐官方 `ztools.api.d.ts`（`@ztools-center/ztools-api-types`）。**改动适配层前请先核对官方 d.ts**，不要凭印象改签名。
