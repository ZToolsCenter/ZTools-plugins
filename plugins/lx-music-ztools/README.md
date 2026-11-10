# LX Music for ZTools

将 LX Music 2.12.6 移植到 ZTools 的开发项目，不依赖另装 LX 桌面版。当前版本为 **0.0.2 开发版**，完整移植仍在进行。

目前已验证原 LX 界面、自定义音源本地/URL 导入、隔离执行、受控音源解析与音频播放、暂停/继续、后台播放及下一首。下载、同步、开放 API 等功能尚未完成验证，详见 [功能与验证状态](docs/ztools/compatibility.md)。不预置第三方音源。

## 开发与安装

```powershell
npm ci
npm run build:ztools
```

本地代码和隔离测试中的安装记录不会自动出现在日常使用的 ZTools 中。把 `src-ztools/plugin.json` 导入 ZTools 开发项目，然后安装、启用项目，才能输入「洛雪音乐」「LX Music」或「lxmusic」打开插件。

```powershell
npm run pack
```

完整运行目录为 `src-ztools`，默认播放器入口为 `dist/lx.html`。构建包含原 LX Webpack 前端、逐模块可读 CommonJS 服务与隔离音源 Worker。ZIP 输出到工作目录同级的 `output/lx-music-ztools`，包含运行依赖，不需要开发服务器。

在 ZTools「设置 → 插件应用 → 导入本地插件」选择 ZIP，确认安装并启用，再输入 `lxmusic` 打开。音源在原 LX 设置的「自定义源管理」中通过本地 JS 或 URL 导入并选择。详见 [本地安装](docs/ztools/installation.md)。

## 验证

- `npm run build:ztools`：类型检查、前端和服务构建、插件安装目录校验。
- `npm run test:ztools`：桥接、SQLite 事务、数据、设置、网络、文件能力与音源契约。
- `npm run test:p0`：隔离音源、安全边界、宿主生命周期及存储能力。
- `npm run test:source`：受控音源协议和原界面本地/URL 导入流程。
- `npm run test:player`：原 LX 引擎播放受控 WAV，检查进度、暂停/继续、后台和下一首。
- `node scripts/test-install.mjs`：实际 ZIP 安装后搜索 `lxmusic` 并打开原播放器。
- `npm run test:publish`：调用官方 CLI 1.3.2，在新临时 Git 仓库中两次发布；GitHub 和认证被替换成测试响应，不创建线上 PR。
- `npm run test:host`：使用独立 Electron 运行本机 ZTools app.asar，测试数据写入独立临时目录。通过 `ZTOOLS_EXECUTABLE` 指定 Electron 可执行文件，通过 `ZTOOLS_APP` 指定 ZTools app.asar；两者均需已存在。宿主测试不使用用户真实配置。

原生移植测试报告位于 `artifacts/`。受控音源和音频结果不能代替用户真实音源、真实平台服务及人工听音验收。

## 真实发布

```powershell
gh auth status
npm run pack
git add .
git commit -m "chore: prepare release"
npm run publish:plugin
```

发布包装器复用已登录的 gh 凭据，通过 gh api 发送真实 GitHub REST 请求，并修正 CLI 1.3.2 在 Windows 下的 Git 参数引号；其余发布校验、Fork、上游同步与分支保护、提交、推送和 Draft PR 由官方 CLI 执行。缓存位于 `~/.config/ztools/lx-music-ztools-sparse`，凭据仅用于当前进程，完成后清除缓存 remote URL 中的凭据。

CLI 1.3.2 要求当前版本的日志标题 `## 0.0.2 - YYYY-MM-DD`、非默认图标以及干净的 Git 工作区。该版本会从最新 upstream/main 重建发布分支，并使用精确 force-with-lease 防止覆盖竞态提交；这与官网页面旧版“只追加、不改写”的描述不同。

Draft PR 创建后须补充截图、自检结果和明确的功能范围，再提交审核。当前以开发版范围送审，不宣称下载、同步等完整移植已经完成。

## 来源与许可

原 LX 源码基线为 `lyswhut/lx-music-desktop@323e4bac`，只读保留在 `vendor/lx`，沿用 Apache-2.0 许可证。适配代码、构建及宿主替换模块位于其外，出处见 `vendor/lx/UPSTREAM.md`。项目从 ZTools 官方 Vue 模板起步，是第三方移植开发，不是 LX 官方发行版。
