# P0 宿主可行性验证

2026-11-09。运行命令：`npm run build`、`npm run test:p0`。

验证宿主为本机已安装 `ZTools 3.3.0-beta.2` 的 app.asar，使用独立 Electron 42.3.3 / Chromium 148 / Node 24.15.0 启动，全部配置写入随机临时目录。本轮不是本机 3.2.0 源码宿主验证，也不证明其他版本兼容。结果与完整运行时信息保存在 `artifacts/p0/report.json`，不提交临时目录和可执行文件。

| 检查 | 结果与证据 |
|---|---|
| 生产资源 | 无开发服务器，从复制后的完整插件目录加载；原 LX Btn.vue 和 Less 正常渲染 |
| 源 guest | 不采用；实际 webPreferences 有 webviewTag，但所创建元素缺少 webview 方法，8 秒内没有生成 guest WebContents |
| 源 Worker 备选 | PASS；可信 loopback frame 创建同源浏览器 Worker；HTTP 响应 CSP 阻止直接网络/文件访问和子 Worker，不在插件页面执行音源代码 |
| 同步工具 | MD5 固定向量、AES-128-CBC 固定向量、1024 位 RSA_NO_PADDING 与 Node 独立结果相同；中文 inflate/deflate 往返正常 |
| 权限边界 | Worker 中无 require/ztools；file:///C:/Windows/win.ini 读取失败，直接 HTTP 请求失败，服务端只收到三个启动资源请求 |
| 失控终止 | Worker 进入死循环后，可信 frame 仍能调用 terminate 并回执停止 |
| 后台 | outPlugin(false) 后计时继续，重进实例 ID 不变 |
| 分离窗口 | 宿主 detachPlugin 成功，原实例 ID 不变 |
| 强制退出 | outPlugin(true) 后插件 WebContents 消失 |
| 宿主 db | 读写正常；陈旧 _rev 返回 conflict；超过 1 MiB 返回错误对象；bulkDocs 的第一条成功、第二条失败会留下第一条 |
| 本地持久化 | getPath('pluginData') 指向隔离实例的插件专属目录；内置 node:sqlite 已验证事务失败回滚、关闭后重新打开数据不变 |

P0 判定：上述目标宿主与运行时的可行性通过。P1/P2 将实现完整 API 契约及音源导入，不把当前探针视为已能使用第三方音源。

## 实施取舍

1. 固定采用浏览器 Worker；loopback 服务只返回三个固定启动资源，不提供文件/API代理端点。音源 HTTP 走受控消息桥。可信 iframe 只启动/转发/终止 Worker，音源代码不进入 iframe。第三方脚本依赖 DOM 的行为不兼容标准 Worker，须明确报告。
2. 结构化数据选用已实测的设备本地 `pluginData` + 内置 SQLite，不依赖宿主账号切换时的云端数据库路由。复用 LX 数据模型与 SQL 事务，避免附带 better-sqlite3 原生二进制；账户云同步由显式 LX 同步处理。启动必须检查 node:sqlite 可用性，不对旧宿主假报支持。
3. 当前框架继续保留 Vite 作为 P0 诊断入口，原 LX 产品界面后续由独立 Webpack 入口接入。

所有验证均在隔离数据实例中完成；尚未把插件安装到用户日常 ZTools。完整稳定性、音频播放、真实音源、完整下载及 LX 对端同步另属后续阶段。
