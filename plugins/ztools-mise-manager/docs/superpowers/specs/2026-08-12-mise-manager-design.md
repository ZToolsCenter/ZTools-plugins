# ZTools Mise 可视化管理插件 — 设计文档

日期: 2026-08-12
状态: 已批准（用户确认方案 A）

## 1. 目标

在 ZTools 中以可视化方式管理 mise（开发工具版本管理器）：查看已安装工具与版本、安装/卸载/切换、浏览工具市场、管理项目配置。

## 2. 环境事实（已验证）

- 宿主: Windows 10 + mise 2026.8.4（WinGet 安装，`C:\Users\t\AppData\Local\Microsoft\WinGet\Links\mise.exe`）
- mise 全局配置: `C:\Users\t\.config\mise\config.toml`（node 22 / python 3.13 / java x3 / maven / dotnet / pnpm）
- 已安装工具安装目录: `C:\Users\t\AppData\Local\mise\installs\<tool>\<version>`
- 关键命令均支持 `--json` 结构化输出: `mise ls --json`、`mise ls-remote --json <tool>`、`mise registry --json`（已验证）
- `mise outdated` 输出文本（"All tools are up to date" 或过时列表）
- `mise tool <name>` 输出文本详情（Backend/Installed/Active/Requested/Config Source/Security）
- mise 为 Rust 程序，stdout 为 UTF-8；保留 iconv-lite 兜底解码（继承 node-manager 经验）

## 3. 架构

单插件应用（方案 A），React + TypeScript + Vite 构建，产物 `dist/` 即插件应用。

```
ztools-mise-manager/
├── plugin.json            # 插件配置（dist 由 public/ 复制）
├── preload.js             # Node 桥层 window.miseManager（dist 由 public/ 复制）
├── logo.png               # 插件图标
├── package.json           # preload 同级依赖（type: commonjs + iconv-lite）
├── index.html             # 入口
└── assets/*.js/css        # Vite 构建产物
```

### 3.1 数据流

```
React UI ──调用──> window.miseManager ──exec/spawn──> mise.exe <cmd> --json
                          │
                          └── 解析 JSON / 降级文本解析 ──> Promise 结果
```

### 3.2 preload.js API（window.miseManager）

| 方法 | 底层命令 | 说明 |
|---|---|---|
| `getSystemInfo()` | `mise --version` / `mise settings` | mise 版本、配置路径 |
| `getInstalledTools()` | `mise ls --json` | 工具→版本列表（version/requested/active/install_path/source） |
| `getToolInfo(tool)` | `mise tool <tool>` | 工具详情文本 |
| `getRemoteVersions(tool, query)` | `mise ls-remote --json <tool>` | 远程可装版本（前端过滤） |
| `install(tool, version, onProgress)` | `mise install <tool>@<version>` | spawn 流式进度 |
| `uninstall(tool, version)` | `mise uninstall <tool>@<version>` | 卸载 |
| `setGlobal(tool, version)` | `mise use -g <tool>@<version>` | 全局切换 |
| `setProject(tool, version)` | `mise use <tool>@<version>` | 写入项目 .mise.toml（需 cwd） |
| `getOutdated()` | `mise outdated` | 过时列表（文本解析 + 降级） |
| `upgrade(tool?)` | `mise upgrade <tool>` | 升级 |
| `getRegistry(query)` | `mise registry --json` | 工具市场（前端搜索过滤） |
| `getConfigFiles()` | `mise config` | 配置文件清单 |
| `readConfigFile(path)` / `saveConfigFile(path, content)` | fs | 查看/编辑 .mise.toml |
| `selectFolder()` | `ztools.showOpenDialog` | 选择项目目录 |
| `getProjects()` / `saveProjects(list)` | fs projects.json | 收藏项目 |
| `openInstallDir(tool, version)` | `ztools.shellOpenPath` | 打开安装目录 |
| `notify(title, body)` | `ztools.showNotification` | 通知 |

### 3.3 编码与错误处理

- 输出统一先按 UTF-8 解码；Windows 下若出现 replacement char，用 iconv-lite GBK 兜底重解
- `mise` 不在 PATH → `getSystemInfo` 返回 `{ missing: true }`，UI 显示安装指引（winget install jdx.mise / 官网）
- 命令非零退出 → reject 携带 stderr 摘要
- 安装长任务: spawn + 逐行回传日志，解析 `x%` 进度

### 3.4 UI（4 视图 + 状态栏）

1. **仪表盘**: 工具卡片网格（图标/名称/激活版本徽章/已装数/过时提示），顶部状态栏（mise 版本、配置路径、工具数）；支持关键字过滤
2. **工具管理**: 选中工具后两栏——已装版本（激活标记，操作: 切换全局/打开目录/卸载）+ 远程版本（搜索过滤，操作: 安装）
3. **工具市场**: 搜索框 + 注册表列表（`mise registry --json`），每行一键安装（latest）
4. **项目配置**: 收藏项目列表 + 选择目录；读取/编辑 `.mise.toml`；展示全局配置（`mise settings`）

快速指令（plugin.json features + onPluginEnter）:
- 正则 `mise 装 <tool>@<version>`、`mise 切 <tool>@<version>` → 快速安装/全局切换 + 通知
- 文本 `mise`、`mise管理`、`mise版本` → 打开插件

### 3.5 数据持久化

- `projects.json`: 收藏项目列表（preload 同级）
- 不做镜像源管理（mise 镜像源场景少，YAGNI，留给后续）

## 4. 验证方式

- 本地 `npm run build` 构建通过
- 在 ZTools 中以 dev 模式加载 dist/，逐视图手工验证（真机 mise 环境）
- 核心命令已在设计阶段真机验证输出格式

## 5. 明确不做（YAGNI）

- 不封装 shims/环境变量管理（Windows 上 mise 行为有限制）
- 不做镜像源 UI（mise 下载走 GitHub，用户可自行 settings）
- 不做 mise 任务（tasks）管理
