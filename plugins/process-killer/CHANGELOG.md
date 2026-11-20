# Changelog

## 1.0.0 - 2026-11-20

- 初次发布到 ZTools 插件市场，插件 ID `process-killer`（进程管家）。
- 列出进程的 CPU、内存与监听端口，支持按内存 / CPU / 名称 / 端口排序，搜索进程名、路径、PID 或端口。
- 关闭进程：先发送 SIGTERM（Windows 走 WM_CLOSE），3 秒未退出时提示可强制结束；另有重启 .app、复制路径、在文件夹中显示、查看完整启动命令。
- 主搜索框直出结果：输入 `kill chrome`、`netstat 8080` 直接列出进程，回车即可关闭。
- 自动 / 手动刷新开关；关闭进程前弹出确认框，确认后才执行。
- 支持 macOS 与 Windows 双端。
