# local-ip

轻量的 ZTools 插件，用于一键复制本机内网 IPv4 地址。

## 功能说明

- 触发词：`ip` / `IP` / `Ip`
- 自动获取本机可用网卡的 IPv4 地址
- 优先复制内网地址（`10.x`、`172.16-31.x`、`192.168.x`）
- 如果存在多个地址，则按行拼接后一起复制
- 复制完成后自动退出插件

## 文件结构

```text
local-ip/
├── index.html
├── plugin.json
├── preload.js
├── logo.png
└── README.md
```

## 打包说明

确保压缩包根目录包含 `plugin.json`，可在当前目录执行：

```bash
zip -r local-ip.zip . -x ".DS_Store" -x "*/.DS_Store"
```

然后在 ZTools 插件管理中导入 `local-ip.zip` 即可。
