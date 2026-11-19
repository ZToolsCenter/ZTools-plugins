# FSearch 文件搜索

作者：**lifeek** · 版本：**0.0.2** · Windows / macOS

在 ZTools 中输入 fs 或 find，快速查找本机文件和文件夹。

## 主要功能

- 按文件名或完整路径搜索，支持字符模糊、正则和大小写匹配。
- 按类型、位置、扩展名、修改时间和大小筛选，支持排除目录。
- 图片列表显示缩略图；大图在独立窗口打开，支持滚轮定位缩放、自由拖动和最大化。
- 保存常用搜索为预设，也可生成 ZTools 独立指令。
- 可开启主搜索推送，在 ZTools 搜索框直接输入 fs 关键词查看匹配。

## 首次使用

**Windows**：从 [Everything 官网](https://www.voidtools.com/downloads/) 安装 Everything 完整版并启动客户端，然后在插件“使用与连接”点击“检测连接”。插件已附带官方 ES 命令行工具，不需要另外下载；不包含 Everything 客户端安装程序。

**macOS**：单独安装 [noahdunnagan/fsearch](https://github.com/noahdunnagan/fsearch)。正文、代码定义、Git 状态、常用优先和 Quick Look 为 macOS 专属功能。

## 数据与隐私

查询和预览在本机完成，插件不上传文件名、图片或正文，不建立额外索引。设置和预设保存在 ZTools 本地存储中。

## 兼容说明

Windows 已在 ZTools 3.2.0 与 Everything 1.4.1.1026 环境检查主要功能。macOS 最新图片窗口体验仍待实机确认。更多信息见安装和隐私说明。

## 功能预览

截图来自 Windows ZTools，使用专门生成的演示文件和图片；可点击查看原图。

### 文件搜索

![文件搜索](docs/screenshots/market-0.0.2/01-windows-search.png)

### 图片缩略图

![图片缩略图](docs/screenshots/market-0.0.2/02-windows-images.png)

### 独立大图预览

![独立大图预览](docs/screenshots/market-0.0.2/03-large-preview.png)

### 主搜索推送

![主搜索推送](docs/screenshots/market-0.0.2/04-main-push.png)

### 搜索预设

![搜索预设](docs/screenshots/market-0.0.2/05-preset-command.png)
