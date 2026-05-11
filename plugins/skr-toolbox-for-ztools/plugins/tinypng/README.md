# TinyPNG 压缩图片

> 从 [utools-plugin-tinypng](https://github.com/nicepkg/utools-plugin-tinypng) 移植的 ZTools 插件

使用 TinyPNG Web API 批量压缩 PNG/JPEG/WebP 图片，无需 API Key。

## 功能

- 拖拽图片或文件夹到插件窗口进行压缩
- 通过 ZTools 搜索框匹配图片文件触发压缩
- 支持 PNG、JPEG、WebP 格式
- 并发压缩（最多 3 个任务同时进行）
- 压缩完成后可复制结果或覆盖原文件
- 支持暗色模式

## 技术栈

- Vue 3 + TypeScript + Vite
- Element Plus（UI 组件）
- Axios（HTTP 请求）
- dayjs（时间处理）

## 移植说明

本插件从 uTools 平台移植到 ZTools 平台，主要改动：

- `utools.*` API 全部替换为 `window.ztools.*`
- `window.preload.*` 替换为 `window.services.*`
- Preload 脚本从 TypeScript ES Modules 改为 CommonJS
- 拖拽文件路径获取改用 `window.ztools.getPathForFile()`
- 本地图片路径使用 `file:///` 协议加载
- 覆盖 Element Plus 默认字体为系统字体

## 项目结构

```
├── public/
│   ├── plugin.json          # 插件配置
│   ├── logo.png             # 插件图标
│   └── preload/
│       ├── package.json
│       └── services.js      # Node.js 文件操作服务
├── src/
│   ├── main.ts              # 入口
│   ├── App.vue              # 根组件（拖拽处理）
│   ├── style.css            # 全局样式
│   ├── types.d.ts           # 类型声明
│   ├── env.d.ts             # Vite/ZTools 类型引用
│   ├── assets/
│   │   └── iconfont.js      # 图标字体
│   ├── components/
│   │   ├── compress-list.vue # 压缩列表（核心逻辑）
│   │   ├── compress-item.vue # 单个压缩项
│   │   ├── tab.vue          # 标签页
│   │   └── icon.vue         # SVG 图标
│   └── utils/
│       └── index.ts         # 工具函数
├── index.html
├── vite.config.js
├── tsconfig.json
└── package.json
```

## 开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

## 协议

MIT
