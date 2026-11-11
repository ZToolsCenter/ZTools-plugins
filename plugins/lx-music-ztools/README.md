# LX Music for ZTools

LX Music 2.12.6 的第三方 ZTools 原生移植，目标版本 **0.1.2**。保留原 LX 界面、播放器、音源管理、搜索、列表、下载与同步流程，业务服务运行在插件中，无需另装或启动 LX 桌面应用。此项目不是 LX 官方发行版，不附带第三方音源。

Windows x64 为首验平台。当前已验证原播放器、本地 MP3/FLAC/WAV 与 DSP、受控搜索/榜单/歌单、下载与标签、备份、原桌面歌词、开放 API，以及与官方 LX 2.12.6 的双向同步。真实用户音源样本中已完成一次真实播放和下载；这些结果有明确范围，不能推导所有源或平台均可用。**核心播放/下载检查点已通过30分钟后台与50次进出测试；最终ZIP回归另记。0.1.2通过源码仓库及ZTools插件中心更新流程提交，市场版本以审核合并结果为准。** 完整矩阵见 [功能与验证状态](docs/ztools/compatibility.md)。

## 构建与安装

```powershell
npm ci
npm run build:ztools
npm run pack:ztools
```

目标 ZIP 为 `dist-ztools/lx-music-ztools-0.1.2.zip`，校验值保存到同名 `.zip.sha256`。版本以包内 `plugin.json` 为准，构建回执为 `build-info.json`。相同构建输入按固定顺序和时间戳打包，可比较 ZIP SHA256；不承诺不同机器或依赖版本产生相同字节。

在 ZTools「设置 → 插件应用 → 导入本地插件」选择 ZIP，确认安装并启用，输入「洛雪音乐」「LX Music」或 `lxmusic` 打开。也可把 `src-ztools/plugin.json` 注册为开发项目后安装。隔离测试实例中的安装记录不会自动出现在日常实例。播放器入口是 `dist/lx.html`，运行包包含独立依赖，不需要开发服务器或源码目录的 `node_modules`。

在原 LX 设置的「自定义源管理」中本地或在线导入兼容 LX API 2.0.0 的用户自备脚本，再选择音源。脚本只在隔离浏览器 Worker 中执行，依赖 DOM 的脚本可能不兼容。原始用户音源、脚本 URL 和凭据不进入仓库或产品包。

## 使用与数据

0.1.2修复六档字体大小只改变根字号、正文仍固定像素的问题，恢复原LX的相对尺寸构建规则。更新本地ZIP后终止旧插件并重新打开，以加载新样式；详见[实际字号测量](docs/ztools/font-size-fix.md)。

设置已按分区逐项审计，修复定时暂停保存、同步角色恢复、备份/文本导出后缀授权、搜索清理联动、缓存失败恢复及音频输出路由等问题。网络代理覆盖 Node 请求、原播放器与下一曲预加载。按用户决定，非歌词的独立桌面窗口选项从界面移除，歌词相关选项保留；没有公开宿主能力的歌词选项仍标明限制。维护者与来源显示为 **By: jiang66-so · From: 落雪无痕（lyswhut）**。详见[设置验收记录](docs/ztools/settings-validation-report.md)。

隐藏插件会继续播放、下载及已启用的同步/API 服务；终止插件会关闭服务，不能用隐藏代替退出。音乐数据存于宿主 `getPath('pluginData')` 指定的设备本地目录和 SQLite，与 ZTools 账号云数据独立。换设备或迁移前使用 LX 备份/恢复，或显式配置 LX 同步；备份不包含本地音频和用户音源脚本。

下载请在原设置中选择可写目录。**所有新下载都要求目标文件系统支持 hard link（通常为本地 NTFS）**；不支持时明确失败。续传会校验服务端 Range/validator、文件身份与长度；标签支持 MP3/FLAC，歌词可独立保存。异常恢复不会凭同字节内容认领用户文件。具体限制、故障排查与卸载见 [安装和迁移](docs/ztools/installation.md)。

## 验证与开发

```powershell
npm run test:ztools
npm run check:ztools
npm run build:ztools
npm run pack:ztools
npm run test:ztools:e2e
```

宿主验收应串行执行；用 `npm run test:ztools:e2e -- --list` 查看分组，用 `-- --grep "^(player|library)$"` 选择专项。所需环境、专项脚本和证据位置见 [验证矩阵](docs/ztools/compatibility.md)。本次实际宿主是已安装 ZTools 3.3.0-beta.2 的 `app.asar`，由与安装 EXE 匹配的独立 Electron 41.4.0 / Node 24.15.0 在临时数据目录启动；这不等于直接在日常 `ZTools.exe` 中完成全部验收。人工听音、真实物理快捷键、其他系统和未覆盖外部服务仍未验。

[文档导航](docs/ztools/README.md) · [宿主能力](docs/ztools/host-capabilities.md) · [逐项设置映射](docs/ztools/settings-map.md) · [模块映射](docs/ztools/module-map.md) · [上游差异与许可](docs/ztools/upstream-diff.md)

## 来源与许可

原 LX 基线为 `lyswhut/lx-music-desktop@323e4bac`（2.12.6），只读保留于 `vendor/lx`，沿用 Apache-2.0。适配、构建与宿主替换位于其外，来源见 `vendor/lx/UPSTREAM.md`。项目从 ZTools 官方 Vue 模板起步。运行包保留 `LICENSE`、`NOTICE` 和完整生产依赖许可 `THIRD-PARTY-NOTICES.txt`；私有测试证据和真实用户音源不属于分发文件。
