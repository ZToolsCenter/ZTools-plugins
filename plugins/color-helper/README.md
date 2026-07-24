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

- Node.js 16+
- npm 或 yarn

### 安装与运行

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建生产版本
npm run build

# 预览构建结果
npm run preview
```

## 项目结构

```
├── assets/                  # 静态资源（色卡封面图）
├── context/
│   └── AppContext.tsx        # 全局上下文
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
│   ├── color.ts             # 颜色处理
│   ├── platform.ts          # 平台 API 适配层
│   ├── quantize.ts          # 颜色量化算法
│   └── storage.ts           # 存储工具
├── App.tsx                  # 应用入口组件
├── main.tsx                 # 渲染入口
├── index.html               # HTML 模板
├── index.css                # 全局样式
├── vite.config.ts           # Vite 配置
├── tsconfig.json            # TypeScript 配置
└── package.json             # 项目配置
```

## 技术栈

| 技术 | 用途 |
|------|------|
| React 18 | UI 框架 |
| TypeScript | 类型安全 |
| Vite 4 | 构建工具 |
| MUI 5 | UI 组件库 |
| chroma-js | 颜色空间转换与计算 |
| iro.js | 色轮选择器 |

## 核心功能说明

### 颜色转换

支持 HEX、RGB、HSL、HSV、HSI、CMYK、LAB 多种颜色格式的相互转换，提供色轮选择器与饱和度/明度滑块，并基于当前颜色生成互补色、类似色、三角色、四角色等和谐方案。

### AI 配色

基于用户选择的主色，结合风格、色系、配色数量等参数，调用 AI 模型生成配色方案，每个配色包含色值、名称和描述。

### 图片色卡

从图片中提取主要颜色，支持截图、本地图片导入，使用中位切分（Median Cut）量化算法进行颜色聚类，可生成色卡图片并复制导出。

### UI 色卡

内置 Material Design、Ant Design、Fluent、Flat UI、Open Color 五套主流 UI 设计系统的完整色板，方便查阅和取用。

### 传统色

收录故宫二十四节气相关的 384 种中国传统色和 465 种日本传统色，每种颜色附带名称与色值。

### 渐变色

提供多组精选渐变色方案，支持一键复制 CSS 渐变代码。

### 平台适配

通过 `utils/platform.ts` 统一适配层，支持插件平台 API（屏幕取色、截图、剪贴板、AI、存储等），同时在浏览器环境中提供 fallback 实现，确保独立运行时功能可用。
