# 功能与验证状态

更新：2026-11-11；当前版本0.1.2已完成本地验收，通过源码仓库及插件中心更新流程提交，市场版本以审核合并为准。0.1.0的历史长测与首次移植证据保留，0.1.1的设置修复和完整ZIP复验见[设置验收报告](settings-validation-report.md)，0.1.2的字号缺陷与渲染测量更正见[字号修复](font-size-fix.md)。PASS只适用于对应列的场景，不能由已实现推导真实平台或长期运行通过。

## 环境与证据层级

当前首验为 Windows x64，已安装 ZTools **3.3.0-beta.2 app.asar**，通过独立官方 **Electron 41.4.0 / Node 24.15.0** 在隔离临时数据目录运行；该运行时与安装 EXE 标识匹配。不是直接在用户日常 `ZTools.exe` 和真实配置中完成全部验收，也没有验收其他操作系统或全部 ZTools 版本。

历史 P0 使用独立 Electron **42.3.3 / Chromium 148 / Node 24.15.0**。该组合有可行性 PASS，也有后续长测约 695 秒插件 WebContents 消失的 **FAIL**。两者分别保留；匹配安装版的 41.4.0 核心播放/下载检查点长测已经 PASS。

## 模块矩阵

| 模块 | 实现与受控验证 | 实际宿主 / 外部 LIVE | 证据与限制 |
| --- | --- | --- | --- |
| 原 LX UI / 布局 | PASS：原页面独立 Webpack 构建，去除桌面最小化/关闭及外框留白 | 实际宿主 PASS：搜索、设置、播放详情 | `artifacts/renderer`；播放详情返回按钮保留 |
| 桥接 / 生命周期 / SQLite | PASS：通道、订阅、事务回滚、重开、隐藏/重入/分离/终止 | P0 指定组合 PASS | `artifacts/p0/report.json`，历史 P0 不代表后续全部任务完成 |
| 自定义源隔离/API 2.0.0 | PASS：本地/URL导入、crypto/Buffer/zlib、独立源Needle默认编码/Buffer类型/回调取消、初始化/能力校验、切源代次；真实Worker12类对照 | 最终新ZIP复测用户23个去重脚本均导入；20初始化、3失败；指定样本真实播放/下载完成 | DOM依赖与服务异常真实保留；私有脚本和URL不入仓、不分发 |
| 五平台搜索 | PASS：原 SDK 的签名/转换/列表状态及受控响应 | 外部 LIVE：kw/kg/tx/wy/mg 当时均返回搜索结果 | `artifacts/catalog/report.json` 只代表受控证据；LIVE 不能证明每首可播 |
| 原播放器 / 后台 / 控制 | PASS：合成音频时间推进、暂停/继续、后台、下一首 | 指定用户源 monster.js 的 kw_228908 实际播放 PASS | `artifacts/player/report.json`；真实样本证据在私有临时目录，人工听音未验 |
| 本地音频 / DSP | PASS：MP3/FLAC/WAV 解码与进度；均衡器、phase-vocoder AudioWorklet | 41.4.0 实际宿主 PASS | `artifacts/local-media/report.json`；不扩大为所有编码格式/输出设备/人工声学验收 |
| 榜单 / 在线歌单 / 列表 | PASS：原 SDK 与 store，201 首榜单分页、65 首歌单完整导入，编辑/排序 | 41.4.0 实际宿主，受控响应 PASS | `artifacts/library/report.json`；201/65 是受控样本数量，非 LIVE 平台内容数量 |
| 备份 / 文本导出 | PASS：旧/当前/gzip，设置与列表事务回滚，TXT/CSV | 41.4.0 实际宿主 PASS | `artifacts/library/report.json`；全部备份含设置+列表，不含音频/原脚本 |
| 下载原 UI / Range / 重试 | PASS：原任务流程，Range/If-Range、200/206校验、有界重试、暂停/续传与最终化 | 实际宿主受控 MP3 下载 PASS；指定真实源下载 PASS | `artifacts/download/report.json`、Task 8 报告；所有新下载需要 hard link |
| MP3/FLAC 标签 / 封面 / 歌词 | PASS：实际 writer、回读；标签前后 FFmpeg PCM SHA256 相同 | 宿主 MP3 标签及歌词 PASS | Task 8 受控 Node/宿主证据分开；不承诺 WAV/APE 标签能力 |
| 下载崩溃与用户文件保护 | PASS：单测覆盖归属/同名/重试/恢复；拒绝非本任务 inode | 长流程恢复专项以最终报告为准 | rename→fingerprint 窄窗保守报 ownership 错误并保留文件，不能称自动恢复 PASS |
| LX 同步 client/server | PASS：原RSA/AES/MD5/压缩/快照/合并；19单测、认证状态12项故障回归及4官方Node组合 | 新ZIP与官方LX2.12.6双角色38项PASS，另7项认证即时落盘PASS | localhost/原Vue合并、双向内容顺序、离线重连/撤销/停止；不以退出flush代替认证成功前提交；不是长期/所有策略验收 |
| 开放 API | PASS：原 HTTP/SSE/控制协议、停止清理与失败处理 | 实际宿主 HTTP status/pause/play/next 控制同一原播放器 PASS | `artifacts/player/report.json`；默认关闭，LAN 需显式开启，沿用原访问模型 |
| 原桌面歌词 | PASS：原 renderer-lyric、毫秒事件、独立宿主窗口、样式与配置 | 实际宿主置顶/锁定/隐藏/关闭 PASS | `artifacts/system/report.json`；歌词进程不另建播放器；系统全屏自动隐藏不支持 |
| 指令 / 快捷键设置 | PASS：指令冷启动排队、去重、搜索、播放控制、设置API调用契约 | 最终ZIP原生指令搜索/播放暂停/上下首/歌词开关PASS；快捷键设置页面与物理按键未人工验收 | `artifacts/commands/report.json`；独立app.asar测试环境的内置设置插件路径与日常EXE不同，不据API stub证明页面跳转 |
| 完整设置 | 135键及全部管理项逐域审计，修复保存/同步/备份/代理/输出/搜索/缓存断链；歌词保留，非歌词桌面设置按用户决定移除 | 0.1.1实际宿主16分区、89个开关/单选保存、4项管理操作、39项音频/歌词/网络效果PASS；包括非默认输出/DSP接管修复 | [设置验收](settings-validation-report.md)；物理拔插、物理快捷键和人工声学判断不由自动验证替代 |
| 独立 ZIP / 依赖 / 许可 | PASS：显式组装、传递依赖/资源/许可缺失即失败、逐文件回执、固定时间戳ZIP | 0.1.1最终ZIP的16个串行宿主脚本PASS；0.1.0历史14项另有记录 | `artifacts/e2e/report.json`、`artifacts/install/report.json`；实际ZIP986文件对23个私有音源hash扫描无匹配 |
| 100 列表 / 10,000 首 / 重启 | 备份/数据受控契约PASS | 最终ZIP public kill→重开PASS，内容和顺序SHA256完全相同；源持久化、不自动发声、下载从768字节续传并完成PCM校验 | `artifacts/recovery/report.json`；恢复的任务先为pause，用户显式继续 |
| 30 分钟后台播放+下载 / 50 次生命周期 | 核心服务检查点 PASS：1,807,934 ms，播放累计1,791.56秒，下载PCM SHA256相同 | 41.4.0 PASS；业务监听34不增长，额外Audio=0，采样进程9→9；42.3.3历史约695秒FAIL保留 | `artifacts/stability/report.json`；120次采样总工作集约1325→1217MiB。主题/歌词后续修正另做最终ZIP回归，不将最终ZIP字节冒称长测对象 |
| 人工听音 / 物理按键 / 日常 EXE 全流程 | 未完成 | 待验 | 自动播放状态、PCM 哈希或同版本 app.asar 验证不能替代这些结果 |

## 同步对端身份与范围

官方 LX Music Desktop **2.12.6 Windows x64 green**，原二进制未修改。archive SHA256：

```text
a07d2a15dbcf06ce689bf8b99c64241b06deb28fdfb6ffe79b6dcdfbb0d157a5
```

官方 app.asar SHA256 为 `d800d31f1983c7a74752ff3449388c421a9687a075d68988e7d9fe9a478e7b45`。Node 验收保留两个角色正常互通与 SQLite 拒绝提交四组合；实际 ZTools 专项通过原 bridge 与原 Vue 冲突弹窗驱动，双方独立读回内容/顺序，client/server 各19项，共38项通过。

前期专项使用开发注册的独立插件目录；最终新ZIP又在新数据目录复测client/server两方向38项并通过（`artifacts/e2e/report.json`），另以 `--auth-commit-only` 完成7项成功ACK即时读盘/重连检查（`artifacts/auth-commit-final.log`）。外网、移动版本、所有overwrite/full/cancel策略、跨数据库原子提交和长期同步稳定性不在此结论中。私有raw临时证据不作为产品安装包内容；交付摘要见 [验证回执](verification-report.md)。

## 复跑

标准入口：`npm run test:ztools`、`npm run check:ztools`、`npm run build:ztools`、`npm run pack:ztools`、`npm run test:ztools:e2e`。E2E 按分组串行选择场景；`npm run test:ztools:e2e -- --list` 列出分组，`npm run test:ztools:e2e -- --grep "^(player|library|download)$"` 选择专项。当前分组为 host-probe、source、catalog、player、library、download、storage、sync、system、acceptance、stability。不传筛选会运行全部分组，包括长测；不要同时启动多个宿主/官方 peer 验收。

宿主专项使用 `ZTOOLS_EXECUTABLE` 指定匹配的独立 Electron，`ZTOOLS_APP` 指定实际 ZTools app.asar；真实官方同步另需显式 `LX_ORIGINAL_PEER`。缺少真实对端环境应记 BLOCKED，不计为 LIVE PASS。音源私有验证不向命令或日志写入脚本正文、URL 和凭据。仅检查语法或 `--check-only` 不代表运行通过。
