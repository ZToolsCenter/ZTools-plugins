# ZapApi

一个面向 ZTools 的 API 调试插件，提供类似 Postman 的请求构建、响应查看与多标签调试体验。

## 功能概览

- 多标签页请求编辑与切换（支持复制、重命名、批量关闭）
- HTTP 请求构建（Method、URL、Params、Headers、Body、Auth）
- Socket 调试（WS / TCP / UDP）
- 响应查看（状态、耗时、大小、Headers、Body、Raw、Cookies）
- 集合与历史记录管理
- 环境变量管理与变量插值
- 全局快捷键与快捷键面板
- 首次引导（Onboarding）
- 中英繁三语支持

## 截图预览

### 主界面

![主界面](images/main-interface.png)

### 环境变量管理

![环境变量](images/env-variables.png)

### 图片预览

![图片预览](images/image-preview.png)

## 技术栈

- Vue 3 + TypeScript + Vite
- vue-i18n
- driver.js（引导流程）
- ZTools API Types

## 项目结构

```text
.
├── public/
│   ├── logo.svg
│   ├── plugin.json
│   └── preload/
│       ├── package.json
│       └── services.js
├── src/
│   ├── components/
│   ├── composables/
│   ├── i18n/
│   ├── store/
│   ├── utils/
│   ├── App.vue
│   ├── main.css
│   └── main.ts
├── index.html
├── package.json
└── README.md
```

## 本地开发

### 1) 安装依赖

```bash
pnpm install
```

### 2) 启动开发服务

```bash
pnpm run dev
```

默认地址为 `http://localhost:5173`，可通过 `public/plugin.json` 中的 `development.main` 被 ZTools 加载。

### 3) 构建

```bash
pnpm run build
```

构建包含类型检查（`vue-tsc`）与打包（`vite build`）。

## 插件配置

核心配置位于 `public/plugin.json`：

- `main`: 插件入口页面
- `preload`: Node 能力注入脚本
- `logo`: 插件图标（当前为 `logo.svg`）
- `features`: 插件功能与指令触发配置

## 快捷键（默认）

- `?`：打开快捷键面板
- `Ctrl/Cmd + ,`：打开设置
- `Ctrl/Cmd + Shift + H`：重播引导
- `Ctrl/Cmd + Alt + T`：新建标签
- `Ctrl/Cmd + Alt + W`：关闭当前标签
- `Ctrl/Cmd + D`：复制当前标签
- `Ctrl/Cmd + Shift + ] / [`：切换标签
- `Ctrl/Cmd + Enter`：发送请求 / 连接 Socket
- `Ctrl/Cmd + S`：保存请求
- `Esc`：取消发送
- `Ctrl/Cmd + B`：切换侧栏
- `Ctrl/Cmd + K`：聚焦 URL 输入框

## 交互特性说明

- 标签页支持 Dirty 状态标识（未保存时显示提示点）
- 点击标签可快捷弹出操作菜单（关闭当前/其他/右侧、复制、重命名）
- 请求头 Key/Value 自动补全在选择后仍保留完整候选列表

## 国际化

语言资源位于：

- `src/i18n/locales/zh-CN.ts`
- `src/i18n/locales/zh-TW.ts`
- `src/i18n/locales/en.ts`

## 常见命令

```bash
pnpm run dev
pnpm run build
```

## License

MIT
