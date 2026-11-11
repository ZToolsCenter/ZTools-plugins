# 上游差异、打包与许可

项目是 LX Music Desktop 2.12.6 的第三方 ZTools 原生移植，不是 LX 官方发行版。只读上游位于 `vendor/lx`，来源为 `lyswhut/lx-music-desktop@323e4bac`，Apache-2.0；完整出处见 `vendor/lx/UPSTREAM.md`。同步验收对端是官方2.12.6 Windows x64 green，二进制archive SHA256为 `a07d2a15dbcf06ce689bf8b99c64241b06deb28fdfb6ffe79b6dcdfbb0d157a5`，不混同源码基线与发行包hash。

## 保留与适配

保留原 Vue UI、musicSdk、列表模型、音频/DSP/歌词引擎、原备份格式、下载UI语义及同步/开放API协议。插件不启动原LX完整主进程，也不附带桌面安装器、托盘、自动更新器或better-sqlite3原生二进制。

`src/ztools` 提供renderer IPC、网络/worker/文件能力、播放器/目录入口及宿主UI适配；`src-ztools/preload/runtime` 提供可信服务。Webpack别名替换Electron/Node入口；loader按已知源码shape调整下载、备份、设备选择和宿主设置，shape变化即报错。`scripts/build-runtime.mjs` 把需要的原TS模块按文件生成可读CJS并保留来源/改动注释，不bundle/minify/混淆这些服务模块。vendor保持不变，不能把生成CJS误称原上游原封不动的运行文件。

结构化数据换成宿主pluginData中的内置node:sqlite；设置/列表同一事务；不依赖ZTools云db。用户源从原桌面隐藏窗口执行改为隔离CSP浏览器Worker，HTTP/取消走受控桥；DOM依赖脚本存在明确兼容限制。真实宿主不支持Node Worker的metadata执行路径用公开隐藏窗口替代，只运行可信标签代码。

下载增加阶段持久化、资源与inode归属校验、同名保护、Range/validator验证、有界重试和最终化ACK。metadata原子rename后fingerprint未落盘的窄窗保守保留文件并报告ownership错误。所有新下载需目标文件系统支持hard link。同步保留wire和原merge算法，适配生命周期/取消/落盘失败/快照队列；认证新增/撤销/首次identity及客户端key使用同目录临时文件、file.sync、rename，提交后才发布内存和成功ACK，失败保留旧态，旧metadata不能复活已撤销key。list/dislike不是跨模块分布式原子事务；普通快照的节流/重试与认证事务分开，不宣称磁盘硬件断电保证。

窗口尺寸/全屏/托盘/更新由ZTools管理；歌词窗口走公开BrowserWindow代理；快捷键走宿主指令和设置。任务栏缩略图按钮、独立电源锁、状态栏歌词和系统全屏自动隐藏不提供有效实现。输出设备枚举缺失时只能系统默认输出。全部默认设置见 [逐项映射](settings-map.md)。

## 独立运行包

`npm run pack:ztools` 显式组装到新临时目录，再生成 `dist-ztools/lx-music-ztools-0.1.2.zip` 和 `.zip.sha256`。包内入口为根 `plugin.json` → `dist/lx.html` / `preload/services.js`，运行依赖完整落在 `preload/node_modules`，不依赖开发目录node_modules或外部LX安装。

组装白名单为 `plugin.json`、`logo.png`、`LICENSE`、`NOTICE`、`THIRD-PARTY-NOTICES.txt`、`native-jobs.html`、`dist`、`preload`，并生成 `build-info.json`。校验覆盖主页面、歌词页、字体/语言等前端资源清单、source Worker、AudioWorklet、preload、锁文件和传递依赖；缺失应失败。ZIP按固定顺序和时间戳生成，同一构建输入可复现SHA256。逐文件回执记录插件版本/LX基线/文件SHA256；宿主验证版本和实际验收结果另见矩阵，不用静态回执冒充运行验收。

包不递归复制工作区，禁止原生.node、SQLite用户库及.part；没有原始用户音源、私人脚本URL/凭据或私有临时测试证据。开发tests中的受控音源/合成音频是验证fixture，不是产品内置第三方音源。

## 许可与通知

根LICENSE与包内LICENSE保留Apache-2.0；NOTICE说明原LX来源、基线和本项目修改。`THIRD-PARTY-NOTICES.txt` 包含声明的浏览器/runtime完整生产依赖图的版本、许可和原始许可文本，包含可能被tree-shaking剔除的声明依赖；独立runtime中的依赖许可也保持原文件。生成器缺少许可文本时失败，少数上游包无独立文本的情况采用有出处的许可补件。

许可清单不收集用户音源。真实样本验证证据只保留在私有临时目录，既不属于依赖许可，也不随产品或源码打包分发。当前版本未发布或推送；历史0.0.2送审记录不能代表0.1.1已经上架。
