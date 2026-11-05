# 测试用宿主源码快照

来自 ZTools v3.3.0-beta.2（76addc6a03940006b5c208e125737d7d4ce953e9），MIT，原版权见 LICENSE。仅用于隔离测试，不会启动 Electron、打开用户数据库或安装应用。

源码来源：https://github.com/ZToolsCenter/ZTools/tree/76addc6a03940006b5c208e125737d7d4ce953e9

授权弹窗快照包含 PR #710 的初始按钮状态修复（https://github.com/ZToolsCenter/ZTools/pull/710），因此不能将本夹具描述为完全未经修改的 beta.2。其余授权处理逻辑按快照执行；Electron 窗口、IPC 发送方、数据库及插件市场由内存夹具代替。

测试使用 Node.js >= 22.13 的 module.stripTypeScriptTypes；用户运行插件不需要另装 Node.js。测试账号 tester / app-password 仅供 127.0.0.1 内存 WebDAV 使用。
