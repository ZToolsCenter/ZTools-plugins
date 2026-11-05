# ZTools 插件

Askills 的 ZTools 插件复用桌面版的 React 界面与 Rust 业务逻辑，提供 skills 库、项目、来源和设置四个页面。目前支持 Windows x64，当前版本为 **1.0.2**。插件中心通过官方仓库 PR 审核后上架。

1.0.2 的审核提交为 **[ZToolsCenter/ZTools-plugins #672](https://github.com/ZToolsCenter/ZTools-plugins/pull/672)**，沿用首次提交的 PR，补充本机字体选择和包体积优化。审核与上架状态以该 PR 和插件中心为准。

## 本地安装与使用

构建后，将 `artifacts/ztools/Askills.zpx` 拖入 ZTools，或用 ZTools 打开该文件。在安装确认页核对名称为 **Askills** 后安装。

在 ZTools 搜索框输入以下任意指令进入相应页面：

- `Askills`、`skills库`：管理本地 skills。
- `skills项目`：登记项目并添加 skills。
- `skills来源`：从 GitHub API 或本地 Git 获取 skills。
- `skills设置`：设置语言、主题和库位置。

插件保留中英文界面、本机字体选择、应用图标、自定义主题、原生目录选择、下载进度、批量操作和库迁移。“跟随系统”在插件中跟随 ZTools 的主题；手动选择浅色或深色仍优先。

安装确认页的开发者为 **Candquarzy**。插件版的 skill 和项目列表使用单列布局，详情在选中卡片正下方展开；点击同一卡片或“收起”可折叠，选择另一项会切换详情。

字体默认微软雅黑，可在“设置 → 个性化 → 界面字体”读取并选择本机已安装字体，与桌面版共用偏好。插件不再内置完整 MiSans 字体；旧配置自动使用默认字体并保留主题色。

插件使用透明页面底色和半透明卡片，透出 ZTools 的窗口背景材质，文字保持完整不透明。浅色和深色均适配；若手动选定的应用主题与宿主主题不同，会增加底色以保持文字清晰。“减少透明度”或高对比度模式使用实色。最终窗口效果随 ZTools 的亚克力、Mica 等设置变化，插件不更改宿主设置。

设置和记录与桌面版共用 `%LOCALAPPDATA%\asklils`，已有自定义库路径保持不变。首次使用插件前，退出正在使用相同库的 Askills 桌面版；两个宿主通过同一套文件锁避免同时修改数据。如果看到 `LibraryBusy`，退出另一实例后点击刷新即可。

退出插件会停止剩余批量任务，通知 Rust 完成或取消当前操作，然后释放数据锁。重新进入会重新读取数据，旧的导入预览与来源候选需要重新获取。

## 构建

沿用项目的 Node.js、pnpm、Rust 和 Windows MSVC 工具链：

```powershell
pnpm install --frozen-lockfile
pnpm build:ztools
```

产物包括：

- `artifacts/ztools/Askills.zpx`：供 ZTools 本地安装的插件包。
- `artifacts/ztools/Askills/`：展开的开发插件，其中的 `plugin.json` 可通过 ZTools 官方开发者插件导入。

构建不会覆盖已有非空产物目录。重复构建可指定新目录：

```powershell
pnpm build:ztools --out-dir artifacts/ztools/Askills-next
```

对应包输出为 `artifacts/ztools/Askills-next.zpx`。打包使用 Electron ASAR 和 Brotli；`plugin.json` 中的 `unpack: "helper/**"` 让 ZTools 将 Rust 程序解包后启动。构建、测试和 CI 都不会调用插件发布命令。

## 验证

```powershell
pnpm check
pnpm test:ztools
pnpm test:ztools:helper
pnpm exec playwright test tests/ui/ztools.spec.ts
pnpm test:ztools:host
pnpm test:ztools:host --archive
```

`test:ztools` 测试 preload 的命令白名单、进程断开、协议版本、目录选择和退出重入。`test:ztools:helper` 使用真实 Rust helper 与临时文件，验证导入、项目部署、升级、回滚、库迁移和锁释放；目录选择由测试提供。

`test:ztools:host` 调用本机安装的 ZTools，在系统临时目录下创建独立宿主配置和 Askills 测试库，运行真实界面与原生目录选择器。默认程序路径是 `D:\Software\ZTools\ZTools.exe`，其他位置可通过 `ASKILLS_ZTOOLS_EXE` 指定。测试只关闭自己启动的宿主。截图与报告保存在控制台输出的 `%TEMP%\ztools-smoke-*` 目录。

`--archive` 额外走宿主的 `.zpx` 安装与解包流程，从 ASAR 内加载同一套界面和 preload，验证 Rust helper 的解包路径。测试使用开发注册来隔离 Askills 数据，不会写入个人库。

宿主测试会打开系统文件夹选择器，验证返回授权并立即释放；不会对默认选中的目录进行导入、扫描或写入。导入、项目部署、升级回滚与库迁移由 `test:ztools:helper` 在临时目录验证。请勿在宿主测试运行时操作其测试窗口。

CI 在 Windows 构建桌面 EXE 与 ZTools 包并保留为构建附件，不自动发布。真实 ZTools 宿主测试需要本机安装，因此不在 GitHub runner 上运行。

## 提交插件中心

插件中心使用 [官方 fork／PR 流程](https://docs.z-tools.top/publish-and-update.html)。发布目录与本仓库分开准备，避免把个人数据、测试运行结果或整个开发目录当作可执行插件分发。

先完成本地提交并保证工作区干净，然后运行：

```powershell
pnpm build:ztools --out-dir artifacts/ztools/Askills-publish-build
pnpm prepare:ztools:publish --plugin-dir artifacts/ztools/Askills-publish-build --out-dir artifacts/ztools/Askills-center
```

准备目录包含：`payload/` 中经过本机验证的运行文件、`source/` 中来自已提交版本的完整源码快照、逐文件 SHA-256 摘要、MIT／字体许可、更新记录和使用说明。运行文件包含预编译的 Windows x64 Rust helper；源码快照可用于重新编译及审查。

中心构建执行准备目录的 `node build.mjs`，验证运行文件摘要并生成 `dist/`，只分发实际插件文件。中心当前的 Node.js 20 构建环境不需要安装本项目的 Rust／Node.js 24 工具链；从源码重新编译的命令保留在准备目录说明中。

`prepare:ztools:publish` 不访问 GitHub、不推送或发布。准备目录可按官方 CLI 的要求初始化为独立 Git 仓库后执行 `ztools publish`；也可使用已登录的 GitHub CLI，按同一 fork、插件分支和 PR 流程提交。提交时应附截图、填写自检清单并将 PR 标为可审核；提交审核不等于已经上架。

## 代码结构与调用范围

- `src/app/HostApp.tsx`：宿主进入、退出与界面生命周期。
- `src/lib/host.ts`、`src/lib/ipc/client.ts`：Tauri 与 ZTools 的调用适配。
- `ztools/`：插件清单和保持可读的 CommonJS preload。
- `src-tauri/src/commands/desktop.rs`：Tauri 命令包装。
- `src-tauri/src/commands/stdio.rs`：Rust helper 的 JSON 行协议。
- `scripts/build-ztools.mjs`：本地构建与打包。

前端只能调用固定命令；目录授权来自 ZTools 原生选择器。helper 使用继承的 stdin/stdout 管道，不监听网络端口。来源下载仍由现有 Rust 校验逻辑处理，Markdown 不执行 HTML 或加载远程图片。生产插件页面带独立 CSP，preload 不压缩、不混淆。`ASKILLS_ZTOOLS_TEST_DATA_DIR` 仅在 ZTools 开发模式的隔离测试中生效，界面不能设置这个路径。

实现参考：[第一个插件](https://docs.z-tools.top/first-plugin.html)、[插件清单](https://docs.z-tools.top/plugin-json.html)、[preload 规范](https://docs.z-tools.top/preload-js.html)及本机 ZTools 的插件安装实现。
