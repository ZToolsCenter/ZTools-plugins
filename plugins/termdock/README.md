# TermDock

TermDock 是一个面向 ZTools 的远程工作台插件，提供 SSH 终端、远程文件管理、传输任务、连接管理、系统信息监控和命令模板等功能。

## 功能

- SSH 远程终端，多标签会话管理
- SFTP / FTP 文件浏览、上传、下载、重命名、删除和权限修改
- 本机与远程双栏文件管理
- 传输任务状态查看和终止
- 远程主机系统信息、进程、网络和文件系统监控
- 连接管理器、命令管理器和会话右键菜单
- 支持主题切换、终端字体大小调整和布局尺寸记忆

## 移植来源

本插件移植自开源项目 [St0ff3l/termdock](https://github.com/St0ff3l/termdock)，并适配为 ZTools 插件运行方式。

## 构建

```bash
npm install
npm run build
```

插件清单位于 `public/plugin.json`，构建时会自动复制到 `dist/plugin.json`。
