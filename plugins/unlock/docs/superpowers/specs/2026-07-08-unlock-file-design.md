# 解除文件占用插件 — 设计文档

## 概述

开发一个 ZTools 插件，用于查找并解除文件被进程占用的问题。用户输入或拖拽文件后，插件识别占用该文件的进程，并提供"关闭句柄"和"结束进程"两种操作。

## 需求总结

| 维度 | 决策 |
|------|------|
| 核心功能 | 识别占用进程 + 关闭句柄 + 结束进程 |
| 输入方式 | 拖拽文件 + 手动输入路径 |
| 平台支持 | Windows、macOS、Linux |
| 技术方案 | 纯系统命令（零外部依赖） |
| 查找触发 | 手动点击查找按钮 |

## 架构

```
┌─────────────────────────────────────────────┐
│                  UI Layer                     │
│  src/Unlock/index.vue                         │
│  ┌─────────┐  ┌──────────┐  ┌─────────────┐ │
│  │路径输入框│  │查找按钮  │  │进程列表展示 │ │
│  │(支持拖拽)│  │          │  │+操作按钮    │ │
│  └─────────┘  └──────────┘  └─────────────┘ │
└──────────────────┬──────────────────────────┘
                   │ window.services
┌──────────────────▼──────────────────────────┐
│              Preload Layer                    │
│  public/preload/services.js                  │
│  findLockingProcesses(filePath)              │
│  closeFileHandle(filePath, pid)              │
│  killProcess(pid)                            │
│           │ child_process.exec/spawn         │
│           ▼                                  │
│  Windows: PowerShell (RestartManager API)    │
│  macOS:   lsof                               │
│  Linux:   lsof                               │
└─────────────────────────────────────────────┘
```

## UI 设计

### 布局

单页面组件 `src/Unlock/index.vue`，包含：

- **路径输入框**：支持手动输入文件路径，支持拖拽文件（使用 `ztools.getPathForFile` 获取真实路径）
- **浏览按钮**：调用 `ztools.showOpenDialog` 选择文件
- **查找按钮**：触发查找操作
- **结果区域**：展示进程列表，每个进程卡片包含进程名、PID、进程路径、操作按钮

### 交互流程

1. 用户输入路径 / 拖拽文件 / 浏览选择 → 路径填入输入框
2. 点击"查找占用进程" → 显示 loading 状态 → 展示进程列表
3. 每个进程卡片显示：进程名、PID、进程路径
4. 两个操作按钮：
   - **关闭句柄**：仅 Windows 可用，macOS/Linux 置灰并提示
   - **结束进程**：全平台可用
5. 操作成功后调用 `ztools.showNotification` 显示通知，并自动刷新列表

## Preload 核心 API

### `findLockingProcesses(filePath)`

查找占用指定文件的进程列表。

- **参数**：`filePath: string` — 文件绝对路径
- **返回**：`Promise<ProcessInfo[]>` — 进程信息数组
- **ProcessInfo**：
  ```typescript
  interface ProcessInfo {
    pid: number       // 进程 ID
    name: string      // 进程名称
    path: string      // 进程可执行文件路径
  }
  ```

### `closeFileHandle(filePath, pid)`

通过 RestartManager 关闭占用指定文件的进程组（仅 Windows）。相比 `killProcess`，此操作范围精确到占用该文件的进程，允许进程优雅退出。

- **参数**：`filePath: string`, `pid: number`
- **返回**：`Promise<{ success: boolean, message: string }>`
- **注意**：需要管理员权限

### `killProcess(pid)`

结束指定进程（全平台）。

- **参数**：`pid: number`
- **返回**：`Promise<{ success: boolean, message: string }>`

## 平台差异化实现

| 功能 | Windows | macOS | Linux |
|------|---------|-------|-------|
| 查找进程 | PowerShell 调用 `RestartManager` API | `lsof "<file>"` | `lsof "<file>"` |
| 关闭占用 | PowerShell 调用 `RmShutdown` 关闭占用文件的进程（范围精确到目标文件） | 不支持（UI 置灰） | 不支持（UI 置灰） |
| 结束进程 | `taskkill /PID <pid> /F` 强制杀掉指定进程 | `kill -9 <pid>` | `kill -9 <pid>` |

> **两种操作的区别：** "关闭占用"通过 RestartManager 精准关闭占用该文件的进程组（允许进程优雅退出），"结束进程"直接强制杀掉单个进程（/F 参数）。前者对目标程序更友好，后者更彻底。

### Windows 查找进程 — PowerShell 核心逻辑

使用 .NET RestartManager API：

```powershell
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public struct RM_UNIQUE_PROCESS { public int dwProcessId; public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime; }
public enum RM_APP_TYPE { RmUnknownApp = 0, RmMainWindow = 1, RmOtherWindow = 2, RmService = 3, RmExplorer = 4, RmConsole = 5, RmCritical = 1000 }
public struct RM_PROCESS_INFO { public RM_UNIQUE_PROCESS Process; public string strAppName; public string strServiceShortName; public RM_APP_TYPE ApplicationType; public uint AppStatus; public uint TSSessionId; [MarshalAs(UnmanagedType.Bool)] public bool bRestartable; }
public class RestartManager {
    [DllImport(""rstrtmgr.dll"", CharSet = CharSet.Unicode)] public static extern int RmStartSession(out uint sessionHandle, int sessionFlags, string sessionKey);
    [DllImport(""rstrtmgr.dll"")] public static extern int RmEndSession(uint sessionHandle);
    [DllImport(""rstrtmgr.dll"", CharSet = CharSet.Unicode)] public static extern int RmRegisterResources(uint sessionHandle, uint nFiles, string[] resources, uint nApplications, IntPtr applications, uint nServices, string[] services);
    [DllImport(""rstrtmgr.dll"")] public static extern int RmGetList(uint sessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo, [In, Out] RM_PROCESS_INFO[] rgAffectedApps, ref uint lpdwRebootReasons);
    [DllImport(""rstrtmgr.dll"")] public static extern int RmShutdown(uint sessionHandle, uint lActionFlags, string fnStatus);
}
"@
```

调用流程：`RmStartSession` → `RmRegisterResources` → `RmGetList` → 输出 JSON → `RmEndSession`

### macOS/Linux 查找进程 — lsof

```bash
lsof "<filePath>" 2>/dev/null | awk 'NR>1 {print $2, $1}'
```

输出格式：`PID 进程名`，再通过 `ps -p <PID> -o comm=` 获取进程路径。

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| 文件不存在 | 查找前校验路径，不存在则提示"文件不存在" |
| 文件未被占用 | 返回空列表，UI 显示"该文件没有被任何进程占用" |
| 查找超时 | 系统命令设置 10s 超时，超时提示"查找超时，请重试" |
| 关闭占用失败 | 捕获错误，提示"关闭占用失败，请尝试以管理员身份运行 ZTools" |
| 结束进程失败 | 捕获错误，提示"结束进程失败，可能权限不足" |
| 操作后状态确认 | 关闭句柄/结束进程后自动重新查找，刷新列表 |
| 非 Windows 点击关闭句柄 | 按钮置灰 + tooltip "该功能仅支持 Windows" |

## 安全考虑

- 路径参数通过 `execFile` 参数数组传递，不拼接字符串，防止命令注入
- 查找前使用 `fs.existsSync` 验证文件存在性
- 使用 `path.resolve` 解析为绝对路径
- 不记录或传输任何用户文件信息

## 项目变更清单

### 新增文件

- `src/Unlock/index.vue` — 解锁功能 UI 组件

### 修改文件

- `src/App.vue` — 移除 Hello/Read/Write 示例路由，替换为 Unlock 组件
- `public/preload/services.js` — 替换示例方法为解锁相关方法
- `public/plugin.json` — 更新 features 配置，移除示例功能，添加 unlock 功能
- `README.md` — 更新为解锁插件文档

### 删除文件（示例组件）

- `src/Hello/index.vue`
- `src/Read/index.vue`
- `src/Write/index.vue`

## 技术方案对比（已否决）

| 方案 | 描述 | 否决原因 |
|------|------|----------|
| 方案 B：打包 handle.exe | 打包 Sysinternals handle.exe | 增加包体积，handle.exe 需处理 UAC 提权 |
| 方案 C：Node.js 原生 addon | C++ addon 直接调用系统 API | 需编译工具链，维护成本过高 |
