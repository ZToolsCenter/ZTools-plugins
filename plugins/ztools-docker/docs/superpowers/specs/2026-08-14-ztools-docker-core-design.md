# ZTools Docker Lite — 核心容器管理设计文档

- **日期**: 2026-08-14
- **状态**: 已批准（用户确认）；评审修订 v2
- **插件**: ztools-docker / Docker Lite
- **范围**: 本期只做核心容器管理（容器列表、启停操作、端口/目录映射、实时日志）。镜像搜索、Shell 终端、Compose 聚合、容器创建均留待下期。

## 1. 背景与目标

Docker Lite 是一个 ZTools 启动器插件，用 Vue 3 + Vite + TypeScript 构建。目标是**降低 Docker 的使用门槛**，让不熟悉命令行的用户能直观查看和管理本机容器。

**成功标准**：用户打开插件即可看到本机所有容器（含已停止）的运行状态、端口映射和目录挂载；可一键启停/重启；可实时查看容器日志，全程无需输入任何 docker 命令。

## 2. 架构

### 2.1 模块划分

```
public/preload/           ← Node.js 侧（唯一能调用 Docker CLI 的地方）
  ├── services.js          ← 现有文件，桥接层：挂载 window.services.docker
  └── docker.js            ← 新增：Docker 命令封装层（单一服务）
src/
  ├── App.vue              ← 路由分发（默认 containers 主页）
  ├── types.ts             ← docker 数据模型的 TS 类型
  ├── env.d.ts             ← 扩展 Services 接口：声明 docker.* 方法，删除旧 readFile/writeTextFile/writeImageFile 声明
  └── Containers/
      ├── index.vue        ← 双栏主页（组合左右两栏）
      ├── ContainerList.vue    ← 左栏：容器列表 + 状态 + 搜索/刷新
      ├── ContainerDetail.vue  ← 右栏：详情 + 端口/目录映射 + 操作
      └── ContainerLogs.vue    ← 右栏下半部：实时日志
```

**脚手架清理**：移除 `src/Hello`、`src/Read`、`src/Write` 三个示例组件及其对应 feature；`preload/services.js` 中原 `readFile`/`writeTextFile`/`writeImageFile` 示例服务一并移除。`plugin.json` 的 `features` 只保留 `containers` 入口（见 §2.4）。

### 2.2 关键边界

**所有 Docker 操作收敛在 `public/preload/docker.js` 一个服务里**，渲染层（Vue）绝不直接拼接 docker 命令。渲染层通过 `window.services.docker.*` 调用。

`services.js` 挂载方式：在 `services.js` 顶部 `const docker = require('./docker.js')`，随后 `window.services = { docker }`。渲染层调用 `window.services.docker.listContainers()`。

```js
// public/preload/docker.js —— child_process 执行 docker，统一解析
const { execFile, spawn } = require('node:child_process')

function run(args, { timeout = 15000, follow = false, onData } = {}) {
  // 非流式：execFile 收集 stdout，JSON.parse 后返回；超时 15s 防止 docker CLI 挂死
  // 流式（docker logs -f）：spawn，stdout 逐块通过 onData 吐出
}

module.exports = {
  listContainers()              // docker ps -a --format '{{json .}}' 逐行解析
  inspectContainer(id)          // docker inspect <id>，提取端口/挂载
  startContainer(id)            // docker start
  stopContainer(id)             // docker stop
  restartContainer(id)          // docker restart
  pauseContainer(id)            // docker pause
  unpauseContainer(id)          // docker unpause（与 pause 分开，UI 可明确表达）
  removeContainer(id)           // docker rm -f
  followLogs(id, onData, onError)   // docker logs -f --tail 200，返回可取消句柄
}
```

**inspect 行为**：已停止容器**跳过** `docker inspect` 调用，前端直接渲染「未运行，无端口信息」，不产生额外开销。

### 2.3 数据流

渲染层（Vue）→ `window.services.docker.*` → preload 用 `child_process` 执行 docker 命令 → 解析 JSON → 返回结果。渲染层无 Node 能力，全部走 `window.services` 桥。

### 2.4 插件入口与路由

- `plugin.json` `features` 只保留一个：

```json
{
  "code": "containers",
  "explain": "容器管理",
  "icon": "logo.png",
  "cmds": ["docker", "容器", "容器管理"]
}
```

- `App.vue` 路由逻辑：**默认 `route = 'containers'`**（无论是否通过指令进入）。`onPluginEnter` 回调中，若 `action.code` 是已注册 feature（本期只有 `containers`）则对应分发，否则保持默认主页——确保用户**从插件列表直接点开插件**（此时 `code` 为空）也能看到容器列表。

### 2.5 Docker CLI 可用性

`listContainers` 首跑时若 `docker` 命令不存在或 daemon 未启动，返回特定错误结构（`{ code: 'DOCKER_NOT_FOUND' | 'DAEMON_DOWN', message }`），UI 据此显示引导页/横幅。

## 3. 界面结构与交互

### 3.1 双栏主页布局

```
┌─────────────────────────────────────────────┐
│ ⚙ Docker Lite   [🔍 筛选]        [🔄 刷新]  │   ← 顶部工具条
├───────────────┬─────────────────────────────┤
│ 容器列表(常驻) │ 选中容器详情                │
│  ● nginx 运行中│  名称/ID/镜像/创建时间/状态 │
│   端口 80→8080 │  操作: ▶启动 ⏹停止 ⟳重启   │
│  ● mysql 已停止│  ┌─端口映射────┐            │
│  ○ redis 已停止│  │ 80→8080    │            │
│               │  └────────────┘            │
│ 点击选中       │  ┌─目录挂载────┐            │
│ 已停止置灰     │  │ /data→/v...│            │
│               │  └────────────┘            │
│               │  ┌─实时日志────────────────┐ │
│               │  │ [⏸暂停跟随] [⬇ 到底部]  │ │
│               │  │ 2026-08-14 ...GET / 200│ │
│               │  └────────────────────────┘ │
└───────────────┴─────────────────────────────┘
```

### 3.2 交互规则

- **列表数据**：进入页面拉取一次，之后**每 3 秒静默轮询** `docker ps -a`。轮询仅更新状态字段（运行/停止/暂停）与容器存在性，**不改变排序、不重建列表 DOM**，避免闪烁。顶部提供手动刷新按钮兜底。
- **筛选**：按**名称**过滤（含正则匹配的容器行），不按状态过滤；筛选不打断轮询。
- **端口/目录映射**：仅对选中且**运行中**的容器调用一次 `docker inspect`，结果缓存；切换选中容器时替换缓存。停止容器不触发 inspect（见 §2.2）。
- **操作防抖**：对同一容器的启停操作在 in-flight 期间禁用该按钮，防止快速双击重复下发命令。
- **操作后刷新**：启停/删除成功后立即刷新列表，状态变化不依赖下一次轮询。
- **删除确认**：删除按钮红色强调，需二次确认。

### 3.3 操作按钮状态矩阵

| 容器状态 | 启动 ▶ | 停止 ⏹ | 重启 ⟳ | 暂停 ⏸ | 继续 ⏵ | 删除 🗑 |
|----------|:---:|:---:|:---:|:---:|:---:|:---:|
| 运行中 | 禁用 | 可用 | 可用 | 可用 | 禁用 | 可用 |
| 已停止 | 可用 | 禁用 | 禁用 | 禁用 | 禁用 | 可用 |
| 已暂停 | 禁用 | 可用 | 可用 | 禁用 | 可用 | 可用 |

## 4. 实时日志实现（API 辅助落点）

- 流式 `spawn('docker', ['logs', '-f', '--tail', '200', id])`。
- **跟随模式**：进入即 `--tail 200` 显示最近 200 行，`-f` 持续跟随；输出含 ANSI 颜色码（`\x1b[...m`），前端用轻量正则清洗后渲染。
- **暂停跟随**：点击暂停 → `kill()` 子进程，保留已渲染行（停止滚动）。**已知取舍：恢复时不做逐行续传，统一重新 `--tail 200` 拉取——暂停窗口内的新行会随重拉一并出现，而非丢失。**
- **清理**：切换容器或退出页面时 `kill()` 未结束的子进程，避免泄漏。
- 渲染层通过 `onData(chunk)` 回调逐块推送，用 `requestAnimationFrame` 批量写 DOM，保证滚动流畅。
- 已停止容器日志面板显示「容器未运行，无日志」。

## 5. 错误处理与降级

| 场景 | 表现 |
|------|------|
| `docker` 命令不存在 | 全页引导：「未检测到 Docker，请安装 Docker Desktop 后重试」，附安装链接 |
| Docker daemon 未运行 | 顶部黄色横幅提示，容器列表显示为空态 |
| 容器操作失败（权限等） | 右上角 toast 显示 stderr 原文 |
| 轮询失败 | 静默跳过本次，连续 3 次失败才提示（避免刷屏） |
| 单次 docker 命令超时 | 走 15s 超时分支，toast 提示「操作超时」，不阻塞后续 |

## 6. 主题

跟随 ZTools 的 `isDarkColors()`，使用系统深浅两套 CSS 变量，不做主题配置。延续 `src/main.css` 已有的 light/dark media query 模式。

## 7. 本期明确不做（YAGNI）

- 镜像搜索、Shell 终端、Compose 聚合（下期）
- 容器创建/编辑、资源监控图表
- 主题换肤配置

## 8. 测试策略

- **单测（vitest）**：`npm install -D vitest` 作为本期唯一新增测试依赖，并在 `package.json` 增加 `"test": "vitest"` 脚本。docker 命令的 JSON 解析逻辑抽为**纯函数，从 `docker.js` 顶层导出**（`parseContainerList`、`parseInspect` 等；`docker.js` 是 CommonJS，vitest 可直接 import，无需额外配置），用 vitest 模拟输入字符串验证解析与错误分支。
- **UI 冒烟（Playwright）**：下期再做，本期不做。项目现有 `ztools-maven` 有 playwright 先例，留作下期参考。
- **手动验收**：本机 docker daemon 存在时，手动验收真实容器启停/日志流程（作为交付前验证步骤）。

## 9. 扩展点（下期预留）

- `docker.js` 预留镜像管理（`docker search/pull`）、compose（`docker compose ls/ps`）、exec shell（`docker exec -it`）的模块位置。
- `App.vue` 路由表预留 `images`、`compose` 等 route code。
