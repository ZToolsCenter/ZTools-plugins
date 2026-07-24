# 起个变量名

> 一个使用百度翻译生成变量名称的 ZTools 插件

这是一个使用 **Vue 3 + Vite + JavaScript** 构建的 ZTools 插件。

## ✨ 功能特性

### 📌 核心功能

- **智能变量名生成** - 使用百度翻译 API 将中文描述转换为多种格式的变量名
  - 触发指令：`翻译` / `fy`
  - 支持多种变量名格式：小驼峰、大驼峰、下划线、中划线、常量、句子、小写、大写
  - 自动过滤标点符号和特殊字符

- **实时翻译与点击翻译双模式**
  - 实时翻译模式：输入内容自动翻译（可配置延迟时间）
  - 点击翻译模式：手动点击按钮或按回车翻译

- **本地配置保存**
  - 百度翻译 APP ID 和密钥自动保存到本地
  - 翻译模式和延迟时间持久化配置
  - 支持通过设置抽屉随时修改配置

## 📁 项目结构

```
.
├── public/
│   ├── logo.png              # 插件图标
│   ├── plugin.json           # 插件配置文件
│   └── preload/              # Preload 脚本目录
│       ├── package.json      # Preload 依赖配置
│       └── services.js       # Node.js 能力扩展
├── src/
│   ├── main.ts               # 入口文件
│   ├── main.css              # 全局样式
│   ├── App.vue               # 根组件
│   ├── Hello/                # 主功能组件
│   │   └── index.vue
│   ├── components/           # 通用组件
│   │   └── SettingDrawer.vue # 设置抽屉组件
│   └── utils/                # 工具函数
│       ├── config.js         # 配置管理
│       └── copy-content.js   # 复制内容工具
├── index.html                # HTML 模板
├── vite.config.js            # Vite 配置
├── package.json              # 项目依赖
└── README.md                 # 项目文档
```

## 🚀 快速开始

### 安装依赖

```bash
bun install
```

### 开发模式

```bash
bun run dev
```

开发服务器将在 `http://localhost:5173` 启动。ZTools 会自动加载开发版本。

### 构建生产版本

```bash
bun run build
```

构建产物将输出到 `dist/` 目录。

## 📖 使用说明

### 1. 配置百度翻译 API

1. 打开插件后，点击输入框右侧的设置图标
2. 输入你的百度翻译 APP ID 和密钥
3. 选择翻译模式（实时翻译或点击翻译）
4. 如果是实时翻译模式，可以配置延迟时间

### 2. 生成变量名

1. 在输入框中输入中文描述（例如："用户信息"）
2. 根据选择的翻译模式，系统会自动或手动翻译
3. 查看生成的多种变量名格式
4. 点击任意结果即可复制到剪贴板

### 3. 获取百度翻译 API 密钥

访问 [百度翻译开放平台](https://fanyi-api.baidu.com/manage/developer) 注册并获取 APP ID 和密钥。

## 🎨 技术栈

- **Vue 3** - 使用 Composition API 和 `<script setup>` 语法
- **Vite** - 快速的构建工具
- **Naive UI** - 现代化的 Vue 3 组件库
- **MD5** - 用于百度翻译 API 签名
- **ZTools API** - 插件平台能力集成

## 📦 构建与发布

### 1. 构建插件

```bash
bun run build
```

### 2. 测试构建产物

将 `dist/` 目录中的所有文件复制到 ZTools 插件目录进行测试。

## 📚 相关资源

- [ZTools 官方文档](https://github.com/ztool-center/ztools)
- [ZTools API 文档](https://github.com/ztool-center/ztools-api-types)
- [Vue 3 文档](https://vuejs.org/)
- [Vite 文档](https://vitejs.dev/)
- [百度翻译 API 文档](https://fanyi-api.baidu.com/doc/21)

## 📄 开源协议

MIT License

---

**祝你开发愉快！** 🎉
