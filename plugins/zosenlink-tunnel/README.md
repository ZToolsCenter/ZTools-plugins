# 中森内网穿透

ZTools 内网穿透插件。用户只需要输入客户端激活密钥，插件会从 npmmirror 下载 `zosenlink-core` 对应平台二进制并缓存到本地。

## 使用

1. 在 ZTools 中输入 `内网穿透`、`中森内网穿透`、`zosenlink`、`frp` 或 `frpc` 打开插件。
2. 输入客户端激活密钥。
3. 点击绑定。首次使用会自动下载客户端依赖；后续启动时如果 npm 包有新版本，会自动下载更新。

客户端启动后会连接固定平台地址：

```text
http://39.106.140.106
```

远程修改通道配置后，托管 frpc 会自动拉取新配置并热更新；如果切换 frps 节点，会自动重连到新节点。

## 客户端依赖

插件不再内置客户端二进制。运行时依赖来自 npm 包：

```text
https://registry.npmmirror.com/zosenlink-core
```

本地缓存目录：

```text
macOS: ~/Library/Application Support/ZTools/zosenlink-tunnel/core
Windows: %APPDATA%/ZTools/zosenlink-tunnel/core
```
