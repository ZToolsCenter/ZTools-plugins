# Askills

使用 **Rust + Tauri 2** 构建的中英文 Agent Skills 桌面管理器 (纯AI构建, 由GPT6支持) 。

当前项目版本为 **V1.0.2**，已实现本地 skills 库、项目部署和公共 GitHub 来源的完整流程。提供 Windows x64 单文件免安装版和 ZTools 插件；macOS/Linux 尚未发布。1.0.2 暂未发布 GitHub Release，下方链接为已发布的桌面版。

**[下载已发布的 Windows 免安装版（V1.0.0-fix）](https://github.com/Candquarzy/Askills/releases/download/v1.0.0-fix/Askills_1.0.0-fix_windows_x64.exe)** · [版本说明](https://github.com/Candquarzy/Askills/releases/tag/v1.0.0-fix)

下载 EXE 后双击即可，界面和图标均内嵌。需要系统已安装 Microsoft Edge WebView2；Windows 设置和项目记录保存在 `%LOCALAPPDATA%\asklils`，全新使用时的默认 skills 库为 `%LOCALAPPDATA%\asklils\library`，可以在应用设置中更改库位置。

从 1.0.0 升级时，先退出旧版。首次启动会继承旧目录中的设置、项目、历史和偏好，旧目录保留；已有 skills 库（包括自定义位置）保持原路径，确保项目链接继续有效。若要把已有库也移入新目录，使用“设置 → 本地 skills 库”的迁移功能。请勿手动删除仍被使用的旧库。

## 在 ZTools 中使用

除了独立桌面版，也可以把 Askills 作为 **ZTools 插件**使用，目前支持 Windows x64。插件提供同一套 skills 库、项目、来源和设置，采用透明背景，并在选中卡片下方直接展开详情。

**插件中心 1.0.2 通过 [ZToolsCenter/ZTools-plugins #672](https://github.com/ZToolsCenter/ZTools-plugins/pull/672) 提交审核。** 审核通过并上架后，可在 ZTools 插件中心搜索 `Askills` 安装；审核期间可按下列方式本地安装。

本地安装步骤：

1. 执行 `pnpm install --frozen-lockfile` 和 `pnpm build:ztools`，生成 `artifacts/ztools/Askills.zpx`。
2. 将 `.zpx` 拖入 ZTools，核对插件名称 **Askills**、开发者 **Candquarzy** 后安装。
3. 在 ZTools 搜索 `Askills` 或 `skills库` 打开库；也可用 `skills项目`、`skills来源`、`skills设置` 直接进入相应页面。

插件与独立桌面版共用 `%LOCALAPPDATA%\asklils` 中的设置和记录，以及已配置的 skills 库。切换使用前先退出占用同一库的另一实例；出现 `LibraryBusy` 时，关闭另一实例后刷新即可。

插件中心的提交状态、构建要求与更多说明见 **[ZTools 插件指南](docs/ztools-plugin.md)**。

## 可以做什么

- **保存 skill**：从原生目录选择器导入完整 skill 文件夹，校验 `SKILL.md` 和附件，保留原目录，生成有来源、许可证和内容摘要的版本快照。支持自定义显示名称、按别名/原名搜索、Markdown / 原文阅读和版本差异查看。
- **连接项目**：手动登记项目或在指定目录中发现项目，扫描 Codex / Cursor / Claude Code 的已知 skill 路径，包括嵌套目录和仓库祖先作用域。
- **按项目使用**：在项目详情直接从库、云端或本地添加 skills，预览目标路径后，以符号链接、Windows junction 或复制启用固定版本。可逐个选择项目升级、回滚到前一版本或停用；检测到未知文件、入口替换或外部编辑时停止覆盖。
- **从 GitHub 下载**：可切换 GitHub API 和本地 Git，解析分支、标签或 commit，固定完整 commit 并校验文件内容，保留来源许可。独立“下载 / 预览 / 多选”，支持批量保存；顶部浮动通知显示真实文件进度，项目升级单独确认。
- **复用仓库地址**：查找时自动记录最近 10 个合法仓库地址，重复使用前移，应用重启后保留；来源页与项目内云端入口共用。

应用不会执行 skill 中的脚本。支持简体中文与英文界面，在“设置 → 语言与阅读”切换，重启后保留；skill 内容保留原文。

桌面版和 ZTools 插件统一使用本机字体，默认微软雅黑，不再打包完整字体文件。在“设置 → 个性化 → 界面字体”中可搜索、预览和选择已安装字体，选择自动保存；安装新字体后可刷新列表，已卸载字体会自动回退。

界面采用 WinUI 风格。在“设置 → 个性化”中可切换浅色/深色/跟随系统，选择 6 个预设主题色或自定义颜色，设置重启后保留。

每次启动窗口均为居中的 1080×720 逻辑像素；运行期间可以调整大小或最大化，下次启动恢复默认尺寸。

使用步骤见 **[用户指南](docs/user-guide.md)**；架构、当前实现范围和后续里程碑见 **[详细实现方案](docs/architecture.md)**。

## 本地开发

需要 Node.js 24、pnpm 11.22.0、Rust stable，以及系统对应的 [Tauri 前置依赖](https://v2.tauri.app/start/prerequisites/)。Windows 需要 MSVC C++ 工具链与 WebView2。

```sh
pnpm install --frozen-lockfile
pnpm tauri dev
```

`pnpm dev` 只启动浏览器预览，文件操作会禁用。桌面版首次启动创建本地应用数据目录，默认 skills 库在其中的 `library/`；可在设置中选择新位置，预览并确认迁移已有内容。

```sh
pnpm check
pnpm build
pnpm format:check
pnpm test:ui
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib
pnpm tauri build --debug --no-bundle -- --locked
```

浏览器测试在 Windows 使用已安装的 Edge，其他平台先运行 `pnpm exec playwright install chromium`。测试中的 IPC 使用 fixture；Rust 测试在临时目录验证真实文件系统行为。

最后一条构建命令生成 `src-tauri/target/debug/askills.exe`，不创建安装包。

构建正式单文件版本并整理分发文件（PowerShell 7）：

```powershell
pnpm tauri build --ci --no-bundle -- --locked
./scripts/collect-windows-packages.ps1
```

产物位于 `artifacts/windows-x64/`，包含 EXE、SHA-256 校验值、源码 commit 信息及 MIT 许可。输出目录必须为空，避免混入旧版本；可用 `-OutputDirectory` 指定其他空目录。当前 EXE 未进行代码签名。

Windows 原生冒烟：构建后执行 `pnpm test:native`；加 `--github` 验证 GitHub API 导入，加 `--git` 验证本机 Git 导入。联网模式还验证自定义名称保存。测试只使用独立临时数据目录。[逐步本地验收](docs/local-testing.md) 包含导入、部署、升级、回滚及冲突测试。

## 项目结构

```text
src/
  app/                      应用布局、串行任务和交互状态
  features/                 library、projects、sources 页面
  components/               安全 Markdown 阅读器与模态框
  lib/ipc/                  类型和 Tauri 命令调用
src-tauri/src/
  commands/                 IPC 授权、原生目录选择、取消与任务调度
  domain/                   领域数据和错误类型
  services/                 导入校验、项目扫描、部署与恢复
  adapters/                 Agent 路径与共享读取关系
  storage/                  SQLite、manifest、版本快照
  platform/                 路径边界、内容校验和文件操作
  sources/                  GitHub 来源与固定版本下载
tests/ui/                   关键操作流程的浏览器测试
.agents/skills/             本项目开发使用的 Rust / Tauri skills
third-party/skills/         开发 skills 的上游许可和固定来源
docs/                      实现方案、使用说明、验证记录
```

开发 skills 不是应用为用户管理的 skills 库。它们的来源与哈希见 [开发 Skills 说明](docs/development-skills.md)。
