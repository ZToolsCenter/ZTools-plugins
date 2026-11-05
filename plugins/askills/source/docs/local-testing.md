# 本地测试与验收

当前验收平台为 Windows。请在仓库根目录执行命令；不要用重要项目练习冲突或故障场景。

## 1. 启动桌面版

```powershell
pnpm install --frozen-lockfile
pnpm tauri dev
```

需要 Node.js 24、项目锁定版本的 pnpm、Rust stable、MSVC C++ 与 WebView2。开发时保持终端开启；关闭后用 Ctrl+C 停止开发服务器。

窗口应出现“skills 库 / 项目 / 来源 / 设置”。首次启动是空库，点击设置可看到实际库位置。已有库保持原状，不会注入示例数据。`pnpm dev` 只有浏览器预览，无法验证文件操作。

每次启动主窗口均使用 1080×720 逻辑像素并居中，不恢复上次的大小或最大化状态；运行期间仍可正常调整大小、最大化。手动调整或最大化后关闭，再启动检查尺寸一致。系统缩放会影响实际物理像素。

## 更改 skills 库位置

建议用独立测试库和测试项目验收：

1. 先导入一个 skill，并安装到测试项目；已有内容时“设置 → 本地 skills 库 → 选择 skills 库位置”应可点击。
2. 选择专用空目录，检查预览中的旧位置、新位置、版本数量和大小。点取消后，当前位置和项目文件均不改变。
3. 再次选择并确认迁移，应立即显示顶部操作通知和进度条。完成后设置显示新路径，原目录仍存在作备份。
4. 回到 skills 库读取原文和历史版本，扫描项目确认受管理安装正常；尝试重新导入和添加到项目。关闭再启动，确认仍使用新位置。
5. 选择含无关文件的目录或旧库的子目录，应拒绝迁移且保留旧库。较大库复制期间可取消，完成取消后可重新选择并重试。
6. 切换 English，重复预览和取消，确认路径、数量、按钮与通知正常显示。

前端流程可单独运行 `pnpm exec playwright test tests/ui/library-migration.spec.ts`。它使用模拟 IPC，真实文件复制、校验、链接更新和故障恢复仍需 Rust/原生检查。确认新库与项目均正常后，才自行处理保留的旧目录。

## 2. 创建独立的测试素材

在另一个 PowerShell 窗口中执行：

```powershell
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('askills-manual-' + [guid]::NewGuid())
$skillPath = Join-Path $testRoot 'demo-skill'
$projectPath = Join-Path $testRoot 'demo-project'
New-Item -ItemType Directory -Path $skillPath, $projectPath | Out-Null
$sample = @'
---
name: demo-skill
description: 用于 Askills 本地验收的最小 skill
license: MIT
---
# Demo skill
这是版本 v1，仅用于验证文件管理。
'@
[IO.File]::WriteAllText((Join-Path $skillPath 'SKILL.md'), $sample, [Text.UTF8Encoding]::new($false))
Write-Output "skill 目录：$skillPath"
Write-Output "项目目录：$projectPath"
```

本例把测试素材放在新的临时目录中，不接触已有项目。保留这个终端，后面会继续使用变量。

## 3. 验证 skills 库

1. 点击“导入本地 skill”，选择上面的 `demo-skill` 文件夹。
2. 预览应显示名称、描述、文件数、许可证和正文。先关闭预览：库应仍为空。
3. 再次选择并确认导入，库中出现 `demo-skill`；搜索 `demo` 能找到它。
4. 点击 skill 卡片，切换“阅读”和“原始 Markdown”。原文应包含 frontmatter。
5. 再导入相同目录：内容未变时不增加版本数。来源目录和原始文件仍存在。
6. 打开 skill 详情 → “编辑显示名称”，保存“我的演示 skill”。按该别名搜索应能找到它；原始名称仍是 `demo-skill`。
7. 重启桌面应用，别名应保留。查看“原始 Markdown”，`name` 仍为 `demo-skill`；“恢复原名”应清空别名。

## 4. 验证项目部署、更新和回滚

1. 到“项目”点击“添加项目”，选择测试 `demo-project`。普通空目录也可以登记。
2. 点开测试项目 → “添加 skills” → “从 skills 库”选 `demo-skill` → “下一步” → Codex → **复制**。目标项目已选中且不能切换。skills 库详情的“添加到项目”入口也仍可使用。
3. 预览目标应为 `<测试项目>/.agents/skills/demo-skill`。确认前没有此入口；确认后其中的 `SKILL.md` 应为 v1，同时生成项目 `askills.lock.json`。
4. 在原 PowerShell 中修改来源文件，然后重新导入：

```powershell
$sampleV2 = $sample.Replace('版本 v1', '版本 v2')
[IO.File]::WriteAllText((Join-Path $skillPath 'SKILL.md'), $sampleV2, [Text.UTF8Encoding]::new($false))
```

5. skills 库应显示两个版本。重新打开卡片可选旧版本、比较文件变化；此时项目文件仍应为 v1。
6. 选择最新版本，再添加到同一项目和同一 Agent 目录，预览升级后确认。项目应变为 v2。
7. 在“项目”选择测试项目，点击“回滚”并确认，项目回到 v1；库仍保留两个版本。
8. 点击“停用”并确认，项目 skill 入口移除，来源目录和库快照保留。
9. 再用 **自动模式** 安装一次。在 Windows 上可能使用 symlink 或 junction，界面会显示实际方式。停用后链接消失，库文件仍存在。

本步骤只证明目录部署。对应工具能否发现或调用，需要另开 Codex/Cursor 会话、记录工具版本并实际验证。`.agents/skills` 可能同时被多个 Agent 读取。

另外验证项目添加弹窗的“从本地”和“从云端”：分别选择测试 skill 目录、查询第 6 节的公共仓库。预览点击“导入并继续”后应进入当前项目的安装预览；关闭安装预览时，skill 已经保存在库中，但项目尚未改变。确认应用后仍停留在刚才的项目详情。

## 右键菜单与多选

1. 在 skill 卡片上右键，确认只出现“重命名 / 添加到项目 / 多选 / 删除”，不自动打开正文。用重命名修改别名，再用 `Shift+F10`、上下方向键和 `Esc` 检查键盘操作。
2. 导入两个**不同名称**的测试 skill，右键 → 多选，勾选后批量添加到测试项目。预览前项目应没有新增文件；确认后检查两个目标目录。若两项 skill 名称相同，预览应提示安装路径重复并阻止这两项写入。
3. 多选后点“删除所选”，先取消确认，条目应保留；再确认，条目从列表消失，但已安装 skill 仍可读取。重启后不应自动重新出现；重新导入同一来源应恢复原条目和版本历史。
4. 右键测试项目 → 备注项目名。项目卡片、详情和添加 skills 窗口应显示备注，文件夹名和路径保持不变。多选删除项目后检查其文件仍在；重新添加同一路径，备注和已安装 skill 管理记录恢复。
5. 到来源、设置及空白区域右键，不应出现浏览器菜单。在窗口右侧/底部打开卡片菜单，菜单不能超出窗口；点击外部或滚动页面后菜单关闭。切换 English 与深色模式检查文案和可读性。

专项自动测试：`pnpm exec playwright test tests/ui/context-menu.spec.ts`。删除当前为逻辑移除，不释放快照磁盘空间；这些步骤可使用第 2 节的临时素材进行。

## 5. 验证外部修改保护

重新用复制模式安装后，只在测试项目中修改已复制的 `SKILL.md`，再尝试停用或升级。预期看到错误/内容变化提示，修改后的文件保留，不能显示操作成功。

不要手工删除真实项目的恢复记录或篡改数据库。故障恢复、入口替换和中断复制等场景用下一节的 Rust 临时目录测试验证；当前界面尚无自动接管或修复向导。

## 6. 验证 GitHub 来源

1. 到“来源”输入 `https://github.com/Candquarzy/Askills`，分支填 `main`，点击“查找 skills”。
2. 找到 `.agents/skills/tauri-setup`，确认有“下载 / 预览 / 多选”。点击“预览”，关闭后不会入库。
3. 点击“下载”可直接入库；或再次预览并点击“下载到 skills 库”。操作后仍在来源页，切换 skills 库可见 GitHub 卡片、来源与完整版本。
4. 点击“检查更新”，重新解析来源；同一提交与内容不会重复增加版本。项目不会因来源变动自动升级。

这是一次真实网络请求；断网或达到 GitHub API 配额时应显示失败，不能伪造“已导入”。默认 API 模式不需要配置个人 GitHub 凭据。

勾选两个候选后“下载所选”，查看顶部浮动通知、真实文件进度和每项“已下载”状态。滚动页面时通知仍在视口顶部。取消后后续项不再开始，已经保存的 skill 保留；失败项可重试且不会重复下载成功项。项目内批量下载会先加入 skills 库，再由你选择安装。

再点“本地 Git” → “检查 Git 安装”，预期显示 `git version ...`（未安装时应提示安装并重启）。输入同一仓库和分支，查找、预览、确认导入。切换模式应清除上次候选，保留输入地址；只更换获取方式且提交/内容相同时应复用原有版本，不重复创建 skill。可在项目“从云端”里重复该流程，目标项目不能改变。

Git 模式使用本机代理/凭据和独立临时仓库，不在项目中执行 pull 或合并。普通测试只需要公共仓库；无应用内 GitHub 登录。未安装 Git 的环境可以继续使用 API。

## 7. 自动化检查

语言可在“设置 → 语言与阅读”切换 English，检查导航、设置、库/项目/来源、预览弹窗和下载进度已变为英文；skill 正文和自定义名称不变。完全退出再启动，英文选择与主题均应保留，窗口恢复 1080×720；再从 Settings → Language and reading 切回简体中文。语言切换无需联网。

个性化外观可在“设置”中验证：切换预设色、用色盘或输入 `#ffcc00` 应用自定义颜色，再切换浅色/深色/跟随系统。按钮、导航选中、弹窗与进度应统一变化，亮色按钮文字仍清晰。退出应用再启动，设置应保留；“恢复默认”回到系统模式与默认蓝。输入非法颜色时不能提交。在“界面字体”搜索并选择 Arial 或其他本机字体，检查中文预览、按钮、路径与代码展示，重启后应保持选择。点击“刷新字体列表”重新读取安装的字体；恢复默认后字体回到微软雅黑。桌面版和 ZTools 插件共用偏好，需退出前一个实例后再验证另一端。

仓库历史可这样验证：在来源页查找一个仓库，页面下方、推荐仓库上方的“历史记录（最近10条）”中出现同款仓库按钮；退出并重新打开应用后仍可点击。点击历史按钮应填入地址、清空旧分支并聚焦地址框，不自动查找。依次查找超过 10 个不同仓库，只保留最近 10 个；再次使用已有地址会前移而不重复。网络失败保留合法地址，非法/含凭据地址不保存。项目内“从云端”能选择同一份历史。

按模块运行 Rust 测试：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib storage::tests
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib storage::repository_history
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib storage::appearance
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib storage::locale
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib services::library
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib services::projects
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib services::deployments
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib sources::github
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib sources::github::git
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib commands::tests
```

完整检查：

```powershell
pnpm format:check
pnpm check
pnpm build
pnpm test:ui
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib
```

`test:ui` 在 Windows 使用已安装的 Edge，其他平台需要 `pnpm exec playwright install chromium`。它使用 IPC fixture 验证前端流程，不会访问真实库、项目或网络。Rust 用例在临时目录执行真实文件操作；普通全量测试默认跳过联网用例。

验证已构建的真实 Windows 桌面应用：

```powershell
pnpm tauri build --debug --no-bundle -- --locked
pnpm test:native
pnpm test:native --github
pnpm test:native --git
pnpm test:native --git --download
```

原生测试启动 `src-tauri/target/debug/askills.exe`，使用独立临时数据目录和 WebView2 缓存，通过仅本机的调试端口操作真实 IPC。结束后关闭测试进程并清理它创建的临时目录，证据保存在 `test-results/native/`。`--github` 通过 API、`--git` 通过本机 Git 在原生 UI 中执行本仓库公共 skill 的查询、下载、确认导入与阅读，随后保存别名并重新加载页面检查持久化；不修改真实用户 skills 库。临时数据目录覆盖只在调试构建启用。

默认原生冒烟还验证系统字体枚举、微软雅黑实际渲染且没有字体资源请求，以及自定义字体和深色/自定义主题色经真实 SQLite 保存、页面重载后恢复；不访问用户实际设置。主题截图保存在 `appearance-dark.png`。

原生冒烟也验证中英文切换、页面重载与进程重启保留语言、原生标题更新，以及调整大小/最大化后正常关闭重启仍为默认尺寸。英文截图为 `settings-english.png`。测试只调整、关闭其自身创建的隔离窗口。

默认 exe 正在运行时会被 Windows 占用。关闭自己的应用再构建，或者用独立名称验证：

```powershell
pnpm build
cargo rustc --manifest-path src-tauri/Cargo.toml --locked --bin askills --features tauri/custom-protocol -- -C extra-filename=-verify
$env:ASKILLS_SMOKE_EXE = 'src-tauri/target/debug/deps/askills-verify.exe'
pnpm test:native --git
Remove-Item Env:ASKILLS_SMOKE_EXE
```

可单独运行显式的 Rust 联网检查：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib native_git_public_smoke -- --ignored --nocapture
```

这些检查不能代替正式安装包、macOS/Linux 或真实 Agent skill 加载验收。项目当前记录的结果见 [验证记录](validation.md)。
