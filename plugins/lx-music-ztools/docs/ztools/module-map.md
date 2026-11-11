# LX 到 ZTools 的模块映射

原 `vendor/lx` 基线 `323e4bac` / 2.12.6 保持只读。构建以别名和精确 shape loader 适配，在源码目录外生成逐模块可读 CJS；不需要旁边的 LX 桌面工作目录。

| 原调用方/处理器 | 插件适配位置 | 当前行为与验证边界 |
| --- | --- | --- |
| common/rendererIpc → Electron ipcMain | `src/ztools/rendererIpc.ts`、`preload/runtime/bridge.cjs` | 同步快照/异步调用/订阅与once清理，未知通道显式错误 |
| 原 main 初始化/AppEvent/global.lx | `preload/runtime/index.cjs`、`context.cjs`、原 `upstream/main/event/index.cjs` | 插件单独上下文，不装载整套LX主进程；与renderer状态分离 |
| 设置、列表/下载记录/不喜欢/歌词/URL/换源数据 | `runtime/settings.cjs`、`data.cjs`、`database.cjs` 与 upstream SQL模块 | 同一设备本地SQLite，事务回滚/重开；不使用账号云db替代事务 |
| 原renderer/main/worker/main | `src/ztools/entry.ts`、`worker.ts`、`runtime/worker-main.cjs` | 原UI/业务方法保留；Node/文件/数据库经可信preload |
| 原musicSdk/request/crypto/dns | `src/ztools/request.ts`、`runtime/network.cjs`及浏览器纯计算适配 | 目录SDK沿用原JSON策略；标准源requestSource独立保留原Needle默认编码、回调/取消及Buffer区别；同步工具/五平台受控与LIVE分别记录 |
| UserApi hidden BrowserWindow | `runtime/source/`、独立CSP浏览器Worker | 原API2.0.0导入/管理/初始化，DOM依赖限制；真实脚本不入仓 |
| 原音频引擎/core/player | `src/ztools/player.js`、`runtime/player.cjs` | 原audio与DSP保留，状态/控制一份；本地格式与后台受控验收 |
| 原主题/setTheme | `src/ztools/theme.js`、host-theme.cjs、entry.ts | 原手动/自动主题；公开宿主深浅色通知；活动样式位于懒加载默认样式之后，防止选中主题被默认配色覆盖 |
| 原榜单/歌单/store | `src/ztools/catalog.js`、原musicSdk/原list IPC | 受控201/65跨页完整导入与编辑；非全部真实平台保证 |
| 原SettingBackup/导出 | `runtime/backup.cjs`、`export-lists.cjs`、backup-loader | 原备份格式/迁移/gzip，设置与列表同一事务；TXT/CSV |
| 原下载action/worker | `src/ztools/download.js`、download-loader、`runtime/download/` | 原UI任务，流式Range/重试/持久阶段/归属校验/标签最终化；所有新下载需hard link |
| Node metadata Worker | `preload/native-jobs.cjs`、native-jobs.html、runtime/native-jobs | 实际宿主用公开隐藏窗口执行可信metadata job；Node验证可用Worker，不执行用户音源 |
| 原sync client/server/快照/merge | `runtime/sync/index.cjs`、storage.cjs、adapt-source.cjs 与原同步模块 | 保留wire/RSA/AES/MD5/压缩与merge，修复生命周期/提交失败/快照竞争；官方2.12.6双向Node与host分别验收 |
| 原WinMain冲突选择 | `runtime/win-main.cjs`、原SyncModeModal | 排队list/dislike原Vue按钮选择，原IPC，真实host38检查通过 |
| 原openApi/player_status | `runtime/open-api.cjs`、同一Player bridge | 原HTTP/SSE与控制接口，默认关闭，隐藏保持、停止释放 |
| 原winLyric/renderer-lyric | `runtime/windows.cjs`、`preload/lyric.cjs`、`src/ztools/lyric-entry.ts` | 原歌词页面/毫秒事件，以会话及sender校验连接公开宿主窗口 |
| 原hotkey/tray/updater/窗口设置 | `runtime/commands.cjs`、commands.js、SettingHotKey.vue、SettingUpdate.vue、host-settings-loader | 五条宿主指令与快捷键设置；窗口/托盘/更新宿主管理；逐项限制见设置表 |
| 原完整桌面发行打包 | `build-config/ztools/package.cjs`、scripts/package.mjs | 显式白名单、独立依赖、完整许可、build-info文件回执与确定性ZIP；无整套主进程/用户脚本 |

表中路径以 `src-ztools/preload/` 为服务根；`runtime/` 的 generated upstream 由 `scripts/build-runtime.mjs` 生成，不直接修改vendor。源文件与构建器的来源/修改注释、完整许可随包保留。[验证矩阵](compatibility.md)负责区分接通、受控、实际宿主和LIVE结果，不能仅由本映射表判定某项已验收。
