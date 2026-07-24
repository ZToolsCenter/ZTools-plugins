# ZTools 插件：VSCode 最近项目（vsc-recent）— 设计文档

- 作者：Claude + 用户协作
- 日期：2026-05-21
- 状态：草稿，待用户审阅

## 1. 目标

在 ZTools 中提供一个轻量插件，关键字 **`vsc`** 唤起，列表展示 VSCode 最近打开过的文件夹 / workspace / 远程会话。用户键盘上下移动、回车或鼠标点击选中后，用本机 PATH 上的 `code` 命令在 VSCode 中打开该项目，插件随即隐藏。

非目标见 §11。

## 2. 用户故事

- 作为 VSCode 重度用户，我每天在 5–10 个项目之间切换。我希望按 `Alt+Space` 唤起 ZTools，输入 `vsc`，回车，在两次方向键之内回车打开目标项目 —— **比** VSCode 自带 `File > Open Recent` 更快、不用先启动 VSCode。

## 3. 功能性需求 (FR)

| FR | 描述 |
|----|------|
| FR-1 | ZTools 主搜索框输入 `vsc` 回车后进入插件 |
| FR-2 | 进入后立即展示一个可滚动列表，每行：**主标题**（项目名）+ **副标题**（完整路径，`~` 缩写 home）|
| FR-3 | 列表来自 VSCode Stable 的最近打开历史，按 VSCode 原始顺序（最近的在最上） |
| FR-4 | 展示三类条目：本地文件夹、`.code-workspace` 多根工作区、Remote/WSL URI |
| FR-5 | 本地路径若 `fs.existsSync === false` 则过滤掉；Remote 条目无法可靠探测，全部保留 |
| FR-6 | 子搜索框（ZTools 顶部输入框）输入文本时，列表用**模糊匹配**（fuse.js）实时过滤；匹配同时考虑主标题与副标题 |
| FR-7 | 键盘 `↑` `↓` 移动高亮，`Enter` 选中；鼠标单击同样选中；高亮项始终自动滚动到可视区 |
| FR-8 | 选中后 `spawn('code', [argFor(item)], { detached: true, shell: true })` 启动 VSCode，再调用 `ztools.outPlugin()` 隐藏插件 |
| FR-9 | 若 `code` 命令缺失或启动失败，用 `ztools.showNotification` 提示用户检查 PATH 中是否有 `code`/`code.cmd` |

## 4. 非功能性需求 (NFR)

| NFR | 描述 |
|-----|------|
| NFR-1 | 列表渲染应在 100ms 内完成（最近列表通常 ≤ 200 条） |
| NFR-2 | 模板：**Preload Only (TypeScript)**。**禁止打包/混淆** preload，保持源码可读（ZTools 强制要求） |
| NFR-3 | 不引入需要按 Electron ABI 预编译的原生模块（避免 ZTools 升级 Electron 时插件失效） |
| NFR-4 | 数据源为只读访问，**绝不写入** VSCode 的 storage 文件 |
| NFR-5 | 跨 VSCode 版本兼容：用"多源探测"（§7.3）而不是硬编码单一存储路径 |

## 5. 技术决策（已选定）

| 决策 | 选择 | 理由 |
|------|------|------|
| 项目模板 | Preload Only (TypeScript) | 无构建步骤、原生 HTML/JS，最轻量；功能简单不需要前端框架 |
| SQLite 读取 | **`sql.js`**（纯 JS + WASM） | 零原生依赖，避免 ABI 适配；只读场景性能足够 |
| 模糊搜索 | **`fuse.js`** | 成熟轻量，自带高亮信息 |
| 启动方式 | `spawn('code', [path], { detached: true, shell: true })` | `shell: true` 让 Windows 自动用 `code.cmd`；`detached` 避免插件进程为父进程 |
| ID 命名 | `feature.code = "vsc-recent"`，触发关键字 `["vsc"]` | 用户指定 |

## 6. 架构

```
┌────────────────────────── index.html / index.ts (UI) ──────────────────────────┐
│                                                                                 │
│   ztools.setSubInput(onChange) ─┐                                               │
│   ↑↓ Enter / click handlers     │                                               │
│                                 ▼                                               │
│              ┌──────────  window.recentApi (preload) ──────────┐                │
│              │  list(): RecentItem[]    open(item): Promise    │                │
│              └─────────────────┬─────────────┬─────────────────┘                │
│                                │             │                                  │
│                       loader/  │             │  launcher/                       │
│                   ┌────────────▼─────┐   ┌───▼─────────────────┐               │
│                   │ vscode-stable.ts │   │ vscode-stable.ts    │               │
│                   │  (RecentSource)  │   │   (Launcher)        │               │
│                   │  多源探测合并    │   │ spawn('code', [..]) │               │
│                   └──────────────────┘   └─────────────────────┘               │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**扩展口**：将来加 Insiders / Cursor / Windsurf 时，仅需新增 `loader/<name>.ts` + `launcher/<name>.ts` 并注册到 `index.ts` 的 source 列表中，UI 不变。

## 7. 模块详细设计

### 7.1 `plugin.json`

```json
{
  "name": "ztool-vsc-recent",
  "title": "VSCode 最近项目",
  "description": "快速打开最近的 VSCode 项目、工作区与远程会话",
  "version": "0.1.0",
  "main": "index.html",
  "logo": "logo.png",
  "preload": "preload.js",
  "features": [
    {
      "code": "vsc-recent",
      "explain": "最近打开的 VSCode 项目",
      "platform": ["win32", "darwin", "linux"],
      "cmds": ["vsc"]
    }
  ]
}
```

> preload 字段指向 `preload.js`：TS 源码会编译产物到同名 `.js`（见 §10.1）。

### 7.2 `preload.ts` —— 暴露给前端的 API

```ts
// 类型定义
export interface RecentItem {
  id: string;                 // 稳定 ID，用于 dedup（path 或 uri）
  kind: 'folder' | 'workspace' | 'remote';
  title: string;              // 用于主标题（项目名/host）
  subtitle: string;           // 用于副标题（路径，~ 缩写）
  rawPath: string;            // 启动 code 时传递的实际参数
  exists: boolean;            // 本地路径是否存在（remote 恒 true）
}

// preload 暴露
declare global {
  interface Window {
    recentApi: {
      list(): Promise<RecentItem[]>;
      open(item: RecentItem): Promise<{ ok: true } | { ok: false; reason: string }>;
    };
    // fuse.js 通过 preload 转发给前端（前端是渲染层，没有 require）
    Fuse: typeof import('fuse.js').default;
  }
}
```

### 7.3 RecentSource —— 多源探测（核心）

VSCode 的最近列表在不同版本/平台下位置不一致。本插件按以下优先级**逐源尝试**，结果合并后按 `id` 去重，保留最早出现的顺序：

```ts
// loader/vscode-stable.ts
interface RawEntry {
  // 形如 history.recentlyOpenedPathsList 中的条目
  folderUri?: string;        // "file:///c%3A/x"  或  "vscode-remote://wsl+Ubuntu/home/x"
  fileUri?: string;          // 单个文件，本插件**丢弃**
  workspace?: { id: string; configPath: string };
  label?: string;
}

interface SourceProbe {
  name: string;
  read(): Promise<RawEntry[] | null>;   // null = 该源不存在/读失败，继续下一个
}
```

**探测顺序：**

1. **state.vscdb**（首选）：用 `sql.js` 打开 `%APPDATA%\Code\User\globalStorage\state.vscdb`，
   `SELECT value FROM ItemTable WHERE key = 'history.recentlyOpenedPathsList'`，
   JSON.parse 后取 `.entries`。
   - macOS：`~/Library/Application Support/Code/User/globalStorage/state.vscdb`
   - Linux：`~/.config/Code/User/globalStorage/state.vscdb`
2. **storage.json fallback**：`%APPDATA%\Code\User\globalStorage\storage.json`
   - 解析 `backupWorkspaces.folders[].folderUri`、`backupWorkspaces.workspaces[]`、`windowsState.openedWindows[].folder`，构造伪 RawEntry。
   - 仅作 fallback：可能少于真实历史，但保证插件在 SQLite 中无数据时仍能展示**上一次会话**的项目。
3. **将来扩展**：profile 目录下的 `globalStorage/state.vscdb` 中如有 `recentlyOpenedPathsList`，可作为补充源。

**为什么这么设计**：调研中本机 `state.vscdb` 的 ItemTable 不含 `history.recentlyOpenedPathsList`（只在 `__$__targetStorageMarker` 中提到），但 `storage.json` 含可用的 backupWorkspaces 数据。不同 VSCode 版本、profile 配置、桌面/便携版差异巨大，单一源不可靠。多源探测是少量代价换稳定性。

**RawEntry → RecentItem 映射规则：**

| Raw 字段                       | → kind       | title                                  | subtitle                              | rawPath                                |
|------------------------------ |--------------|----------------------------------------|---------------------------------------|----------------------------------------|
| `folderUri` 以 `file://`       | `folder`     | `basename(decodedPath)`                | `prettyPath(decodedPath)`             | `decodedPath`                          |
| `folderUri` 以 `vscode-remote://` 或其他非 file 协议 | `remote` | `label` ?? host 部分 | 完整 URI | URI（`code --folder-uri <uri>`） |
| `workspace.configPath` 以 `file://` | `workspace` | `basename(...).replace(/\.code-workspace$/, '')` | `prettyPath(...)`               | `decodedPath`                          |
| `fileUri`                      | **丢弃**     | —                                      | —                                     | —                                      |

- `decodedPath` = `fileURLToPath(uri)`（用 Node 内置 `url` 模块；处理 `f%3A` → `f:`）。
- `prettyPath`：home 目录前缀替换为 `~`；Windows 反斜杠保留原样以匹配系统观感。
- 去重 `id`：local → `path.normalize(decodedPath).toLowerCase()`（Windows 大小写不敏感）；remote → 完整 URI 字符串。

**fs.existsSync 过滤**：仅对 `kind === 'folder' | 'workspace'` 调用；`remote` 一律 `exists = true`。

### 7.4 Launcher —— 启动 VSCode

```ts
// launcher/vscode-stable.ts
export function open(item: RecentItem): Promise<{ ok: true } | { ok: false; reason: string }> {
  const args = item.kind === 'remote'
    ? ['--folder-uri', item.rawPath]
    : [item.rawPath];

  return new Promise(resolve => {
    const child = spawn('code', args, { detached: true, stdio: 'ignore', shell: true });
    child.on('error', e => resolve({ ok: false, reason: e.message }));
    child.unref();
    // 给 spawn 一点时间触发 error 事件，再 resolve
    setTimeout(() => resolve({ ok: true }), 50);
  });
}
```

- `shell: true`：Windows 下 PATH 中的 `code` 实际是 `code.cmd`，需要 shell 解析；macOS/Linux 也兼容。
- `detached + unref`：避免插件进程作为 VSCode 的父进程，关闭插件不影响 VSCode。
- 50ms 延迟：足够 spawn 触发 ENOENT 之类的同步错误，不会让用户感知。

### 7.5 前端 UI（`index.html` + `index.ts`）

**结构（简化）：**

```html
<div id="app">
  <ul id="list"></ul>
  <div id="empty" hidden>没有找到最近项目</div>
</div>
```

**职责拆分：**

```ts
// index.ts
ztools.onPluginEnter(async () => {
  const items = await window.recentApi.list();
  const fuse = new window.Fuse(items, {
    keys: ['title', 'subtitle'], threshold: 0.4, includeScore: true,
  });
  let view = items;
  let highlighted = 0;

  function render() {
    /* 重绘 ul，绑定 click，给第 highlighted 行加 .active class。
       渲染后：document.querySelector('.active')?.scrollIntoView({ block: 'nearest' }); */
  }

  ztools.setSubInput(({ text }) => {
    view = text ? fuse.search(text).map(r => r.item) : items;
    highlighted = 0;
    render();
  }, '搜索 VSCode 项目');

  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { highlighted = Math.min(highlighted + 1, view.length - 1); render(); }
    else if (e.key === 'ArrowUp') { highlighted = Math.max(highlighted - 1, 0); render(); }
    else if (e.key === 'Enter')  { select(view[highlighted]); }
  });

  async function select(item: RecentItem) {
    const r = await window.recentApi.open(item);
    if (r.ok) ztools.outPlugin();
    else ztools.showNotification('无法启动 VSCode：' + r.reason + '。请确认 PATH 中有 code 命令。');
  }

  render();
});
```

**键盘焦点策略**：进入插件时 ZTools 已自动聚焦顶部子输入框；`keydown` 监听在 document 上，输入框无障碍接收键入，方向键/Enter 被插件捕获。

## 8. 数据流

```
ZTools 主输入框 "vsc" + Enter
  │
  ▼
onPluginEnter(action) ──→ recentApi.list()
                            ├─ loader/vscode-stable.read()
                            │   ├─ probe1: state.vscdb (sql.js)
                            │   └─ probe2: storage.json
                            ├─ map RawEntry → RecentItem
                            ├─ fs.existsSync 过滤 local
                            └─ dedup by id
  │
  ▼
首次 render(items)
  │
  ▼
setSubInput.onChange("foo")
  └─ fuse.search → view → render
  │
  ▼
↓↓Enter / click(item) ──→ recentApi.open(item)
                            ├─ spawn('code', [...], detached)
                            └─ ok? ──→ ztools.outPlugin()
                                 fail ──→ ztools.showNotification(...)
```

## 9. 错误处理

| 场景 | 处理 |
|------|------|
| 所有数据源都读不到（首次安装的 VSCode 等） | 列表空时显示 `#empty` 文案，引导用户先在 VSCode 中打开一次项目 |
| `state.vscdb` 文件被 VSCode 独占锁（罕见） | sql.js 是只读 + 内存解析，不会冲突；fs.readFileSync 即使遇 EBUSY 也会 try/catch 后跳过该源 |
| URI 解析异常（畸形 entry） | 单条 try/catch，丢弃该条，console.warn |
| spawn 启动失败 | §7.4 已覆盖，通过 `ztools.showNotification` 反馈 |
| Remote URI 缺失 `--folder-uri` 支持的旧 VSCode | 用户自行处理：用 fallback `code <uri>` 不可靠，故仅在 Notification 中提示"Remote 项目需要 VSCode 1.50+" |

## 10. 项目结构与构建

### 10.1 目录布局

```
vscode/
├─ plugin.json
├─ logo.png
├─ preload.ts               ← TS 源码，构建产物在同目录
├─ preload.js               ← tsc 输出（提交到仓库；保持 commonJS 不压缩，符合 NFR-2）
├─ index.html
├─ index.ts                 ← TS 源码
├─ index.js                 ← tsc 输出
├─ index.css
├─ src/
│  ├─ types.ts              ← RecentItem 等共享类型
│  ├─ loader/
│  │  └─ vscode-stable.ts
│  └─ launcher/
│     └─ vscode-stable.ts
├─ node_modules/            ← 含 sql.js / fuse.js（与 preload 同级，符合 ZTools 规范）
├─ package.json             ← "type": "commonjs"
├─ tsconfig.json            ← target ES2020 / module CommonJS / outDir 同源（preserve 目录结构）
├─ docs/superpowers/specs/2026-05-21-vsc-recent-design.md
└─ docs/superpowers/plans/  ← writing-plans 阶段产出
```

### 10.2 构建命令

```bash
npm i sql.js fuse.js
npm i -D typescript @types/node
npx tsc                 # 把 .ts 编译为同目录 .js（不压缩、不混淆，符合 NFR-2）
```

## 11. 非目标 (Out of Scope, YAGNI)

- ❌ 多 VSCode 发行版同时支持（Stable + Insiders + Cursor + Windsurf）—— 仅 Stable，扩展口已留好
- ❌ 收藏 / 置顶项目
- ❌ 手动添加项目
- ❌ 项目分组、标签
- ❌ 历史项目数量限制（VSCode 自身就限制了大约 200 条，无需再限）
- ❌ MainPush 主搜索框直推模式（已与用户确认）
- ❌ VSCode 历史搜索之外的项目源（如 git 仓库扫描）
- ❌ 自定义 VSCode 启动参数（如 `--new-window`、`--add`）

## 12. 测试策略

- **手工测试为主**：插件功能可观测、依赖系统状态（VSCode 已装、有最近列表），自动化收益不高。
- **测试清单**（实施完成时由 `verification-before-completion` skill 驱动）：
  1. 关键字 `vsc` 进入插件，列表非空
  2. 列表条目主/副标题正确，~ home 缩写生效
  3. 输入"半个项目名"模糊匹配返回相关项
  4. ↑↓ 改变高亮，Enter 启动 VSCode 并隐藏插件
  5. 鼠标点击同样启动 VSCode
  6. 删一个本机文件夹后再唤起插件，该项不出现（FR-5）
  7. Remote 条目（WSL）能正常启动
  8. `code` 命令在 PATH 时启动失败给出 Notification
- **单元测试**（可选，只针对纯函数）：
  - `RawEntry → RecentItem` 的映射逻辑
  - `fileURLToPath` 与 `prettyPath` 的 Windows/POSIX 行为

## 13. 风险与开放问题

| 风险 | 影响 | 缓解 |
|------|------|------|
| VSCode 将来再次迁移最近列表存储位置 | 数据源失效 | 多源探测 + console.warn 留诊断信息；用户报问题时快速定位 |
| `sql.js` WASM 体积约 1MB | 插件首次加载略慢 | 仅 `await import()` 按需加载；列表渲染先用 fallback 源即时显示，state.vscdb 数据回来后再增量补充（可选优化，先不做） |
| Windows 下 `code` 不在 PATH | 启动失败 | NFR 已包含 Notification 引导 |

## 14. 决定事项 / 后续步骤

实施前**无未决问题**。本设计交由 writing-plans skill 转为分步实施计划。
