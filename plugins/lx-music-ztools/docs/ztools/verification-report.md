# 0.1.0 本地验证回执

这是0.1.0的历史回执。当前0.1.1设置修复、实际宿主回归和安装包校验见[设置逐项验收](settings-validation-report.md)，不要将本页旧ZIP或长测对象当作当前版本。

日期：2026-11-10。对象是Windows x64第三方原生插件；没有把当前版本发布到市场。交付ZIP路径为 `dist-ztools/lx-music-ztools-0.1.0.zip`，SHA256：

```text
8318ebb161be9d95a5c3c6edebd714f30beed2fd8e022cfebe91708561f5cf1e
```

运行组合为真实已安装 ZTools3.3.0-beta.2 app.asar + 官方独立Electron41.4.0 / Node24.15.0 / Chromium146.0.7680.216；所有测试使用独立临时数据，不读写日常ZTools/LX配置。测试程序可用开发工具驱动安装/观察宿主，产品只使用公开插件API。

| 验证 | 结果 | 本地证据 |
| --- | --- | --- |
| 完整构建/安装资源/依赖/类型检查 | PASS，117个逐模块可读上游服务，147个生产依赖版本许可 | `artifacts/final-build.log`、`artifacts/final-check.log` |
| Node契约/故障回归 | 159项：158 PASS、0 FAIL、1默认SKIP | `artifacts/final-unit.log`；skip为需显式官方peer的组合，另有真实互通证据 |
| 新ZIP完整宿主流程 | 14个脚本PASS | `artifacts/e2e/report.json`、`artifacts/final-e2e.log` |
| 本地/URL音源、死循环初始化与请求超时 | PASS；失控Worker终止后正常源可继续请求 | `artifacts/source/report.json`、`artifacts/source-ui/report.json` |
| 原UI/布局/主题 | PASS；无桌面按钮/边框，手动深色和宿主深浅色通知，活动样式不被懒加载默认样式覆盖 | `artifacts/renderer/report.json` |
| 原播放器、开放API控制、本地媒体/DSP | PASS；MP3/FLAC/WAV中文路径导入和解码，原AudioWorklet，HTTP控制同一播放器 | `artifacts/player/report.json`、`artifacts/local-media/report.json` |
| 榜单/歌单/备份 | PASS；KW201首/3页，MG65首/2页/分享链接，批量收藏/编辑排序，设置+列表恢复和TXT/CSV | `artifacts/library/report.json`；另解密校验KW请求pn=0/1/2、MG pageNo=1/2 |
| 下载与恢复 | PASS；标签/歌词/SQL完成状态，正常Range；强杀后任务pause再显式从768字节续传，解码PCM一致 | `artifacts/download/report.json`、`artifacts/recovery/report.json` |
| 100列表/10,000首强杀恢复 | PASS；前后内容/顺序摘要均为 `841c649b12f4575ce31764fd376aad06020aab60cff3162ef042ed85c2f4dde2`；不自动发声 | `artifacts/recovery/report.json` |
| LX官方对端互通 | 最终ZIP client/server各19项，共38 PASS；错误认证、双向列表/不喜欢、原Vue冲突选择、离线排序重连、撤销设备/重新认证、隐藏/停止/kill | `artifacts/final-e2e.log`；官方2.12.6 archive/asar身份见兼容矩阵；不附带对端程序 |
| 认证业务成功前落盘 | 新ZIP额外7项PASS：首次服务端identity、新授权、撤销即时读盘，旧key拒绝、重配不复活旧key、客户端本地key与官方服务端一致及免码重连 | `artifacts/auth-commit-final.log`；不是依靠dispose/flush补写 |
| 桌面歌词/宿主指令 | PASS；原歌词、独立PID、无audio、置顶/锁定/隐藏/关闭、字体216种；原生搜索/播放暂停/上下首/歌词指令 | `artifacts/system/report.json`、`artifacts/commands/report.json` |
| 用户真实音源/外部平台 | 最终ZIP上指定monster.js导入、初始化、kw_228908真实播放和下载PASS；五平台当时均有搜索结果 | 私有报告仅留OS临时目录；不提交脚本、URL、凭据或音频 |
| 原始音源排除 | 23个去重脚本内容hash与Git/产品树/ZIP对比，未发现匹配 | 发布前审计，不分发私有脚本 |
| 原上游完整性 | 736个文件与Git对象323e4bac内容一致；689个仅CRLF/LF差异 | `artifacts/vendor-integrity.json`；本次只改外部适配/构建，未运行独立桌面安装器构建 |

核心播放/下载检查点连续 **1,807,934 ms**、50次进入/隐藏及分离PASS，播放累计1,791.56秒，业务监听器34不变，额外Audio创建0，120次进程采样保持9个，总工作集约1325→1217MiB，下载解码PCM SHA256前后一致。证据为 `artifacts/stability/report.json`。随后主题、标准源HTTP、歌词轮询和认证持久化修正由最终ZIP整套专项及另一次50次短回归覆盖（`artifacts/stability-final/report.json`，请求8秒、实际15,247ms），没有将最终ZIP字节称为已连续长测30分钟。

全分支审查发现并解决三项Important：标准源不能继承目录SDK的JSON默认编码；歌词旧poll不能覆盖新操作；新授权/撤销/首次identity及客户端key必须原子落盘后才成功。修复提交为 `f7cb288`、`5704c0d`、`5ac4946`，精确故障回归52/52、真实Worker请求对照12类通过，独立最终复核Spec/Quality均Approved且没有新增Critical/Important。完整审查记录见 [审查与修复](review-report.md)。最终新ZIP又完成了上述整包、用户源和认证专项，没有移用旧包的通过结论。

已观察的失败保留：独立Electron42.3.3的早期30分钟尝试在约695秒因插件WebContents消失FAIL，原因未定位；独立宿主冷启动也曾缺少preload。匹配安装版的41.4.0通过不能推广为所有版本稳定。人工听音、物理全局按键、日常EXE全流程、其他OS、任意第三方源及外网/移动同步没有全量验收。下载目标文件系统需支持hard link；宿主差异和元数据崩溃窄窗见兼容矩阵。

源码和安装包均不预置用户音源。全部备份只含原格式设置与列表；真实脚本留在用户原目录或导入后的私有插件数据库。完整设置映射135项见 `settings-map.md`。
