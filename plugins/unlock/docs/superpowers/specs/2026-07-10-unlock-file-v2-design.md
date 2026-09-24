# 解除文件占用 v2 — 三合一设计

## 概述

将 ZTools `unlock-file` 插件从单一的"解除文件占用"扩展为三个模块:

1. **解除占用** (Unlock) — 简化: 仅用 handle.exe + taskkill
2. **文件粉碎** (Shredder) — 可选 删除 / 粉碎, 目录递归, 粉碎前自动解锁
3. **端口检测** (Port Scanner) — 输入端口号, 展示详细信息, 可 Kill 进程, 仅本地监听

三个模块共用同一个插件入口, 通过 Tab 切换。

---

## 1. 整体架构

### 文件布局

```
src/
├── env.d.ts                        # 追加 PortInfo, ShredderResult, TabType 等类型
└── Unlock/
    ├── index.vue                    # → Tab 容器: [解除占用] [文件粉碎] [端口检测]
    ├── UnlockTab.vue                # 现有逻辑简化(仅 handle.exe)
    ├── ShredderTab.vue              # 新建: 删除 / 粉碎
    └── PortTab.vue                  # 新建: 端口检测

public/preload/
├── services.js                      # 注册 window.services, 导入各模块
├── unlock.js                        # 仅 handle.exe + taskkill (从原 services.js 拆出)
├── unlock.test.js                   # unlock 单元测试
├── shredder.js                      # 删除 / 粉碎逻辑
├── shredder.test.js                 # shredder 单元测试
├── portscan.js                      # Get-NetTCPConnection 端口检测
├── portscan.test.js                 # portscan 单元测试
├── handle.exe                       # 已有
├── handle-parse.js                  # 已有 (可能小幅改造适配中文)
├── handle-parse.test.js             # 已有
├── utils.js                         # 已有 (getKillCommand)
├── utils.test.js                    # 已有
├── (删除 detect-lock.ps1)
├── (删除 detect-parse.js)
└── (删除 detect-parse.test.js)
```

### Tab 切换

Vue `v-if` / `:class="active"` 实现, 一个 `activeTab: TabType` ref。—— ZTools 无路由库, 最轻量方案。

### preload 加载

不变, `services.js` 作为唯一入口, import `unlock.js`, `shredder.js`, `portscan.js` 后注册到 `window.services`。

---

## 2. 模块一: 解除占用 (Unlock) — 简化

### 当前→目标

| 当前 | 目标 |
|------|------|
| Restart Manager → handle.exe → Win32_Process → 独占锁探测 | 仅 handle.exe |
| `detect-lock.ps1` (RM 脚本) | 删除 |
| `detect-parse.js` (RM 输出解析) | 删除 |
| `detectByRestartManager`, `detectByCommandLine`, `probeExclusiveLock` | 删除 |

### 中文路径编码策略

核心问题: `handle.exe` 是原生 Win32 程序, 接收命令行参数时使用系统编码 (UTF-16)。通过 `powershell -Command "& handle.exe -a $env:VAR"` 传递中文路径时, 环境变量方式已可工作, 但更可靠的方式是:

1. 写入临时 `.ps1` 脚本文件 (UTF-8 with BOM)
2. 脚本内容: `& "path\to\handle.exe" -accepteula -nobanner -a "中文路径"`
3. `powershell -File temp.ps1` 执行
4. 执行完后删除临时文件

BOM 确保 PowerShell 将脚本解析为 UTF-8, 字符串字面量以 UTF-16 传入 handle.exe, 中文路径正确匹配。

### 检测流程

```
findLockingProcesses(path)
  1. 判断文件/目录
  2. 写临时 .ps1 脚本调用 handle.exe -a
  3. 解析 handle.exe 输出 → ProcessInfo[]
  4. 删除临时脚本
  5. 返回 ProcessInfo[]
```

### killProcess

不变, 复用 `utils.js` 的 `getKillCommand(pid)` + `taskkill /f` + 退出后 `isProcessAlive` 验证。

---

## 3. 模块二: 文件粉碎 (Shredder)

### API

```ts
shredPath(filePath: string, options: { mode: 'delete' | 'shred' })
  → Promise<{ success: boolean; message: string; filesProcessed?: number }>
```

### 删除模式 (mode: 'delete')

- 单个文件: `Remove-Item -Force`
- 目录: `Remove-Item -Recurse -Force`
- 若文件被占用 (Remove-Item 失败): 返回 `{ success: false, message: '...', locked: true }` → UI 提供自动解锁按钮

### 粉碎模式 (mode: 'shred')

单文件粉碎流程:
1. 用 `FileShare.None` 打开 → 若失败则返回 locked 状态
2. 获取文件大小
3. 分配 64KB 缓冲区, 填充加密随机字节 (`RandomNumberGenerator`)
4. 写入缓冲区 → flush → 重复直至文件尾
5. 关闭文件
6. `Remove-Item -Force` 删除

目录粉碎流程:
1. 递归获取所有文件 (`Get-ChildItem -Recurse -File`)
2. 对每个文件执行单文件粉碎
3. 全部完成后 `Remove-Item -Recurse -Force` 删除目录

覆写遍数: **1 遍**。现代 SSD/HDD 上 1 遍随机覆写已足以防止数据恢复, 不需要 DoD 3 遍。

### 自动解锁

当检测到文件被占用时:
1. 调用 `unlock.js` 的 `findLockingProcesses`
2. 若有进程占用 → 自动调用 `killProcess`
3. Kill 完成后重新尝试粉碎
4. 如果仍然锁住 → 返回提示信息

### PowerShell 实现方案

所有操作通过 PowerShell 脚本完成, 无外部依赖:

```powershell
# 粉碎单文件
$path = "..."
$size = (Get-Item $path).Length
$buffer = [byte[]]::new(65536)
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$fs = [System.IO.File]::Open($path, 'Open', 'Write', 'None')
$written = 0
while ($written -lt $size) {
    $chunkSize = [Math]::Min(65536, $size - $written)
    if ($chunkSize -lt 65536) { $buffer = [byte[]]::new($chunkSize) }
    $rng.GetBytes($buffer)
    $fs.Write($buffer, 0, $chunkSize)
    $fs.Flush()
    $written += $chunkSize
}
$fs.Close()
Remove-Item -Force $path
```

---

## 4. 模块三: 端口检测 (Port Scanner)

### API

```ts
findPortProcess(port: number)
  → Promise<PortInfo[]>

PortInfo {
  pid: number
  processName: string
  exePath: string
  protocol: 'TCP' | 'UDP'
  state: string          // e.g. "Listen", "Established"
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number
}
```

### PowerShell 实现

```powershell
# TCP
$tcp = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
# UDP
$udp = Get-NetUDPEndpoint -LocalPort $port -ErrorAction SilentlyContinue

$results = @()
if ($tcp) {
    foreach ($c in $tcp) {
        $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
        $results += @{
            pid = [int]$c.OwningProcess
            processName = if ($proc) { $proc.ProcessName } else { "未知" }
            exePath = if ($proc) { $proc.Path } else { "" }
            protocol = "TCP"
            state = $c.State.ToString()
            localAddress = $c.LocalAddress
            localPort = [int]$c.LocalPort
            remoteAddress = $c.RemoteAddress
            remotePort = [int]$c.RemotePort
        }
    }
}
# 同理处理 UDP
$results | ConvertTo-Json -Compress
```

### 过滤规则

- 仅查找本地监听端口 (`State = Listen`), 不扫描远程连接
- Kill 按钮对每条记录可用

---

## 5. 类型定义 (src/env.d.ts)

```ts
export type TabType = 'unlock' | 'shredder' | 'port'

export interface PortInfo {
  pid: number
  processName: string
  exePath: string
  protocol: 'TCP' | 'UDP'
  state: string
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number
}

export interface ShredderResult {
  success: boolean
  message: string
  filesProcessed?: number
  locked?: boolean
}

// Services 接口追加:
//   findPortProcess: (port: number) => Promise<PortInfo[]>
//   shredPath: (filePath: string, options: { mode: 'delete' | 'shred' }) => Promise<ShredderResult>
```

---

## 6. UI 设计

### Tab 栏

```
┌──────────────────────────────────────┐
│ [解除占用]  [文件粉碎]  [端口检测]   │
├──────────────────────────────────────┤
│ (内容区域)                           │
```

### 解除占用 Tab (UnlockTab.vue)

从现有 `index.vue` 简化:
- 移除 `__LOCKED__` 相关逻辑
- 移除 AppType 标签渲染 (handle.exe 不返回 appType, 统一显示 "Process")
- 保留: 输入框 / 拖拽 / 浏览 / 进程卡片 (PID + 名称 + 路径) / 结束按钮 / 调试面板
- 错误提示精简: "未检测到占用" → 不再提示管理员重试 (因为 handle.exe 本身就需要管理员)

### 文件粉碎 Tab (ShredderTab.vue)

```
输入: [文件路径..........................] [浏览]
选项: ○ 删除  ● 粉碎
操作: [开始]

状态: "处理中..." / "完成: 15 个文件已粉碎" / 错误信息
```

- 路径输入支持拖拽 + 浏览
- mode 选择: radio button
- 开始按钮: 若检测到占用 → 自动调用 Unlock → 再粉碎
- 过程反馈: loading 文字 + 调试日志

### 端口检测 Tab (PortTab.vue)

```
端口: [8080] [检测]

┌─────────┬──────┬────────┬───────┬──────────────┬──────────────┐
│ 进程名   │ PID  │ 协议   │ 状态   │ 本地地址      │ 操作          │
├─────────┼──────┼────────┼───────┼──────────────┼──────────────┤
│ nginx   │ 1234 │ TCP    │ Listen│ 0.0.0.0:8080  │ [结束进程]   │
│ node    │ 5678 │ TCP    │ Listen│ 127.0.0.1:443 │ [结束进程]   │
└─────────┴──────┴────────┴───────┴──────────────┴──────────────┘
```

---

## 7. 错误处理

| 场景 | 处理方式 |
|------|----------|
| handle.exe 不存在 / 下载失败 | 返回友好错误: "检测工具未就绪, 请运行 npm run postinstall" |
| 文件路径不存在 | 前端校验 + preload 二次校验 |
| handle.exe 非管理员运行 (只能看到当前用户进程) | 正常返回结果, 仅在 UI 提示"部分系统进程不可见" |
| 粉碎时文件被占用 | 自动解锁 → 重试; 解锁失败 → 返回 locked 提示 |
| 粉碎时磁盘空间不足 / 权限不足 | 捕获 PowerShell 错误, 返回可读信息 |
| Get-NetTCPConnection 端口无监听 | 返回空数组, UI 显示"该端口无监听进程" |
| 输入非数字端口 | 前端校验 1–65535 |

---

## 8. 测试

16 个现有测试全部保留 (handle-parse.test.js, utils.test.js)。

新增测试:
- `unlock.test.js` — mock handle.exe 文本输出, 测试解析 + 中文路径场景 (至少 3 个用例)
- `shredder.test.js` — 测试 PowerShell 脚本构造, 输出解析 (至少 3 个用例)
- `portscan.test.js` — mock Get-NetTCPConnection JSON 输出, 验证解析 (至少 4 个用例)

测试框架不变: `node:test` + `node:assert`, `node --test public/preload/*.test.js`。

---

## 9. 不做 (YAGNI)

- 不实时进度条 (目录粉碎仅显示"处理中...")
- 不 DoD 3 遍 / 7 遍覆写 (1 遍足够)
- 不远程端口检测 (仅本地监听)
- 不集成到系统右键菜单 (ZTools 插件框架不支持)
- 不跨平台支持 (仅 Windows)

---

## 10. 交付标准

- `npm run build` 通过 (vue-tsc + vite)
- `npm run typecheck` 通过
- `node --test public/preload/*.test.js` 全部通过
- 插件在 ZTools 中加载正常, 三个 Tab 可切换
- handle.exe 中文路径检测正常
- 新功能: 删除/粉碎正常, 端口检测正常
