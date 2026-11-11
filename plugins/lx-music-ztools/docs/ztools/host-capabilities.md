# 宿主能力与边界

0.1.0 原生移植通过 ZTools 公开 API 与插件 preload 实现服务，不启动完整 LX 主进程。当前支持承诺以 Windows x64 首验及 [验证矩阵](compatibility.md) 为界。

| 能力 | 映射与行为 | 边界 |
| --- | --- | --- |
| 音乐窗口 | 单实例插件视图，保留原 LX UI；窗口大小/全屏/分离/关闭由宿主管理 | 不复制原 LX 独立应用窗口、托盘和更新器；主页面桌面窗口按钮隐藏 |
| 生命周期 | 进入/重入复用实例；隐藏保持播放器和已启用服务；终止清理 | 核心服务已通过41.4.0下30分钟/50次往返；宿主退出/终止不继续播放 |
| 设备本地存储 | `getPath('pluginData')` + 内置 `node:sqlite`，复用原 SQL 模型 | 不附带 better-sqlite3 原生二进制，不依赖 ZTools 账号云数据库；旧宿主需实际能力检测 |
| 文件操作 | 公开文件/目录对话框授予 canonical 路径能力，可信 preload 操作 | 不把全部硬盘读写权交给音源；导入备份的路径需重新授权 |
| 音源 | 可信 loopback frame 创建 CSP 浏览器 Worker，HTTP/取消走消息桥 | 无 Node/宿主 API/DOM；禁止把原始用户音源放进仓库、产品包或第三方许可文件 |
| 下载与元数据 | 本地 hard link/rename 与身份校验；隐藏、宿主拥有的临时窗口运行 metadata job | 所有新下载需 hard link；临时元数据窗口不执行用户音源，不能把附加 renderer 算另一个播放器 |
| 桌面歌词 | `createBrowserWindow` 加载原 renderer-lyric，公开窗口代理负责 bounds/top/lock/taskbar | 独立歌词进程、无 audio；系统全屏自动隐藏未实现，详见设置表 |
| 指令与全局快捷键 | manifest 指令、onPluginEnter、redirectHotKeySetting；五项LX指令 | 无独立系统媒体键注册；物理按键实际触发待验 |
| 系统媒体会话 | 仅使用运行时实际公开的 MediaSession 能力 | 不保证每个平台显示/媒体键行为，不调用不存在的宿主 API |
| 电源锁/任务栏 | 原入口明确返回不支持；设置项禁用 | 不支持独立 powerSaveBlocker、Windows任务栏进度/缩略图按钮或状态栏歌词 |
| 输出设备 | 原媒体设备逻辑带能力检测 | mediaDevices 缺失时只支持系统默认输出，设备切换/移除检测不承诺有效 |
| 开放 API / 同步 | 原业务模块在同一插件存储与播放器上运行，默认关闭 | 显式启用后隐藏仍监听；终止释放，ZTools账号不会自动迁移音乐数据 |
| 更新与缓存 | 插件更新、浏览器资源缓存由宿主管理 | 保留原歌曲地址/歌词/换源缓存与不喜欢列表操作；原LX桌面自动更新不可用 |

## 当前宿主验证

已安装 ZTools **3.3.0-beta.2 app.asar**，SHA256 `676ed28025792e7e0492967e794ad693d65b264b572d97d754de645579529bc7`，由匹配安装 EXE 的独立官方 Electron **41.4.0 / Node 24.15.0 / Chromium 146.0.7680.216** 启动，使用随机临时数据目录。最终ZIP通过14个串行宿主场景：本地格式/DSP、搜索/榜单/歌单/备份、下载/强杀恢复、同步双向38项、原歌词和指令等。系统字体枚举216种，歌词独立PID且无audio。开放API通过实际HTTP控制同一原播放器。核心30分钟长测及最终ZIP50次短回归独立记录；真实物理快捷键、人工听音、日常EXE全流程仍未验。

## 历史 P0：2026-11-09

以下保留最初可行性结论；环境为 ZTools 3.3.0-beta.2 app.asar + 独立 Electron **42.3.3 / Chromium 148 / Node 24.15.0**，不是41.4.0后续验收，也不是源码3.2.0宿主结果。证据为 `artifacts/p0/report.json`。

| 检查 | 当时结果 |
| --- | --- |
| 生产资源与原 Vue/Less | PASS：从复制后的插件目录加载，无开发服务器 |
| webview guest | 不采用：元素缺少方法，8秒内未生成guest WebContents |
| CSP Worker | PASS：loopback只返回三个固定启动资源，音源不能直连网络/文件或创建子Worker；失控Worker可终止 |
| 同步工具 | PASS：MD5、AES-128-CBC、RSA_NO_PADDING与独立Node结果相同；中文压缩往返 |
| 宿主生命周期 | PASS：隐藏计时持续、重入/分离保持实例、强制终止后WebContents消失 |
| 宿主云db | 读写正常；陈旧rev冲突、超过1MiB报错；bulkDocs可部分成功 |
| 本地SQLite | PASS：事务失败回滚、关闭重开持久化；因此采用设备本地结构化存储 |

当时P0 PASS只解决宿主/隔离/存储可行性，没有证明完整音乐业务。随后42.3.3长测约695秒出现WebContents消失并记FAIL；冷启动也曾出现宿主window.ztools未注入。41.4.0核心检查点已通过30分钟/50次往返，后续主题/歌词修正另行回归；这些结果不抹去其他运行时的失败。
