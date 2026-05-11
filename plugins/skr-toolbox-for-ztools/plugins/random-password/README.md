# random-password

轻量的 ZTools 随机密码插件，支持按规则生成高强度密码并自动复制到剪贴板。

## 项目简介

`random-password` 使用 `Vue 3 + TypeScript + Vite + Naive UI` 开发，面向 ZTools 插件场景。

当前插件只包含一个功能入口：

- 功能编码：`password`
- 触发指令：`随机密码` / `password` / `pwd`

## 功能特性

- 支持密码长度设置（`8` 到 `64`）
- 支持字符类型组合：大写、小写、数字、符号
- 支持自定义符号集（默认 `!@#$%^&`）
- 支持排除易混淆字符（`O/0/I/l/1`）
- 强度实时评估（弱 / 中 / 强）
- 生成后自动复制，失败时可手动复制
- 设置自动持久化（ZTools 环境下用 `dbStorage`，Web 预览下回退到 `localStorage`）
- 亮色/暗色主题自适应

## 安全实现说明

- 使用 `crypto.getRandomValues` 生成随机数
- 通过 rejection sampling 避免取模偏差
- 生成逻辑保证每个启用的字符类型至少出现一次

## 技术栈

- Vue 3
- TypeScript
- Vite
- Naive UI
- `@ztools-center/ztools-api-types`

## 目录结构

```text
.
├── public/
│   ├── logo-v2.png
│   └── plugin.json
├── src/
│   ├── Password/
│   │   └── index.vue        # 密码生成核心页面与逻辑
│   ├── App.vue              # 插件入口，监听 onPluginEnter/onPluginOut
│   ├── env.d.ts             # ZTools API 类型声明
│   ├── main.css
│   └── main.ts
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.js
└── README.md
```

## 开发与构建

### 1. 安装依赖

```bash
npm install
```

### 2. 本地开发（Web 预览）

```bash
npm run dev
```

默认地址：`http://localhost:5173`

说明：

- 在纯 Web 环境下，插件会走降级逻辑（无 `window.ztools`）
- 可以完整验证生成规则、强度评估、主题切换和本地存储

### 3. 构建

```bash
npm run build
```

构建产物输出到 `dist/`。

## 在 ZTools 中调试

`public/plugin.json` 已配置开发入口：

```json
"development": {
  "main": "http://localhost:5173"
}
```

建议流程：

1. 启动 `npm run dev`
2. 在 ZTools 中加载本插件目录
3. 通过 `随机密码` / `password` / `pwd` 触发插件
4. 验证自动复制与通知提示是否正常

## 插件配置

核心配置位于 [public/plugin.json](./public/plugin.json)：

- 元信息：`name`、`title`、`description`、`author`、`version`
- 主入口：`main`
- 功能列表：`features`

如果你调整了命令词或功能编码，请同步检查：

- `public/plugin.json` 中的 `features[].code` / `cmds`
- [src/App.vue](./src/App.vue) 中的路由分发逻辑

## 常见问题

### 1. 生成成功但没有复制

- 可能是当前环境不支持或禁止剪贴板访问
- 插件已提供“手动复制”按钮作为兜底

### 2. 为什么在浏览器里也能跑

`App.vue` 会检测 `window.ztools` 是否存在：

- 存在：走 ZTools 生命周期（`onPluginEnter` / `onPluginOut`）
- 不存在：自动进入 `password` 页面，方便本地调试

### 3. 设置保存在哪里

- ZTools 环境：`ztools.dbStorage`
- Web 环境：`localStorage`（key 为 `random-password:settings:web`）

## License

MIT
