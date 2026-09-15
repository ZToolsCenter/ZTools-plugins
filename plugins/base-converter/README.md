# 进制转换（base-converter）

> 简洁的数据进制转换，比如十进制转二进制、八进制、十六进制等

这是一个使用 **Vue 3 + Vite + TypeScript** 构建的 ZTools 插件，功能逻辑移植自 uTools 插件「进制助手」。

## ✨ 功能特性

- **进制转换** - 触发指令：`进制` / `转换` / `jz` / `进制转换` / `jzzh`
  - 在子输入框中输入待转换的数字
  - 支持 **2 - 36 任意进制**互转：可自由指定输入进制和目标进制
  - 同时固定展示 **二进制 / 八进制 / 十进制 / 十六进制** 四种常用进制的转换结果
  - 每个结果均可一键 **COPY** 到剪贴板（复制成功按钮变绿 0.8 秒）
  - 非法输入（无法按指定进制解析）时结果显示为空

## 📁 项目结构

```
.
├── src/
│   ├── main.ts               # 入口文件
│   ├── main.css              # 全局样式
│   ├── App.vue               # 根组件（监听插件进入、子输入框）
│   ├── env.d.ts              # 类型声明
│   └── BaseConverter/        # 进制转换功能组件
│       ├── index.vue         # 转换主界面（自定义进制 + 固定四进制结果）
│       └── ItemBlock.vue     # 单条固定进制结果块
├── public/                   # 插件静态资源（构建时原样拷入 dist）
│   ├── logo.png              # 插件图标
│   ├── plugin.json           # 插件配置文件
│   └── preload/              # Preload 脚本
├── dist/                     # 构建产物 = 完整可安装插件（gitignore）
├── index.html                # HTML 模板
├── vite.config.js            # Vite 配置
├── tsconfig.json             # TypeScript 配置
├── package.json              # 项目依赖
└── README.md                 # 项目文档
```

## 🧠 核心逻辑

转换基于 JavaScript 原生进制能力：

```ts
// 按输入进制解析，再转换为目标进制；非法输入显示为空
const result = parseInt(inputValue, fromRadix).toString(toRadix)
```

交互流程：

1. 用户通过指令进入插件，`App.vue` 中监听 `onPluginEnter`
2. 调用 `ztools.setExpendHeight(375)` 设定窗口高度
3. 调用 `ztools.setSubInput` 注册子输入框，用户输入的数字实时传入 `BaseConverter`
4. `BaseConverter` 计算自定义目标进制结果，并通过 4 个 `ItemBlock` 展示二/八/十/十六进制结果

> 注意：转换使用 `parseInt`，超出 `Number.MAX_SAFE_INTEGER`（2^53-1）的大数会丢失精度，与原插件行为一致。

## 🚀 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

开发服务器将在 `http://localhost:5173` 启动。ZTools 会自动加载开发版本。

### 构建生产版本

```bash
npm run build
```

构建产物输出到 `dist/` 目录，`public/` 下的 `plugin.json`、`logo.png`、`preload/` 会被 Vite 自动拷入，`dist/` 即为完整可安装的 ZTools 插件目录。

## 📄 开源协议

MIT License
