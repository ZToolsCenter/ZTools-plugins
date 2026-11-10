# LX Music 原生 ZTools 插件实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 LX Music 2.12.6 移植为不依赖独立 LX 程序的 ZTools 插件，保留自定义音源、原界面、搜索播放、列表、下载、同步及开放 API。

**Architecture:** 保留 Vue 渲染层和音乐业务模块，通过独立 Webpack 入口与显式桥接替换 Electron 宿主依赖。Node 服务以可读 CommonJS 交付；音源在隔离上下文内实现 LX API 2.0.0。首先证明宿主能力、音源隔离与存储提交语义，再接入完整功能。

**Tech Stack:** Vue 3、TypeScript、Pug、Less、Webpack；CommonJS、Node 内置测试；Playwright Electron；ZTools db/dbStorage 与公开插件 API。

**Spec:** [设计方案](../specs/2026-11-09-ztools-native-port-design.md)。执行前同时阅读两份文档。

状态：2026-11-09 规划稿，所有任务尚未执行。以下新路径、脚本和测试是待实现内容，不能当作已经存在或通过的验证记录。LX 基线 `323e4bac`；本机参考宿主 `76addc6` / package `3.2.0`，最低支持版本须由实际能力验证确定。

## Global Constraints

- 原生插件移植，在 ZTools 内运行，不依赖另装 LX 桌面版。
- 必须支持导入、使用 LX 自定义音源；本地 `.js` 和 HTTP(S) URL 两种入口。
- 搜索/播放/音源、原界面与设置、列表/备份、榜单/歌单、下载、同步、开放 API 是正式交付目标；P2 不是最终交付。
- Windows x64 是首个验证目标；首包顶层 `platform` 声明 `['win32']`，这是实施建议。
- 构建环境沿用 LX 的 Node >=22 要求；插件运行时以实际 ZTools 的 Electron/Node 能力为准。
- 新增 preload 与其依赖不做打包、压缩或混淆；普通前端资源可以走构建流程。
- 插件使用独立 web 构建目标与相对资源路径，最终输出 `dist-ztools/`；不更换前端框架，不覆盖原桌面构建入口。
- 不调用宿主 internal API；不将 fs、child_process、ipcRenderer、任意 require 暴露给音源。
- 数据在业务提交时持久化；强杀不能依赖异步退出钩子；再次打开恢复数据，不擅自自动发声。
- 每块序列化 UTF-8 小于 256 KiB；不能用 bulkDocs 代替事务成功判定。
- 实机验证使用独立临时数据目录；不读写用户真实 ZTools/LX 配置，不修改 ZTools 主仓库。
- 不预置第三方音源；本地模拟结果不代表真实音源或平台可用；任何 BLOCKED 都不能当作 PASS。
- 本轮仅产出方案；后续实施不自动发布、推送或使用 `ztools publish`。

## Review Focus

1. 切换音源后旧请求才返回：不能污染新音源的初始化状态、播放地址或错误提示（任务 5）。
2. 大列表中途写失败、账号切换或活动指针先同步到达：应仍能读到上一完整曲库，不能混入半份数据（任务 3）。
3. 下载服务忽略 Range 或返回不同资源：必须重新下载，不能生成表面完成但内容损坏的文件（任务 8）。
4. 重复进入/隐藏/分离产生多实例：同一时间只播放一份音频，监听器和请求不能累积（任务 6、11）。
5. 同步断线重连与本地同时排序：必须保持协议一致性，不重复歌曲、不丢用户选择，不形成无限回推（任务 9）。

## 文件组织与执行约定

以下路径均相对于本仓库；“参考”文件不表示必须修改。前端优先通过 Webpack 精确别名适配，只有无法合理注入时才给原模块增加明确的环境接口，不建立第二套音乐界面。

| 路径 | 职责 |
|---|---|
| `ztools/plugin.json`、`ztools/package.json`、`ztools/package-lock.json`、`ztools/logo.png` | 插件元数据、独立 CommonJS 运行依赖及图标 |
| `ztools/preload.cjs`、`ztools/runtime/` | 生命周期入口和可审阅 Node 服务；逐文件复制到产物 |
| `src/ztools/` | 类型契约、原 renderer 的宿主替换模块、插件启动 |
| `build-config/ztools/` | Web 前端构建、运行依赖组装、校验和本地打包 |
| `tests/ztools/`、`tests/ztools/e2e/` | 契约测试、故障注入、隔离 ZTools 全链路验证 |
| `docs/ztools/` | 宿主探针结果、模块映射、安装说明和功能验证矩阵 |

运行时新增接口统一在 `src/ztools/contracts.ts` 声明，通过 JSDoc/声明文件对 CJS 实现进行类型校验。复用 LX 原有命名空间类型，不在各服务重复定义歌曲/列表结构。所有异步调用的失败保留可识别的 `code` 与 `message`，不转成虚假成功值。

任务 1 新增命令约定：`build:ztools` → `node build-config/ztools/build.cjs`；`test:ztools` → `node --test tests/ztools/*.test.cjs`；`test:ztools:e2e` → `playwright test --config tests/ztools/playwright.config.ts`；`check:ztools` → `node build-config/ztools/check.cjs`，检查类型、清单及依赖；任务 11 补充 `pack:ztools` → `node build-config/ztools/package.cjs`。E2E 的 describe 使用下文 grep 名称作为标签；使用 `ZTOOLS_SOURCE_DIR` 指向只读宿主源码，缺少宿主或音源时明确报缺失条件，不静默通过。

每个任务遵循：先添加下面指定的行为测试并运行确认有效失败，再实现，运行指定验证，最后只提交该任务文件。提交前检查 `git diff --check` 和 `git status --short`，保留用户已有修改；提交是本地检查点，不推送。

## P0：先证明运行前提

### Task 1: 建立最小插件、真实宿主探针和构建入口

**Files:** 新建 `ztools/plugin.json`、`ztools/package.json`、`ztools/package-lock.json`、`ztools/logo.png`、`ztools/preload.cjs`、`src/ztools/probe.ts`、`build-config/ztools/webpack.config.cjs`、`build-config/ztools/build.cjs`、`build-config/ztools/check.cjs`、`tests/ztools/playwright.config.ts`、`tests/ztools/e2e/host.fixture.ts`、`tests/ztools/e2e/probe.spec.ts`、`docs/ztools/host-capabilities.md`；修改 `package.json`、`package-lock.json`、`.gitignore`。参考 `build-config/renderer/webpack.config.base.js`、`src/renderer/components/base/Btn.vue`。

**Interfaces:** 输出 `HostCapabilities`：宿主/Node/Chromium 版本、必要 API 存在性、生命周期、后台/单实例、子窗口方法、音源运行方式和存储语义的探针结果；失败项含原因与证据位置。此类型在任务 2 归入统一契约。

- [ ] 添加 `probe.spec.ts`：真正加载 plugin.json 后能渲染一个原 LX Vue 组件；关闭开发服务后生产资源仍可加载；断言诊断中记录实际运行时版本，未加载插件/缺 API 必须失败。运行 `npm run test:ztools:e2e -- --grep host-probe`，确认尚未实现时失败。
- [ ] 配置独立 web 入口，相对路径、资源/字体/AudioWorklet 规则继承可复用部分；不得保留 `electron-renderer` target 或 `commonjs2` 页面输出。探针不是最终播放器，后续任务切换到正式入口。
- [ ] 创建隔离宿主 fixture：参照 ZTools `tests/e2e/plugin-esc-hide.spec.ts` 启动源码 Electron，设置临时 `ZTOOLS_DATA_ROOT`、`ZTOOLS_LEGACY_USER_DATA_PATH` 和必要的设置开发服务。加载本插件，不修改宿主源文件；失败截图只取插件 WebContentsView。
- [ ] 测 guest 隔离：实际 `contextIsolation:true`、无 Node/宿主桥泄漏、独立非持久 Session、导航/弹窗/权限阻止、死循环可被外部终止，以及同步 crypto/Buffer 可用。普通 ZTools 子窗口传入的安全选项不作为通过证据。guest 不满足条件时测试 Worker 备选的同步工具/消息/终止能力，最终只保留一种已验证实现。
- [ ] 测后台与存储：隐藏继续计时、分离/返回不重建；验证 `_rev` 冲突、错误结果对象、半批失败、文档大小、账号切换和引用缺块。确认公开接口能否可靠绑定存储上下文；不能时记录本地后端取舍并更新任务 3 的适配层，不能跳过一致性要求。
- [ ] 运行 `npm run build:ztools`、`npm run check:ztools` 和探针；将结果写入 `host-capabilities.md`。音源隔离、后台生命周期、存储发布语义三项均有实证后进入 P1；任一失败先调整设计和本任务。本地提交：`build: add ZTools runtime feasibility probe`。

## P1：接通宿主和数据

### Task 2: 统一桥接、生命周期和原模块映射

**Files:** 新建 `src/ztools/contracts.ts`、`src/ztools/entry.ts`、`src/ztools/rendererIpc.ts`、`src/ztools/host.ts`、`src/ztools/worker.ts`、`ztools/runtime/bridge.cjs`、`ztools/runtime/lifecycle.cjs`、`ztools/runtime/settings.cjs`、`tests/ztools/bridge.test.cjs`、`docs/ztools/module-map.md`；修改任务 1 的 preload/构建配置。参考 `src/common/rendererIpc.ts`、`src/renderer/utils/ipc.ts`、`src/renderer/utils/env.js`、`src/renderer/worker/utils/index.ts`、`src/renderer/core/useApp/index.ts`。

**Interfaces:** `Bridge.invoke<T>(channel:string, params?:unknown):Promise<T>`；`send(channel,params):void`；`readSnapshot<T>(key:string):T`；`subscribe(channel,listener):()=>void`；`dispose():Promise<void>`。`Lifecycle.enter(action)`、`out(isKill:boolean)`、`detach()`、`dispose()` 管理同一实例。`rendererIpc.ts` 保持原导出签名和 `{event, params}` 回调结构，严格映射允许通道。

- [ ] 添加 `bridge.test.cjs`，断言 on/once/off 配对后回调次数分别正确、未知通道 reject、未准备的同步数据抛明确错误而非返回 Promise、重复 enter 不重复初始化、out(false) 不 dispose。运行 `node --test tests/ztools/bridge.test.cjs` 确认失败。
- [ ] 用 `rg` 穷举 renderer/worker 的 Node、Electron、IPC 依赖，输出“调用方→原处理器→插件处理器→验证任务”映射。处理设置、环境、文件对话框、窗口及业务通道，禁止统一空函数、统一成功或一个无限制 Electron shim。
- [ ] 实现桥接、初始化顺序和设置服务：在导入原 `src/renderer/main.ts` 前准备桥、环境及必要快照。宿主 onPluginEnter/out/detach/主题回调各注册一次，内部订阅分发；停止对象仅在真实终止时清理。注册主搜索框打开、搜索、播放/暂停、上下首命令，待任务 6 接入播放器。
- [ ] 完成 web Worker/Node 能力分类：纯算法保留 Worker，网络/文件/数据库经显式服务；下载工厂保留 `LX.WorkerDownloadTypes` 对外契约，直到任务 8 接入前对应功能显示开发状态而不声称可用。
- [ ] 运行桥接测试、`npm run build:ztools`、`npm run check:ztools`；记录尚待任务 3—10 接通的业务通道。提交：`feat: add ZTools host bridge and lifecycle`。

### Task 3: 实现可恢复的结构化存储与 LX 数据契约

**Files:** 新建 `ztools/runtime/storage/adapter.cjs`、`ztools/runtime/storage/snapshots.cjs`、`ztools/runtime/storage/lists.cjs`、`ztools/runtime/storage/records.cjs`、`tests/ztools/storage.test.cjs`、`tests/ztools/list-contract.test.cjs`、`tests/ztools/e2e/storage.spec.ts`；修改 `ztools/runtime/settings.cjs`、`src/ztools/contracts.ts`、`ztools/runtime/bridge.cjs`。参考 `src/main/worker/dbService/modules/list/index.ts` 及同目录六个数据模块。

**Interfaces:** `Storage.read<T>(namespace:string,key:string):Promise<T|undefined>`；`getRevision():Promise<string|null>`；`commit(changes:StorageChange[],expectedRevision:string|null):Promise<string>`；`subscribe(listener):()=>void`；`close():Promise<void>`。`StorageChange={namespace:string,key:string,value:unknown|null}`，null 表示删除。列表服务保持原列表模块导出名/参数/结果，通过远程适配统一异步；download/dislike_list/lyric/music_url/music_other_source 同样逐方法对照。设置按 revision 暂存并纳入同一发布协议，dbStorage 的普通设置键只作提交后可重建镜像，防止整体导入半成功。

- [ ] 添加故障测试：第 N 块写入返回错误而不抛异常、指针冲突、发布前崩溃时，`read` 结果均严格等于旧版本；新版本缺块时不可激活；传给宿主的文档 `_id` 被修改也不污染原对象。运行两份 Node 测试确认失败。
- [ ] 实现不可变分块和单活动指针发布，复用未变分块，所有分块/目录小于 256 KiB；对结果逐项判错。读取固定 revision，保留上一完整版本和正在读的版本，提交完成才发数据事件。
- [ ] 实现所有 LX 数据方法及 schemaVersion 迁移。对跨列表移动、批量排序、覆盖、删除、去重、不喜欢、缓存过期分别比较操作前后完整数据；使用含相同歌曲 ID/不同平台的真实形状 fixture，不能靠只测试 CRUD 代替语义对照。
- [ ] 添加账号切换/远端同步乱序 E2E：旧队列不得写入新上下文；缺块保留旧曲库并重试；冲突不能默默覆盖。按 P0 结论选择已证明后端，必要时本地文件快照实现相同 Storage 接口；账户数据不得被误认作设备私有数据。
- [ ] 运行 `node --test tests/ztools/storage.test.cjs tests/ztools/list-contract.test.cjs`、`npm run test:ztools:e2e -- --grep storage`、构建检查；用 10,000 首/100 列表验证重启后顺序和内容一致。提交：`feat: persist LX data with recoverable snapshots`。

## P2：打通音源与播放

### Task 4: 迁移网络与音乐平台适配

**Files:** 新建 `ztools/runtime/network.cjs`、`src/ztools/request.ts`、`tests/ztools/network.test.cjs`、`tests/ztools/fixtures/http-server.cjs`、`tests/ztools/e2e/catalog.spec.ts`；修改 `src/ztools/contracts.ts`、构建别名与 `docs/ztools/module-map.md`。参考 `src/renderer/utils/request.js`、`src/renderer/utils/musicSdk`、`src/renderer/worker/main/music.ts`。

**Interfaces:** `Network.request(options:RequestOptions):{id:string,result:Promise<HttpResponse>,cancel:()=>void}`；RequestOptions 覆盖 method/url/headers/body/form/formData/timeout/redirect/proxy；HttpResponse 保留 statusCode/headers/rawBytes 与解析 body。`src/ztools/request.ts` 保持原 `httpFetch` 等实际导出和取消语义，不强迫所有调用方改成新协议。

- [ ] 添加受控 HTTP 测试，断言 POST/form/multipart、编码/压缩、代理、超时、取消、重定向与错误码行为；两个并发请求不同 headers 不互相污染，取消后不迟到回调。运行 `node --test tests/ztools/network.test.cjs` 确认失败。
- [ ] 复用 LX 请求库及平台参数生成，替换不适合 Web 的 Node 入口。检索每个 musicSdk 模块的 crypto/dns/请求依赖，按映射移入受控服务或使用等价实现，保留平台请求和原始歌曲字段。
- [ ] 接通搜索、分页、热搜/建议与平台切换；fixture 注入只在测试配置生效。为 kw/kg/tx/wy/mg 分别断言转换后的 ID/hash/albumId/音质字段，与原转换结果一致；单平台失败有明确提示且其他平台仍可用。
- [ ] 运行网络测试、`npm run test:ztools:e2e -- --grep catalog`、构建检查。真实平台连通另记 LIVE 结果，不以网络 fixture 通过冒充。提交：`feat: adapt LX network and music catalog`。

### Task 5: 导入、隔离执行和切换自定义音源

**Files:** 新建 `ztools/runtime/source/manager.cjs`、`ztools/runtime/source/protocol.cjs`、`ztools/runtime/source/runtime.cjs`、`ztools/runtime/source/guest-preload.cjs`、`ztools/runtime/source/guest.html`、`tests/ztools/source-contract.test.cjs`、`tests/ztools/fixtures/source-api-v2.js`、`tests/ztools/e2e/source.spec.ts`；修改契约、桥接与音源设置页中必须调整的宿主调用。若 P0 选择 Worker，用 `src/ztools/source.worker.ts` 替换两个 guest 文件，并在映射中固定该选择。

**Interfaces:** `Sources.importScript(input:{kind:'file'|'url',value:string}):Promise<LX.UserApi.ImportUserApi>`；`list():Promise<LX.UserApi.UserApiInfo[]>`；`activate(id:string):Promise<void>`；`remove(id:string):Promise<void>`；`request(input:LX.UserApi.UserApiRequestParams):Promise<string|LX.Music.LyricInfo>`；`cancel(requestKey:string):void`；`getStatus():LX.UserApi.UserApiStatus`；`subscribe(listener):()=>void`；`dispose():Promise<void>`。类型依据 `src/common/types/user_api.d.ts`；响应按 musicUrl/pic/lyric 动作校验。内部所有消息带 generation/requestId，不向脚本暴露宿主服务句柄。

- [ ] 依据上游 `src/main/modules/userApi/renderer/preload.js` 写契约 fixture：inited/request/updateAlert、全部支持能力与音质、失败和重复初始化；MD5/AES/RSA/Buffer 同步返回值使用固定输入与上游预期值，inflate/deflate 保持 Promise；HTTP 保持 callback/cancel 语义。运行 Node 契约和真实宿主 `source` 测试确认失败。
- [ ] 按 P0 已选隔离方式实现 lx API 2.0.0。工具函数不得因跨上下文通信改成异步；脚本不能取得 ztools/Node/本地文件权限。验证无处理器、无限循环、超时、异常脚本退出后 UI/下一音源仍可工作。
- [ ] 接通本地/URL 导入、信息、启用/删除、更新提示和错误展示；保留上游脚本字符串长度 `9_000_000` 限制，两种入口一致。按原规则解析元信息和源能力，不预置来源不明脚本。
- [ ] 添加切换测试：A 请求挂起时启用 B，A 的成功/失败/初始化迟到消息均不能改变 B；旧网络取消，删除当前源后明确进入无源状态；request 返回值、音质与 URL 校验失败有准确错误。
- [ ] 运行 `node --test tests/ztools/source-contract.test.cjs`、`npm run test:ztools:e2e -- --grep source` 和构建检查。记录标准 API 兼容证据及 DOM 扩展脚本限制；用户真实音源未提供时明确待验证。提交：`feat: support isolated LX custom sources`。

### Task 6: 恢复原播放器、列表与后台体验

**Files:** 新建 `src/ztools/player.ts`、`src/ztools/theme.ts`、`src/ztools/workerServices.ts`、`tests/ztools/e2e/player.spec.ts`；修改 `src/ztools/entry.ts`、`src/ztools/worker.ts`、桥接；按映射最小修改 `src/renderer/core/useApp/index.ts`、`src/renderer/core/useApp/usePlayer/index.ts`、`src/renderer/core/useApp/useEventListener.ts`。参考原 App/router、player、store/list、本地音乐与音效模块。

**Interfaces:** `Player.dispatch(command:PlayerCommand):Promise<void>`；`getState():LX.Player.Status`；`subscribe(listener:(state:LX.Player.Status)=>void):()=>void`。PlayerCommand 是 `{type:'play'|'pause'|'playPause'|'prev'|'next'|'collect'|'unCollect'}`、`{type:'seek',value:number}`、`{type:'volume',value:number}`、`{type:'mute',value:boolean}`、`{type:'search',text:string}` 的联合类型；seek 为秒，volume 为 0—1。映射原 `LX.Player.StatusButtonActions` 和状态，不额外创建 Audio 实例，满足任务 10 所有开放 API 控制入口。

- [ ] 添加 E2E：导入测试源→搜索→播放本地受控音频，断言 loadedmetadata、currentTime 增长、暂停后稳定、切歌更新；收藏、排序、歌词、音量/进度/播放模式在重启后符合设置。首次实现前运行 `npm run test:ztools:e2e -- --grep player` 确认失败。
- [ ] 正式入口加载原 Vue 页面及全部路由，接通设置/列表/队列服务；处理 main Worker 内 Node 依赖，不仅修下载 Worker。保留原语言、主题及控件，增加跟随宿主深浅主题，避免透明背景下文字不可读。
- [ ] 保留 AudioWorklet、音效、媒体会话、本地文件读取/解码与定时停止；使用受控路径服务接入本地媒体，验证中文文件名、FLAC/MP3/WAV 样本。命令搜索和播放控制指向同一播放器。
- [ ] 验证隐藏、切插件、分离、重新进入不中断；kill 后进程/音频停止，重进恢复数据不自动发声。重复进入不能多注册事件，普通 onPluginOut(false) 不能触发同步/下载清理。
- [ ] 运行 player E2E、构建检查；在实际宿主确认可听输出并单列人工证据。提交：`feat: restore LX playback and background lifecycle`。

## P3：补全业务与下载

### Task 7: 排行榜、在线歌单、备份及完整设置

**Files:** 新建 `ztools/runtime/backup.cjs`、`tests/ztools/backup.test.cjs`、`tests/ztools/e2e/library.spec.ts`；修改桥接与必要的 `src/renderer/views/Setting/components/SettingBackup.vue` 宿主调用。参考 `src/renderer/router.ts`、musicSdk 的榜单/歌单实现及现有设置组件。

**Interfaces:** `Backup.export(kind:'all'|'lists'|'settings',path:string):Promise<void>`；`import(path:string,kind):Promise<void>`；`exportListText(path:string,format:'txt'|'csv'):Promise<void>`。沿用 LX 备份格式、版本迁移、合并/覆盖规则；所有导入先完成解析与校验，再提交任务 3 的持久化事务。

- [ ] 添加旧版/当前 LX 备份 fixture，断言导入导出数据等价、损坏/不支持版本不改原数据、失败不留下新设置配旧歌单；运行 `node --test tests/ztools/backup.test.cjs` 确认失败。
- [ ] 接通榜单分页、歌单详情/链接导入、整单播放/收藏/批量添加、列表编辑与自动更新。全选/跨页选择后数量准确；保留平台关联字段，不能把只有页面导航算作完成。
- [ ] 实现备份和设置契约，覆盖列表/设置分别备份、全部备份、txt/csv 导出；对设置项逐条映射“有效/由宿主管理/有说明的限制”，禁用无效开关并解释，不删除核心功能以规避适配。
- [ ] 运行 backup 测试、`npm run test:ztools:e2e -- --grep library`、构建检查，保存兼容矩阵初稿 `docs/ztools/compatibility.md`。提交：`feat: restore playlists charts and LX backups`。

### Task 8: 迁移下载执行器、续传与标签

**Files:** 新建 `ztools/runtime/download/queue.cjs`、`ztools/runtime/download/transfer.cjs`、`ztools/runtime/download/metadata.cjs`、`tests/ztools/download.test.cjs`、`tests/ztools/e2e/download.spec.ts`；修改 `src/ztools/worker.ts`、契约、桥接。参考 `src/renderer/worker/download`、`src/common/utils/download`，按原模块映射保留命名及歌词封面行为。

**Interfaces:** 对 UI 保持 `LX.WorkerDownloadTypes`；内部 `Downloads.start(task)`、`pause(id)`、`cancel(id)`、`retry(id)`、`restore():Promise<void>`、`dispose():Promise<void>`，异步方法返回 Promise；进度使用原下载事件字段，记录写入任务 3 的 download 数据服务。

- [ ] 添加本地服务器故障测试：206 正常续传、200 忽略 Range、Content-Range 错位、ETag 变化、无长度、半途中断、取消、地址过期。成功文件 `sha256` 等于预期；失败/取消无 completed 事件。运行 `node --test tests/ztools/download.test.cjs` 确认失败。
- [ ] 将 Node 网络/文件执行移到 preload 服务，保留队列/并发/暂停/重试/进度；临时文件按任务隔离，校验成功后才发布。对失效 URL 重新向当前有效音源解析，明确重试上限，切源不能恢复旧会话请求。
- [ ] 接通目录选择、文件名清理/同名策略、目录无权限、歌词/封面及标签写入；验证写入后仍可解码且 metadata 可读。若使用 runFFmpeg，单独检测并展示可用性，不假定所有宿主均内置该能力。
- [ ] 验证隐藏继续、暂停重启后可恢复、kill 后残留任务为可重试状态；任务删除不得误删用户其他文件。跨设备/资源变化不能拼接旧文件。
- [ ] 运行 download 契约与 E2E、构建检查，检查播放并行下载时 UI/音频未被同步 IO 阻塞。提交：`feat: port resumable downloads and metadata`。

## P4：同步和系统集成

### Task 9: 保留 LX 同步客户端与服务端

**Files:** 新建 `ztools/runtime/sync/index.cjs`、`ztools/runtime/sync/events.cjs`、`ztools/runtime/sync/storage.cjs`、`tests/ztools/sync.test.cjs`、`tests/ztools/e2e/sync.spec.ts`、`tests/ztools/fixtures/lx-sync-peer.cjs`；按 `docs/ztools/module-map.md` 将 `src/main/modules/sync/client`、`server`、`utils.ts`、`migrate.ts` 逐模块适配到 `ztools/runtime/sync/` 同名可读 CJS，更新契约和桥接。不把 Electron 主入口一起复制。

**Interfaces:** `Sync.start(config:SyncConfig):Promise<void>`；`stop():Promise<void>`；`getStatus():SyncStatus`；`subscribe(listener:(status:SyncStatus)=>void):()=>void`。SyncConfig 为 `({mode:'server'} & LX.Sync.EnableServer) | ({mode:'client'} & LX.Sync.EnableClient)`；SyncStatus 为 `({mode:'server'} & LX.Sync.ServerStatus) | ({mode:'client'} & LX.Sync.ClientStatus)`。其余设备管理/鉴权/冲突方法按原模块导出映射；列表/不喜欢事件在任务 3 提交成功后发布。

- [ ] 固定协议 fixture 并测试鉴权失败、首次同步、增删改排序、不喜欢列表、设备移除、冲突选择、断线重连；重点断言“本地排序同时重连后双方内容/顺序一致、无重复、无无限回推”。运行 `node --test tests/ztools/sync.test.cjs` 确认失败。
- [ ] 复用原协议/消息/快照算法，注入配置、日志、事件和存储；移除 main_window_close 对插件隐藏的错误联动。数据提交失败不能通知远端成功，重新配置先关闭旧 socket/端口。
- [ ] 使用一个未修改协议实现的 LX 对端，固定版本/commit并隔离其数据。插件做客户端与服务端各运行一次互通测试，覆盖认证与双向变更；测试程序只负责启动和驱动对端，不能重写对端协议来配合本插件。
- [ ] 验证默认不监听、设置开启才监听，端口冲突明确报错、隐藏维持连接、kill 释放监听。缺少真实对端条件时记 BLOCKED，不能以两个插件副本互通替代。
- [ ] 运行 sync 单元/E2E及构建检查，把对端版本和最终双方数据摘要写入兼容矩阵。提交：`feat: preserve LX sync client and server protocol`。

### Task 10: 开放 API、快捷键及桌面歌词

**Files:** 新建 `ztools/runtime/open-api.cjs`、`ztools/runtime/windows.cjs`、`src/ztools/lyric-entry.ts`、`tests/ztools/open-api.test.cjs`、`tests/ztools/e2e/system.spec.ts`；修改 plugin.json、桥接、构建配置；参考 `src/main/modules/openApi/index.ts`、`src/main/modules/winLyric`、`src/renderer-lyric`、`src/main/modules/hotKey`。

**Interfaces:** `OpenAPI.start(config:LX.OpenAPI.EnableServer):Promise<void>`、`getStatus():LX.OpenAPI.Status`、`stop():Promise<void>`；`Windows.openLyrics():Promise<void>`、`closeLyrics():Promise<void>`；都通过前述 Player/Storage/Lifecycle 订阅，禁止另建播放器。窗口调用按宿主代理实际异步行为归一化。

- [ ] 添加开放 API 测试，比较原有 status/lyric/SSE/播放控制响应；错误配置、端口冲突和停止后连接关闭必须明确可测。运行 `node --test tests/ztools/open-api.test.cjs` 确认失败。
- [ ] 迁移开放 API 并绑定插件生命周期；默认关闭，不抢占桌面 LX 的现有端口；重进/设置变更不能重复监听，SSE 客户端断开及时移除订阅。
- [ ] 将快捷键管理交给 ZTools 插件指令和 `redirectHotKeySetting`，支持启动/搜索/上下首/暂停；原应用退出映射退出插件，自更新与独立托盘映射宿主职责。
- [ ] 复用原桌面歌词页面，实测子窗口置顶、鼠标穿透、尺寸/显示器/关闭。媒体键、任务栏按钮逐项验收：仅公开 API 能可靠完成的标支持，否则界面说明具体限制并写入矩阵；这些宿主差异不允许悄悄吞掉核心音乐功能。
- [ ] 运行 open-api 测试、`npm run test:ztools:e2e -- --grep system`、构建检查；确认没有调用宿主 internal IPC。提交：`feat: integrate LX system controls with ZTools`。

## P5：形成可安装交付物

### Task 11: 独立运行包、完整回归和中文文档

**Files:** 新建 `build-config/ztools/package.cjs`、`tests/ztools/package.test.cjs`、`tests/ztools/e2e/acceptance.spec.ts`、`docs/ztools/README.md`、`docs/ztools/upstream-diff.md`；更新 runtime 锁文件、`docs/ztools/host-capabilities.md`、`docs/ztools/compatibility.md`、构建检查与 scripts。保留并组装 `LICENSE`、第三方 notices。

**Interfaces:** `npm run pack:ztools` 只产生 `dist-ztools/` 和版本化 zip；包根 plugin.json 指向本地 HTML/可读 preload，所需 Node 依赖由独立运行清单和锁文件完整装入，不依赖源码根 node_modules，不执行发布。

- [ ] 添加 package 测试：缺少传递依赖、主资源、语言/字体/AudioWorklet、源码许可时构建检查失败；preload/runtime 保持逐模块可读 CJS，没有 better-sqlite3 二进制或整套 LX 主进程。运行 `node --test tests/ztools/package.test.cjs` 确认失败。
- [ ] 实现可重现组装/zip，记录插件版本、LX 基线、宿主验证版本、依赖清单与校验值。打包拷贝范围显式声明，不递归拷贝工作区或用户配置；前端可压缩，preload/runtime 不压缩/混淆。
- [ ] 将包解到新的临时目录，断开源码目录与开发 node_modules 引用，在隔离真实宿主导入该包。从首次运行完成音源→搜索→播放→隐藏→歌单→下载→重启→备份→同步→开放 API，确认无额外 LX 进程依赖。
- [ ] 稳定性验证：10,000 首/100 列表，连续 30 分钟后台播放与下载，50 次进入/退出/分离；保存监听器/音频实例/进程数量与资源趋势。检验受控音频时间推进、人工可听、下载哈希、重启数据、真实对端同步；发现泄漏或中断则回归责任任务。
- [ ] 运行 `npm run test:ztools`、`npm run check:ztools`、`npm run build:ztools`、`npm run pack:ztools`、完整 E2E。根据修改范围验证原桌面 renderer 构建未被破坏；不为无关平台反复运行全量打包。
- [ ] 完成中文安装、音源导入、数据迁移、后台/终止区别、下载目录、同步配置、排错与卸载说明；矩阵逐项注明 PASS/FAIL/BLOCKED、证据层级、目标版本，真实音源缺失保持待验证。提交：`docs: deliver validated ZTools plugin package and guide`。

## 阶段完成判定和计划自查

| 阶段 | 必须交付的可检查结果 | 对应任务 |
|---|---|---|
| P0 | 宿主、音源隔离和存储可行性实证；不能只靠源码推断 | 1 |
| P1 | 依赖/通道映射、统一生命周期、可恢复数据服务 | 2—3 |
| P2 | 原 UI、音源 API 契约、搜索到播放及后台生命周期 | 4—6 |
| P3 | 榜单/歌单、备份、完整下载与设置映射 | 7—8 |
| P4 | 原 LX 对端互通、开放 API、系统能力与差异清单 | 9—10 |
| P5 | 脱离开发目录可运行的包、完整回归与中文交付材料 | 11 |

本计划已按设计逐项检查：核心模块都有任务归属；五项 Review Focus 都有故障测试；跨任务统一使用 Storage/Network/Sources/Player/Lifecycle 契约。任务 1 的实验可以改变宿主适配实现，但不能缩小功能范围；变化须同步更新设计、契约和后续任务。

最终报告必须把“已实现”“受控测试通过”“真实宿主通过”“真实外部平台/用户音源通过”分开。计划中没有保证任意第三方脚本和所有平台永久可用，也没有把尚未实现的测试当作当前成果。
