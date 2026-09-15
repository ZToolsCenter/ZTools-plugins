# QuickTerm

> 常用文件夹「在终端中打开」快速启动器

## 更新日志

### v1.1.0 - 2026-09-15

- 支持 macOS：Terminal.app / iTerm2 自动探测与打开（iTerm2 走 AppleScript，首次使用系统可能弹「自动化」授权提示，允许即可）
- 面板支持拖拽文件夹 / 文件直接添加收藏（整个窗口范围均可拖入；文件自动取父目录）
- 「添加文件夹」支持一次选择多个目录；新增「清空全部」按钮（二次确认）

### v1.0.0 - 2026-09-14

- 首次发布：快速启动面板（收藏文件夹、增删、点击秒开）
- 粘贴 / 拖入文件夹到 ZTools，直接用默认终端打开该目录
- 主输入框直接粘贴路径一键打开；关键字搜索收藏列表，选中即开
- 终端支持：Windows Terminal / PowerShell 7 / Windows PowerShell / CMD / Git Bash，自动探测降级
- 适配暗色模式

## 使用场景

把常用项目目录收藏成快速启动列表，点击即用指定终端打开该目录，省去每次「打开终端 → cd 一长串路径」的重复操作。

## 如何使用

### 触发方式

| 触发方式 | 行为 |
|---|---|
| 输入指令 `qt` / `term` / `quickterm` | 打开快速启动面板 |
| 粘贴 / 拖入**文件夹**到 ZTools | 用默认终端立即打开该目录，并自动退出插件 |
| 粘贴 / 拖入**文件**到 ZTools | 自动取其父目录打开 |
| 主输入框**粘贴 / 输入任意文本** | 选中「在终端中打开」即可：路径形态直接打开；输入收藏名称（如 `babe`）自动匹配收藏列表打开 |
| 主输入框**输入关键字** | 搜索收藏列表（动态推送），选中即打开 |

### 面板操作

- **添加**：点击「添加文件夹」弹出系统目录选择框（**可按住多选**）；或直接把文件夹 / 文件**拖到面板上**（整个窗口范围均可，文件自动取父目录）
- **清空**：右上角「清空全部」，二次确认后清空收藏列表
- **删除**：hover 条目后点击「删除」
- **打开**：点击条目，在终端中打开该目录
- **条目终端**：每条收藏可单独下拉固定使用的终端（默认「跟随默认」），固定后在条目右侧以标签显示
- **默认终端**：面板顶部下拉切换（自动探测本机可用终端）

### 终端探测优先级（自动降级）

**Windows**

```
Windows Terminal (wt.exe)
  ↓ 未安装
PowerShell 7 (pwsh.exe)
  ↓
Windows PowerShell (powershell.exe)
  ↓
CMD (cmd.exe)
```

Git Bash 独立于降级链：设置手动指定 → 常见安装路径 → `where git` 反推 → `where bash`（排除 WSL）。若未检测到，可在默认终端下拉框旁点「设置 Git Bash 路径」手动指定 `bash.exe` 完整路径。

**macOS**

```
iTerm2 (/Applications/iTerm.app)
  ↓ 未安装
Terminal.app（系统自带，必有可用项）
```


## 功能特性

- 常用文件夹收藏列表，点击即用终端打开
- 粘贴 / 拖入文件夹秒开终端，无需经过面板
- 跨平台：Windows（Windows Terminal / PowerShell / CMD / Git Bash）+ macOS（Terminal.app / iTerm2），自动探测 + 降级
- 条目级终端记忆 + 全局默认终端设置
- 路径含空格 / 中文正常打开（进程参数数组传递，无引号拼接）

## 安装与开发

```bash
npm install
npm run dev    # 开发模式，ZTools 自动加载 http://localhost:5173
npm run build  # 构建产物输出到 src-ztools/dist/
```

## 数据存储说明

所有数据通过 ZTools 官方 `dbStorage` 接口存储在本地（收藏列表 `qt-folders`、设置 `qt-settings`），重启不丢失，**不联网、不上传任何数据**。

## 技术栈

- Vue 3 + TypeScript + Vite
- Element Plus（unplugin 按需引入）
- ZTools preload（Node.js `child_process` 终端探测与启动）

## 许可证

MIT License
