# 远程桌面管理

> ZTools 插件 —— 管理 Windows 远程桌面，快捷开启远程连接

## 项目简介

本项目是一个 [ZTools](https://github.com/ZToolsCenter/ZTools) 插件。

本插件用于集中管理常用的 Windows 远程桌面主机信息，支持一键发起远程连接，避免每次手动输入 IP、用户名和密码。

## 功能特性

- **主机管理** —— 支持新增、编辑、删除远程主机记录
- **字段定义** —— 每条记录包含编号（唯一标识，支持中文）、地址/域名、用户名、密码
- **一键连接** —— 点击连接按钮，自动生成 RDP 配置文件并调用 `mstsc.exe` 发起远程桌面连接
- **凭据存储** —— 使用 `cmdkey` 预存 Windows 凭据，实现免密连接体验
- **搜索筛选** —— 支持按编号实时搜索筛选列表
- **数据持久化** —— 主机列表通过 ZTools 数据库 API 存储，每个主机作为独立文档，以插件名称隔离
- **密码加密** —— 密码使用 `AES-256-CBC` 加密存储，每次加密使用随机 IV，并兼容旧版本 base64 数据

## 技术栈

- **Vue 3** —— 前端框架
- **Vite** —— 构建工具
- **TypeScript** —— 类型安全

## 项目结构

```
.
├── public/
│   ├── logo.png                # 插件图标
│   ├── plugin.json             # 插件配置文件（名称、指令、入口等）
│   ├── index.html              # 开发模式入口（加载 localhost:5173）
│   └── preload/
│       ├── package.json        # Preload 依赖配置
│       └── services.js         # Node.js 能力扩展（RDP 连接、主机 CRUD）
├── src/
│   ├── main.ts                 # Vue 应用入口（含浏览器开发 mock）
│   ├── main.css                # 全局样式
│   ├── App.vue                 # 根组件
│   ├── env.d.ts                # 类型声明（window.services / window.ztools）
│   └── RemoteManager/
│       └── index.vue           # 主界面组件（工具栏、表格、弹窗）
├── index.html                  # Vite 入口 HTML 模板
├── vite.config.js              # Vite 配置
├── tsconfig.json               # TypeScript 配置
├── package.json                # 项目依赖
└── README.md                   # 项目文档
```

## 核心文件说明

### `public/plugin.json`

ZTools 插件配置文件，定义插件名称、触发指令、入口文件、preload 脚本等。

### `public/preload/services.js`

向渲染进程注入 Node.js 能力的 Preload 脚本，提供以下服务：

| 方法 | 说明 |
|------|------|
| `getHosts()` | 读取已保存的主机列表 |
| `addHost(host)` | 新增主机（编号唯一性校验） |
| `updateHost(originalId, host)` | 编辑主机 |
| `deleteHost(id)` | 删除主机 |
| `connectRdp(address, username, password)` | 生成临时 RDP 文件，使用 `cmdkey` 存储凭据，调用 `mstsc.exe` 连接，5秒后清理凭据和临时文件 |

数据存储使用 ZTools 数据库 API（`window.ztools.db`）：
- 每个主机作为一条独立文档，`_id` 即为主机编号
- 密码通过 `AES-256-CBC` 加密后保存，格式为 `enc:<iv>:<encrypted>`
- 连接时自动解密，并保留对旧版本 `base64` 编码数据的兼容

### `src/RemoteManager/index.vue`

插件主界面组件，包含：

- **工具栏** —— 插件标题、搜索框、新增主机按钮
- **主机列表** —— 表格展示，支持 hover 高亮
- **操作列** —— 每行末尾提供「连接」「编辑」「删除」按钮
- **弹窗表单** —— 新增/编辑主机时弹出的模态框，含编号、地址、用户名、密码输入
- **提示消息** —— 操作成功或失败的临时 Toast 提示

### `src/main.ts`

Vue 应用入口。在开发模式下（`import.meta.env.DEV`）注入 `window.ztools` 和 `window.services` 的 mock 对象，使插件可以在浏览器中独立预览，无需依赖 ZTools 环境。

## 使用方式

1. 在 ZTools 中输入触发指令：`远程桌面`、`rdp` 或 `远程连接`
2. 进入插件后点击「新增主机」填写信息
3. 在列表中点击「连接」按钮，即可自动打开 Windows 远程桌面客户端

## 相关资源

- [ZTools 官方文档](https://github.com/ZToolsCenter/ZTools)
- [ZTools API 文档](https://github.com/ZToolsCenter/ztools-api-types)

## 开源协议

MIT License

---

**声明：本项目代码大部分由 AI 辅助生成。**

