# 服务设置核查（2026-11-10）

范围为 LX 设置的下载、网络代理、同步、开放 API、备份恢复及缓存管理。核查包含原 Vue 控件、构建适配器、preload 服务和实际 Node 行为；本子任务没有启动 Electron，不能据此声称宿主 UI 已逐项人工验收。`vendor/lx` 未修改。下载、同步、代理、开放 API 和备份业务控件均保留；宿主管理的浏览器资源缓存入口本轮按用户确认从界面移除。

## 下载：17 个默认键

默认声明：`vendor/lx/src/common/defaultSetting.ts:112`。控件：`renderer/views/Setting/components/SettingDownload.vue`；实际任务设置：`renderer/store/download/action.ts`、`utils.ts`；最终化由 `build-config/ztools/download-loader.cjs` 适配到 `preload/runtime/download`。

| 默认键（download. 前缀） | 默认值 | 行为核查与边界 |
| --- | --- | --- |
| enable | false | 控制菜单、列表下载按钮和下载导航可见性；不会取消已存在的任务。 |
| isSavePathGroupByListName | false | buildSavePath 按默认、收藏、自建列表名生成子目录，并过滤文件名。 |
| savePath | 用户桌面 | 目录选择经 host 授权；导入一个路径值不会自动授权目录。 |
| fileName | 歌名 - 歌手 | 创建任务时格式化歌名/歌手；运行队列拒绝穿越、设备名、非法尾点空格。 |
| maxDownloadNum | 3 | renderer 调度和 preload 队列均读取该值；队列每次 pump 读取最新值。 |
| skipExistFile | true | 跳过同名文件通过原子 hard link 保证不覆盖，关闭时通过 rename 发布。 |
| isDownloadLrc | false | 完成音频后等待独立歌词保存，失败不标记整个任务完成。 |
| isDownloadLxLrc | true | 传入 buildLyrics，控制 LX 增强歌词。 |
| isDownloadTLrc | false | 传入 buildLyrics，控制翻译歌词。 |
| isDownloadRLrc | false | 传入 buildLyrics，控制罗马音歌词。 |
| lrcFormat | utf8 | 保存真实 UTF-8 BOM/GBK 字节，经过原子临时文件发布。 |
| isEmbedPic | true | 获取封面，经代理下载、PNG/JPEG 校验后写 MP3/FLAC 标签；上限 16 MiB。 |
| isEmbedLyric | false | 控制歌词资源获取与标签写入；MP3/FLAC 支持，WAV/APE 不承诺 writer 能力。 |
| isEmbedLyricLx | true | 传入 buildLyrics，控制嵌入的增强歌词。 |
| isEmbedLyricT | false | 传入 buildLyrics，控制嵌入的翻译。 |
| isEmbedLyricR | false | 传入 buildLyrics，控制嵌入的罗马音。 |
| isUseOtherSource | false | 获取音频、封面、歌词及刷新 URL 时传入 allowToggleSource。 |

行为证据：`tests/ztools/download.test.cjs` 验证真实字节/hash、断点、重定向、并发、同名文件与恢复；`download-metadata.test.cjs` 解码实际 MP3/FLAC 并核查标签、歌词、封面、PCM；`download-ui-contract.test.cjs` 执行适配后的原 renderer action，验证等待标签/歌词、后台 ACK、暂停/移除和竞态。尚未逐个用真实音源、所有格式与宿主目录对话框人工验收。

## 网络代理：3 个默认键

| 键 | 默认值 | 行为核查与边界 |
| --- | --- | --- |
| network.proxy.enable | false | 原请求、用户音源请求和下载/封面请求均读取代理开关。 |
| network.proxy.host | 空字符串 | Node 请求经 tunnel HTTP CONNECT，下载创建时携带代理。 |
| network.proxy.port | 空字符串 | 下载默认 80；原 Node 请求沿用 tunnel 的代理端口处理。 |

发现并修复的缺口：原 `main/modules/winMain/index.ts:111` 调用的浏览器 session 代理没有在插件重建；`renderer/plugins/player/index.ts:396` 和 `usePlayer/usePreloadNextMusic.ts:45` 直接设置 audio.src，所以“音源请求经代理”不等于“播放音频流经代理”。已增加仅登记资源可访问的随机 token loopback 服务，以及主播放/预加载两个调用点的构建适配，保留现有 Node 请求代理。关闭代理时媒资登记直接返回原地址；启用时流服务读取当前代理配置，转发 Range/If-Range、HEAD 和重定向，使用流式背压并传递取消。服务不接受任意 URL query，不记录用户音源 URL；终止时关闭流和监听。

`network.test.cjs` 实际启动 CONNECT 代理，证明用户音源请求穿过代理。新增 `media-proxy.test.cjs` 使用无法直接解析的 audio.invalid，经 CONNECT 实际取得媒体字节，覆盖 Range/If-Range、HEAD、CORS、重定向、未知 token/任意 URL query 拒绝、上游状态、取消、握手不回应超时及终止中断。新增 `media-proxy-ui.test.cjs` 执行适配后的原主播放和预加载模块，验证等待媒资、过期身份保护与原错误分支。两组当前共 12 项通过，其中一项为测试代理夹具的半关闭清理回归。仍需实际宿主浏览器和真实音源的播放验收；此设置不控制 ZTools 自身和插件外部网页的网络。

## 同步：5 个默认键和独立控件

| 键/控件 | 默认值 | 行为核查与边界 |
| --- | --- | --- |
| sync.mode | server | 原 client/server 角色均存在；已修复只导入角色时 renderer 改了而旧服务未切换的问题。 |
| sync.enable | false | 显式启停；隐藏插件保留，终止时断连、关闭监听并 flush。 |
| sync.server.port | 23332 | 校验整数 1—65535，端口冲突返回真实错误，失败监听清理。 |
| sync.server.maxSsnapshotNum | 5 | 非可见控件，兼容保留原拼写；每次裁剪动态读取，创建与裁剪共用队列，保护最新/设备引用快照。 |
| sync.client.host | 空字符串 | 校验 HTTP(S)，认证码弹窗和已配对密钥复用保留。 |
| 刷新认证码 | 无默认键 | 转发原 generateCode；不会将认证码记录到宿主日志。 |
| 设备列表/移除 | 无默认键 | 转发原设备管理；授权和撤销落盘后才确认成功。 |
| 同步冲突模式 | 无默认键 | 原列表/不喜欢数据协商，选择请求排队，不覆盖另一模块的待选模式。 |

修复链：`sync-settings-loader.cjs` 将同一轮导入的相关键合并处理，先停止旧服务，后启动选中角色；缺目标地址时仍关闭旧角色，异步过期操作不得复活。`sync-settings-ui.test.cjs` 用真实 backup:import → Vue watch → 原服务检验角色变更及旧端口释放。

已有 `sync.test.cjs` 覆盖真实监听、失败清理、取消认证、快照创建/裁剪及 flush；`sync-auth-state.test.cjs` 覆盖真实 HTTP 配对、持久化失败、撤销与并发原子边界。`sync-interop.test.cjs` 默认跳过，需要另设 LX_SYNC_ROLE 并准备官方 LX 对端，本次未执行该互通验收。

## 开放 API：3 个默认键

| 键 | 默认值 | 行为核查与边界 |
| --- | --- | --- |
| openAPI.enable | false | renderer watcher → open_api_action → 串行原 HTTP/SSE 服务，同一原播放器控制事件。 |
| openAPI.port | 23330 | 校验 1—65535；端口冲突和无效端口可见报错；终止清理监听和订阅。 |
| openAPI.bindLan | false | false 绑定 127.0.0.1，true 绑定 0.0.0.0；沿用原无额外认证访问模型。 |

`open-api.test.cjs` 实际请求 status、歌词、播放控制、seek/volume 和 SSE，检验重复启动不重复订阅、端口冲突和关闭。局域网跨机器访问和宿主音频动作尚未实机验收。

## 备份与缓存：无额外默认键

| 控件 | 实际行为 |
| --- | --- |
| 导入/导出歌单 | playList/playList_v2/历史 defautlList 迁移；按 ID 替换匹配列表内容，保留未导入列表。 |
| 导入/导出设置 | setting/setting_v2；原迁移器、已知键和类型检查；导入重置使用协议。 |
| 导入/导出全部 | allData/allData_v2，只含原格式的设置与列表；不包含用户音源脚本、下载音频、授权、EQ 预设、同步密钥或缓存。设置/列表事务一起提交后再发布事件。 |
| 歌单 TXT/CSV | 单文件或按列表导出；BOM、CSV 引号/逗号/换行转义；目标必须授权。已修复合并导出时 renderer 先追加后缀而丢失选中单文件权限的问题。 |
| 保存文件扩展名 | 已修复用户选中不带 .lxmc/.txt/.csv 的单文件时自动追加后缀却未获授权的问题；构建适配保留所选原路径，由文件服务只对该次保存放行精确派生路径，拒绝链接逃逸，不扩大持久授权。 |
| 浏览器资源缓存 | 属于宿主管理能力；本轮按用户确认移除该控件，插件的业务缓存管理继续保留。 |
| 换源、歌曲 URL、原歌词、编辑歌词缓存 | 原控件 → renderer IPC → 注册的原 music rendererEvent → 对应插件数据库方法，统计和清理仍可用。 |
| 不喜欢列表、清空列表 | 原列表/不喜欢业务方法保留；清空列表有原确认框。 |

`backup.test.cjs` 验证 gzip round-trip、历史迁移、无效输入和 SQL 故障原子性、100 列表/10000 歌曲及 CSV；`files.test.cjs` 新增无后缀单文件保存、保持权限边界和派生链接拒绝。新增 `backup-ui.test.cjs` 执行构建适配后的原 Vue setup 所有 8 个按钮，覆盖 10 个分支：三种导入、三种导出、TXT/CSV 无后缀合并单文件和两种按目录拆分；经真实宿主选择授权、bridge、事务/文件系统核查产物，并确认派生文件及同目录未选择文件没有取得额外持久权限。缓存同时有 `settings-data-actions.test.cjs` 的原 IPC 实际统计/清理隔离证据；宿主 UI 人工验收由总任务单独记录。

## 本次验证

- 实施前服务相关 115 个 Node 行为测试通过。
- 两个问题先写行为回归：初次 5 项中 3 项按预期失败，修复后 5/5 通过。
- 媒体流代理的主播放/预加载回归先观察到原 URL 被直接送入播放器，再实施适配后通过；CONNECT 不回应故障也先复现超时缺失，再验证超时和连接清理。
- 全套集成时另发现媒体测试代理夹具偶发挂起：隧道一端断开时没有同步销毁另一端，最后无界等待目标响应关闭。真实 CONNECT 客户端与允许请求侧 EOF 后继续输出的 HTTP 字节流对端确定性复现；仅修复测试夹具的双向生命周期和关闭顺序，并对事件、body 和清理增加带错误诊断的截止等待。生产媒体服务未因此修改。两组媒体回归随后 12/12 通过。
- 本子任务最终服务分组：142 tests，142 passed / 0 failed / 0 skipped，涵盖 network、download、download-metadata、download-ui-contract、open-api、backup、backup-ui、files、sync、sync-auth-state、sync-settings-ui、media-proxy、media-proxy-ui。
- 官方 LX 对端互通需另外执行 `sync-interop.test.cjs`；全量套件与最终构建由总任务在并行修改收敛后统一复验。
- 未启动 Electron、未修改 vendor、未提交或推送。
