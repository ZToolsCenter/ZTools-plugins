# [Colors - ZTools 颜色助手插件](https://github.com/mekefly/colors)

一个功能强大的颜色选择和管理工具，为 [ZTools](https://github.com/ZToolsCenter/ZTools) 开发的插件。

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Vue](https://img.shields.io/badge/Vue-3.5-green.svg)
![Tailwind](https://img.shields.io/badge/Tailwind-4.2-38bdf8.svg)

## ✨ 特性

- 🎨 **色轮取色器** - 直观的 HSV 色轮，支持亮度动态调整
- 🔄 **多格式支持** - HEX、RGB、HSV、HSL 等常用颜色格式
- 🎯 **和谐色生成** - 互补色、对比色、类似色、中差色自动计算
- 📋 **一键复制** - 点击即可复制颜色值，带系统通知反馈
- 🔍 **高对比度指示器** - 智能边框颜色，确保在任何背景下都清晰可见
- 💾 **即将推出** - AI配色、UI色卡库、图片取色、渐变色生成等

## 🚀 快速开始

### 环境要求

- Node.js >= 20.0.0

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm dev
```

开发服务器将在 `http://localhost:5173` 启动，支持热重载。

### 生产构建

```bash
npm build
```

构建产物将输出到 `dist/` 目录，可直接作为 ZTools 插件使用。

### 类型检查

```bash
npm type-check
```

## 📦 项目结构

```
colors/
├── public/
│   ├── preload/
│   │   ├── package.json          # Preload 脚本依赖
│   │   └── services.js           # Node.js 能力服务
│   ├── favicon.ico               # 网站图标
│   ├── logo.png                  # 插件 Logo
│   └── plugin.json               # ZTools 插件配置 ⭐
├── src/
│   ├── components/
│   │   ├── ColorWheel.vue        # 色轮取色器组件
│   │   ├── ColorSlider.vue       # 饱和度/明度滑块
│   │   ├── ColorFormats.vue      # 颜色格式显示与复制
│   │   └── HarmonyColors.vue     # 和谐色生成组件
│   ├── utils/
│   │   ├── notification.ts       # ZTools 通知工具
│   │   └── copy.ts               # 剪贴板复制工具
│   ├── App.vue                   # 根组件（插件生命周期管理）
│   ├── main.ts                   # 应用入口
│   └── input.css                 # Tailwind CSS 入口
├── dist/                         # 构建输出目录
├── index.html                    # HTML 入口
├── vite.config.ts                # Vite 配置
├── tsconfig.json                 # TypeScript 配置
└── package.json                  # 项目依赖
```

## 🛠️ 技术栈

- **框架**: Vue 3.5.x (Composition API + `<script setup>`)
- **样式**: Tailwind CSS 4.2.2
- **构建**: Vite 8.0.10 采用最近发布的vite8作为代码打包器
- **语言**: TypeScript ~6.0.0 采用最近发布的ts6引擎
- **颜色处理**: colord 2.9.3
- **工具库**: @vueuse/core
- **包管理**: npm

## 📖 核心功能说明

### 色轮取色器 (ColorWheel)

- 使用 Canvas 2D API 绘制 HSV 色轮
- 支持鼠标拖动取色
- 色轮亮度随当前颜色的 V 值动态调整
- 取色器指示器使用智能边框颜色（黑/白），确保最大对比度
- 位置计算精确，圆圈中心跟随鼠标

### 颜色格式 (ColorFormats)

- 实时显示 HEX、RGB、HSV、HSL 四种格式
- 点击复制按钮一键复制颜色值
- 集成 ZTools 系统通知反馈

### 和谐色 (HarmonyColors)

- 基于色相旋转算法生成和谐色
- 支持互补色（180°）、对比色（150°）、类似色（30°）、中差色（90°）
- 悬停显示颜色值，点击即可复制

## 📝 待办事项

- [ ] UI 色卡库（Flat UI、Material Design 等）
- [ ] 图片取色功能
- [ ] 传统色系（中国传统色、日本传统色）
- [ ] 渐变色生成与管理
- [x] 颜色收藏功能
- [ ] 颜色历史记录
- [x] CMYK、HSI、CIE-LAB 格式支持

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

MIT License

## 🔗 相关链接

- [ZTools 主项目](https://github.com/ZToolsCenter/ZTools)
- [ZTools 开发者文档](https://ztoolscenter.github.io/ZTools-doc/)
- [Vue 3 文档](https://vuejs.org/)
- [Tailwind CSS 文档](https://tailwindcss.com/docs)
- [Vite 文档](https://vite.dev/)
