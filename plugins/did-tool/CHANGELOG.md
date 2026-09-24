# 更新日志

## 1.0.0 - 2026-09-23

### Docker 镜像下载工具

- 无需安装 Docker 可直接下载镜像文件进行离线导入
- 已内置 Docker Hub 官方，以及 1ms、DaoCloud 等多个国内镜像源
- 支持选择 `linux/amd64`、`linux/arm64` 等多个目标平台
- 支持配置 HTTP/HTTPS 协议代理加速镜像下载
- 支持管理自定义 Registry 镜像源，支持私有仓库用户名和密码认证
- 支持多层多文件并发下载、失败重试和断点续传
- 支持浅色和深色主题，兼容 Windows、macOS 和 Linux
