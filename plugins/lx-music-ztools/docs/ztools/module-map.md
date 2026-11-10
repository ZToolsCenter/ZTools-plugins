# LX 到 ZTools 的模块映射

所有 vendor/lx 源文件来自上游 323e4bac；修改集中在适配器和构建别名。已导入完整 src 供独立构建，使用时不依赖旁边 desktop 工作目录。

| 原调用方 | 原处理器 | 插件替代 | 实施状态 |
|---|---|---|---|
| common/rendererIpc.ts | Electron ipcMain | src/ztools/rendererIpc.ts + preload/runtime/bridge.cjs | 桥接及订阅契约已验证；业务通道逐项接入 |
| renderer/main.ts / utils/ipc.ts | config / environment / rendererEvent | preload/runtime/settings.cjs + explicit handlers | 待接入 |
| renderer/core/useApp | 独立应用窗口生命周期 | preload/runtime/lifecycle.cjs | 进入/隐藏/分离/终止契约已验证 |
| store/list、main Worker | dbService/modules/list | 原 LX SQL 模块 + node:sqlite 适配 | 待接入 |
| download/dislike/lyric/URL/other-source 数据 | better-sqlite3 / Comlink | 同一设备本地 SQL 服务 | 待接入 |
| musicSdk / utils/request.js | needle / crypto / dns | preload 网络服务，纯计算留前端 | 任务 4 |
| Setting UserApi / core apiSource | userApi hidden BrowserWindow | CSP 浏览器 Worker + HTTP/cancel 消息桥 | 隔离与同步工具已实测，业务 API 待接入 |
| renderer/worker/main | Node/数据库/纯计算混合 | 原远程方法契约；Node 到 preload、纯计算保留 | 任务 6 |
| renderer/worker/download | Node 流与文件 | preload/runtime/download | 任务 8 |
| sync/client、sync/server | global.lx / main lifecycle | 原协议 + 同一存储 + 适配事件总线 | 任务 9 |
| openApi | player_status / taskbar event | 同一 Player 业务控制 | 任务 10 |
| winLyric / renderer-lyric | BrowserWindow | ZTools 公开窗口代理 | 任务 10 |
| hotKey / tray / updater | 全局注册与应用管理 | 插件指令、宿主快捷键设置、宿主更新 | 任务 10 |

已扫描 renderer/common 的真实 Electron 入口：common/rendererIpc.ts、common/utils/electron.ts，electron-log/node 由 common/utils/index.ts 导入。renderer 内 electron-updater 引用为类型，不装载应用更新器。Node 入口按依赖图继续分类，未适配通道必须报错，不允许空返回掩盖缺失功能。

实施进展：列表及其事件/IPC、设置、JSON KV、主题、原网络请求和音源管理已接入。Node 服务复用原 request.js 的平台请求构造，版本输入固定为 LX 基线；前端通过可取消的 network:fetch 调用，DNS 使用受控服务。CJS 转换对平台请求日志作静默处理，避免记录可能带访问参数的 URL。原 Vue 页面已在实际宿主渲染；可见基本设置截图与检验日志保存在 artifacts/renderer。worker 的 Node 文件能力继续迁入服务；移植中的具体未完成项以 compatibility.md 为准。
