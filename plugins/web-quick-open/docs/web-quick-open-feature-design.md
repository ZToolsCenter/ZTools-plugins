# 浏览器配置开发说明

## 数据模型

浏览器配置集中保存在 `web-quick-open-browser-profiles`；每个入口保留 `browserId`。配置字段为 `id/name/icon/path/args/builtin/hidden/platform`。

- `browserId` 为空、`system` 或引用缺失时，使用系统默认浏览器
- 分组仍使用入口 `group` 字段；空值显示在默认分组
- 预设按平台过滤；内置配置删除时改为隐藏，恢复默认可重新显示
- 启动参数存为数组，支持引号输入与 `{url}` 占位符；未写占位符时自动追加 URL

## 导入导出

导出文件版本仍为 2，第一层包含 `browserProfiles`、`groups`、`engines`。入口记录包含 `browserId`。导入时合并配置，ID 冲突时保留本地内置配置或为自定义配置生成新 ID；无效引用降级为默认浏览器。旧版文件和旧入口级 browser 字段继续兼容。

## 安全与启动

不扫描本机程序。用户可主动选择程序路径，也可填写程序名。只通过 `spawn(path, args, { shell: false })` 启动；拒绝脚本扩展名，并校验 URL 为 HTTP/HTTPS。浏览器管理 UI 维护名称、路径、参数和预览。

## 2026-10-23 补充

- 图标来源并发竞速，整个操作共享 5 秒期限和 AbortController，首个成功后取消其他请求及重定向后续请求
- 沿用 1.0.3 的 `https://fav.lee.cm/get.php?url=${encodeURIComponent(parsed.host)}`，新增网页图标声明和 `/favicon.ico` 本地站点请求，与远端服务并发获取
- 插件 HTTP/HTTPS 请求统一优先使用页面原生 fetch，走宿主已配置代理的插件 Session，不修改主程序；禁用 Cookie、Referer 和缓存，流式读取保留大小限制、head 截断和共享取消，重定向由 Chromium 管理。仅无浏览器运行时使用 Node 传输，网络失败不自动切换直连
- 导入优先临时 Web Worker、其次 Node Worker 解析 JSON，结束或超时后销毁线程并释放 Blob URL；线程不可用时让出事件循环后本地解析，格式错误和超时不重试。每 50 条校验、20 条图标处理、25 条指令注册让出事件循环，文件上限 20 MB
- 数据库存储仍使用宿主同步 API，不能承诺完全无阻塞；Worker 不访问 ZTools API
- 多系统预设使用独立 ID，保留旧 Windows ID，新增 macOS/Linux ID，避免覆盖已编辑的配置；管理页仅展示当前平台预设及用户配置
- 预设和离线图标存于 `public/browser-presets.json`；程序图标由 `browser-icons.cjs` 异步获取，整体 2 秒超时并取消子进程，支持不超过 1 MB 的用户上传图标
- 管理页搜索框右侧复用主页按钮样式；路径与参数同行按 6:3 分配并留出右侧空白，超长文本省略，悬浮显示全文
- Debug 日志通过宿主 electron-log 5 的 `__ELECTRON_LOG__` IPC 接入日志收集，保留本地 console；不使用同步宿主图标 API，不增加日志开关
- Linux 常见命令名启动失败且为 ENOENT 时尝试固定别名，不遍历目录；跨平台导入不会把 Windows 自定义路径自动改写为 macOS/Linux 路径

## 验证命令

在插件目录运行 `npm test` 和 `npm run build`。
