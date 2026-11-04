# easyenv — 环境变量管理器 · MVP 设计文档

> ZTools 插件 · Windows-only · 目标：替代系统自带「环境变量」编辑对话框，提供可视化查看/修改/备份能力。

## 1. 定位与边界

| 项 | 决策 |
|---|---|
| 平台 | **Windows only**（macOS/Linux 环境变量走 shell rc 文件，逻辑完全不同，不做） |
| 数据源 | **永远读注册表**，不读 `process.env`（后者是 ZTools 进程启动时的混合快照，不是真相） |
| 提权策略 | **批量写入**：本次会话的系统变量改动攒成操作清单，一次 UAC 全部落盘 |
| 分类 | `system` |
| 名称 | easyenv（环境变量管理器），触发词 `环境变量` / `env` / `easyenv` |

## 2. 注册表事实（实现的根基）

| 作用域 | 键路径 | 写权限 |
|---|---|---|
| 用户变量 | `HKCU\Environment` | 无需提权 |
| 系统变量 | `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment` | **写需管理员**，读不需要 |

关键点：

1. **值类型必须原样保留**。PATH、TEMP 等是 `REG_EXPAND_SZ`，值里含 `%SystemRoot%`、`%JAVA_HOME%` 等引用；普通写入会退化成 `REG_SZ` 或把引用展开成死值。
2. 读原始值用 `RegistryValueOptions.DoNotExpandEnvironmentNames`；写回用 `key.SetValue(name, value, kind)` 显式带类型。
3. 默认值（未命名值）的 name 是空字符串，遍历时要处理。
4. 改注册表后必须广播 `WM_SETTINGCHANGE "Environment"`，否则资源管理器/新终端不刷新；**已开着的终端永远不会变**，UI 要明示。

## 3. preload services API 清单

```ts
interface EnvVar {
  name: string;
  value: string;        // 原始值（未展开，保留 %...% 引用）
  kind: 'REG_SZ' | 'REG_EXPAND_SZ' | 'REG_DWORD' | '...';
  expanded?: string;    // 展开值（仅 PATH 编辑器校验用，按需取）
}

interface EnvOp {       // 待落盘的操作
  op: 'set' | 'delete';
  name: string;
  value?: string;
  kind?: string;
}
```

| API | 说明 |
|---|---|
| `isAdmin(): boolean` | WindowsPrincipal 角色检测（复用 easynssm） |
| `listEnv(scope): Promise<EnvVar[]>` | 读 HKCU / HKLM，保留 kind 与未展开原始值 |
| `applyUserOps(ops: EnvOp[]): Promise<Result>` | 用户变量写入，直接跑，免提权 |
| `applySystemOps(ops: EnvOp[]): Promise<Result>` | 系统变量批量写入，走提权通道，UAC 一次 |
| `broadcastChange(): void` | 广播 WM_SETTINGCHANGE（写成功的所有调用内部自动带上，也可单独调） |
| `snapshot(reason: string): Promise<Snapshot>` | 修改前全量快照两侧变量 → dbStorage |
| `listSnapshots(): Snapshot[]` / `restoreSnapshot(id)` | 回滚；恢复系统侧同样走提权批量通道 |
| `checkPathExists(raw: string): boolean` | 对单条 PATH 条目展开后 `fs.existsSync` 校验（渲染层循环调用或批量接口） |

实现要点：

- 所有 PowerShell 调用走 `spawnSync powershell.exe -NoProfile -EncodedCommand <UTF16LE base64>`，免临时脚本、免转义地狱（bingpaper 已验证）。
- **提权回读协议**（照搬 easynssm）：把 `EnvOp[]` 写临时 JSON → `Start-Process -Verb RunAs` 起 elevated PowerShell → 子进程读清单、写注册表 → 把结果写回临时 JSON → 父进程读回判断成败。子进程用完删临时文件。
- spawn 判成败只看 `res.error`，不按 exit code（explorer 前科）。
- 控制台子进程一律 `windowsHide: true` 没问题（不是 GUI 程序）。

### PowerShell 核心片段（读，保留类型）

```powershell
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
foreach ($n in $key.GetValueNames()) {
  $kind = $key.GetValueKind($n)
  $raw  = $key.GetValue($n, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  # → 组装 JSON 数组输出
}
```

### PowerShell 核心片段（广播）

```powershell
# HWND_BROADCAST=0xFFFF, WM_SETTINGCHANGE=0x001A
[Win32]::SendMessageTimeout([IntPtr]0xFFFF, 0x001A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$p)
```

## 4. UI 草案

### 主视图

- 顶部工具栏：**用户变量 | 系统变量** 双 Tab + 搜索框 + 「新建」+「快照」入口；系统 Tab 角标显示待应用改动数。
- 变量表（el-table）：变量名 | 类型徽标 | 值（截断，hover 完整）| 操作（编辑 / 删除）。
- **PATH 行特殊化**：值列显示 `N 条路径` 摘要 + 「编辑路径」按钮，进专项编辑器。
- 删除：二次确认（ElMessageBox），文案点出该变量名。

### PATH 专项编辑器（核心卖点，el-dialog width="90%"）

- 逐条路径一行，支持拖拽排序、上移/下移/置顶。
- 每条实时校验：展开后 `fs.existsSync` 不存在 → 标红 + 「无效」徽标。
- 重复路径（大小写不敏感）→ 高亮去重按钮。
- 底部实时预览合并后的分号串（含 `%引用%` 原样保留）。
- 保存前若原 kind 是 REG_EXPAND_SZ，写回保持 REG_EXPAND_SZ。

### 新建/编辑对话框

- 变量名（校验非空、不含 `=`）、值（长值用 textarea）、类型（REG_SZ / REG_EXPAND_SZ 下拉；值含 `%` 时自动建议 EXPAND）。

### Diff 预览（应用前必经）

- 按颜色列出：新增（绿）/ 修改（黄，旧值→新值）/ 删除（红）。
- 用户改动 →「立即应用」；系统改动 →「应用系统变量修改（N 项）」→ UAC 一次落盘。

### 快照面板

- 快照列表（时间 + 触发原因），支持回滚、导出 JSON、导入。上限保留最近 20 份，超出淘汰最旧。

## 5. 数据流（一次典型修改）

```
用户改值 → 前端攒 EnvOp → snapshot() 自动快照
  → scope=用户：applyUserOps 直接写 → broadcast → 刷新列表
  → scope=系统：进待应用队列 → Diff 确认 → applySystemOps（UAC 一次）
```

## 6. 风险与对策备忘

| 风险 | 对策 |
|---|---|
| REG_EXPAND_SZ 类型丢失/引用被展开 | 全链路只用原始值 + 显式 kind（§2） |
| 提权子进程写的临时 JSON 父进程读不了（ACL） | 复用 easynssm 已验证协议；读回失败给「重试/查看日志」兜底 |
| 用户改坏 PATH 导致命令全失效 | 强制快照 + Diff 预览 + PATH 无效条目标红 |
| broadcast 后用户以为立即全局生效 | UI 固定提示「已打开的终端/程序需重启才能读到新值」 |
| preload 更新不生效 | 渲染层对 services 方法做 typeof 检查，提示重启 ZTools |
| 会话内跑不了 ztools CLI（cmd.exe EBUSY） | `ztools create` 由用户在自己终端执行；publish 同 |

## 7. 里程碑

1. **M1 脚手架**：用户终端 `ztools create easyenv`（Vue+TS+Vite 模板）→ README/CHANGELOG 骨架 → plugin.json 配 features。
2. **M2 preload 层**：listEnv / applyUserOps / broadcast / isAdmin，先打通「只读查看」。
3. **M3 用户变量增删改** + 自动快照 + Diff 预览。
4. **M4 PATH 编辑器**。
5. **M5 系统变量批量提权写入 + 快照回滚/导入导出**。
6. **M6 打磨**：暗色适配（dark css-vars + prefers-color-scheme）、搜索、发版。

## 8. 实现落地记录（1.0.0）

M1–M6 一次完成，与设计相比的三处调整：

1. **统一「待应用队列」**：用户变量也先入队、与系统变量一起在 Diff 确认后一次性写入，而不是用户变量即时落盘。理由：一次自动快照 + 一次 Diff 覆盖全部改动，多变量连续编辑的心智一致，也避免「改了三个值存了三份快照」。
2. **PATH 增加类型开关**：本机实测用户 PATH 是 `REG_SZ`（历史工具写入所致），需要一个显式入口转成 `REG_EXPAND_SZ`，否则用户 PATH 里的 `%引用%` 永远不会被展开。PATH 编辑器底部加了勾选框，默认沿用原类型。
3. **快照 ID / 存储**：`easyenv_snapshots` 键存 JSON 字符串数组（dbStorage 只接受可结构化克隆的纯数据，Proxy 会静默失败）。

实测验证（自检脚本直接调 preload）：

| 项 | 结果 |
|---|---|
| 读取 | 用户 16 项 / 系统 23 项，均成功 |
| PATH 类型 | 系统 PATH = `REG_EXPAND_SZ`，用户 PATH = `REG_SZ`，均原样读取 |
| `%引用%` 展开 | `%JAVA_HOME%\bin` → `D:\devTools\jdk\jdk8\bin`，存在性判定正确 |
| 写入往返 | 写入 `REG_EXPAND_SZ` 后读回 kind 与未展开原值完全一致 |
| 中文往返 | `D:\测试 目录\bin;%SystemRoot%;C:\中文目录` 写入读回逐字节一致 |
| 快照 | 生成/列表/删除正常 |
| 广播 | 写入后 `WM_SETTINGCHANGE` 执行成功（无异常） |

补充说明：`C:\ProgramData\easyenv` 作为提权回读目录，非提权写入走 `%TEMP%`；两条路径都在成功后删除临时文件。
