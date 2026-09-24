# 批量命令执行（ssh-batch-exec）

> ZTools 插件 · 基于 Vue 3 + Vite + ssh2 · 一键在多台服务器上批量执行命令

## 简介

面向运维 / 后端开发场景的本地批量命令执行工具。通过 SSH 在多台目标服务器上并发执行同一条命令，实时查看每台服务器的命令行返回，并保留历史执行记录以便回查排错。

适用于批量拉取代码、查看磁盘占用、滚动日志、重启服务、巡检机器等需要"同一命令跑多台"的场景。

## 功能特性

### 服务器管理
- 密码 / 私钥（PEM / OpenSSH）两种认证方式
- 私钥支持从本地文件导入
- 保存前可测试连接，避免错误配置带到执行时

### 命令库
- 可复用的命令模板（名称 + 命令内容）
- 点击即填充到临时命令输入框

### 快捷指令
- 一条命令 + 一组目标服务器的组合
- 一键批量执行，无需每次重复选择
- 命令来源支持从命令库选择或手动输入
- 单条指令可独立设置单台超时

### 临时命令
- 即时输入命令并指定服务器执行
- 可选并发数（1-10）
- 适合一次性任务或临时排查

### 批量执行引擎
- 并发池调度（默认并发 4）
- 单台服务器超时控制（默认 300 秒）
- 整批取消，自动回收底层 SSH 连接
- 高危命令二次确认（`rm -rf` / `mkfs` / `drop` 等关键字）
- 失败服务器一键重试
- 失败列表复制（便于批量反馈）

### 实时反馈
- 四阶段状态回报：连接中 → SSH 握手 → 登录成功 → 命令执行中
- 首页卡片实时显示进度徽标（执行中 / 成功 / 失败 / 取消）
- 终端式结果区：`user@host:port`、退出码、耗时、`stdout` / `stderr` 分区着色

### 执行记录
- 每次执行独立持久化，默认保留 10 条可自定义（1-100）
- 列表 + 展开详情，点击摘要行 toggle
- 包含命令、统计徽标、各服务器 `stdout` / `stderr` / 阶段轨迹
- 支持复制全文、清空全部

### 数据安全
- 凭据仅存于本地 ZTools 数据库，不上传任何远端
- 执行记录脱敏，不保存密码 / 私钥
- `stdout` / `stderr` 各截断 8000 字符，避免存储膨胀

## 界面布局

首页采用三栏布局，各栏独立滚动：

```
┌─────────────┬──────────────┬─────────────┐
│   服务器     │  快捷指令     │             │
│ (全选/管理)  │  命令库       │  执行结果    │
├─────────────┴──────────────┤  (跨两行)    │
│         临时命令            │             │
└────────────────────────────┴─────────────┘
```

- **栏1 服务器**：单选 / 多选目标，支持全选
- **栏2 上**：快捷指令按钮网格（点击执行，悬停看命令内容）+ 命令库按钮网格（点击填充）
- **栏2 下**：临时命令输入 + 并发设置 + 立即执行
- **栏3**：执行结果，终端式输出

子页面（顶部「‹ 返回」）：服务器管理、命令管理、快捷指令管理、执行记录。

## 环境要求

- ZTools 桌面端（运行插件）
- Node.js 依赖（preload 同级 `node_modules`，由 `ssh2` 提供 SSH 能力）
- 目标服务器：标准 SSH 服务（OpenSSH 等），支持密码或私钥认证

## 开发

### 技术栈
- **前端**：Vue 3 + Vite + TypeScript
- **本地能力**：`public/preload.js`（CommonJS，保持可读，不压缩 / 混淆 / 打包）
- **平台 API**：`window.ztools`（数据库、剪贴板、窗口、通知等）
- **数据存储**：ZTools 内置数据库（PouchDB 语义，`_id` 前缀 + `_rev` upsert）

### 目录结构

```
.
├── plugin.json              # 插件元信息（名称 / 入口 / preload / 触发指令）
├── logo.png                 # 插件图标
├── public/
│   ├── preload.js           # Node.js 本地能力（SSH 执行 / 测试连接 / 取消 / 私钥读取）
│   └── package.json         # { "type": "commonjs" }，配合 npm install ssh2
├── src/
│   ├── App.vue              # 视图栈导航
│   ├── views/
│   │   ├── HomeView.vue     # 首页（三栏布局）
│   │   └── LogView.vue     # 执行记录
│   ├── components/
│   │   ├── ServerManager.vue    # 服务器管理
│   │   ├── CommandManager.vue   # 命令管理
│   │   └── TaskManager.vue      # 快捷指令管理
│   ├── api.ts               # window.ztools / services 的延迟 Proxy + putDoc upsert
│   ├── execStore.ts         # 执行状态 reactive 单一数据源
│   ├── devMock.ts           # 浏览器调试 mock
│   └── types.ts            # 数据模型
└── vite.config.ts           # 构建时复制 plugin.json / logo / node_modules 到 dist
```

### 本地开发

```bash
# 安装依赖（包括 public 下的 ssh2）
npm install
cd public && npm install && cd ..

# 浏览器调试（启用 devMock，模拟平台 API）
npm run dev

# 构建（产物输出到 dist/，含 plugin.json / logo / preload / node_modules）
npm run build
```

### 平台开发规范要点

- `plugin.json` 必须最先定义，再实现 preload 和前端入口
- preload.js 禁止压缩 / 混淆 / 打包，必须可读；只 require，不用 ESM import
- Node.js 依赖必须与 preload.js 同级且源码可读（同级 `package.json` 声明 `"type": "commonjs"`）
- 构建产物 `dist/` 才是插件目录，不是源码根目录
- 前端依赖可打包进 JS；Node 依赖不可打包，必须以可读源码形式随插件分发
- `window.ztools.db` 为 PouchDB 语义：更新已有文档须带最新 `_rev`，否则 409 冲突
- IPC 结构化克隆无法传递 Vue reactive Proxy，写入数据库前须 `JSON.parse(JSON.stringify(doc))` 归一

## 限制

- 不支持交互式命令（如 `sudo` 需要密码、`vim`、`top` 等需 TTY 的命令）
- 建议私钥认证以提升安全性；密码会加密存储于本地数据库
- ssh2 默认不校验主机指纹，以提升首次连接的易用性（首次连接即信任）

## 触发指令

在 ZTools 主搜索框输入以下任意指令即可进入插件：

- `批量执行`
- `批量命令`
- `ssh`

## 更新日志

详见 [CHANGELOG.md](./CHANGELOG.md)。
