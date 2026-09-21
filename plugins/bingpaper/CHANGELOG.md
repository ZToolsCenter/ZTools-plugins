# Changelog

## 1.0.0 - 2026-09-17

### Added

- 浏览 Bing 每日壁纸：中国区 + 国际区（`ensearch=1`）双图源各取 `idx=0&n=8` + `idx=8&n=7`，按 urlbase 基础 id（`_` 前段）合并去重，同一张图的跨市场重复只保留中文版（实测 `mkt` 参数被服务端按 IP 忽略、`_480x270` 缩略图档位 404，故缩略图用 640x360）
- 历史归档：接入 npanuhin/Bing-Wallpaper-Archive，2024-04 至今按年浏览中国区壁纸（官方接口硬上限 15 天，实测 idx 加大也只回到第 15 天）；归档 `bing_url` 为 Bing 官方 UHD 直链，提取 urlbase 后缩略图（640x360）、大图预览（1080p）、下载/设壁纸（UHD 4K）全部走 Bing CDN，归档直链仅作兜底
- 分页浏览：每页 12 张
- 大图详情：1920x1080 预览 + 版权信息 + 每日故事，显式「关闭」按钮
- 下载壁纸：支持 1920x1080 / UHD 4K 两档分辨率，已存在文件自动跳过
- 一键设为桌面壁纸（Windows）：PowerShell `SystemParametersInfo(SPI_SETDESKWALLPAPER)`，固定使用 UHD 4K 原图，未下载时自动缓存后再设置
- 下载路径配置：可切换「每次弹窗另存」或「保存到默认目录」（初始 `~/Pictures/BingPaper`，可自选），配置持久化于 ZTools dbStorage
- 接口失败兜底：错误提示 + 重试按钮

### Fixed

- 暗色主题下卡片/弹窗白底（引入 Element Plus dark css-vars 并跟随系统切换 `html.dark`）
- 大图弹窗 860px 固定宽度超出 ZTools 窗口、右上角关闭按钮被截到屏幕外无法关闭（改为 90% 宽度 + 显式关闭按钮）
- 渲染进程直连 Bing CDN 图片加载失败（部分网络环境下 QUIC/代理导致 `<img>` 全部 net::failed）：缩略图改由 preload 走 Node https 下载到本地临时缓存（`%TEMP%/bingpaper-thumbs`）后转 data URL 展示，磁盘缓存后翻页零网络请求；Node 通道失败时回退渲染进程直连

### Changed

- 触发指令由模板示例（你好/hello/读文件/保存为文件）改为 `壁纸` / `bing` / `wallpaper` / `bp`
- 移除模板示例组件 Hello / Read / Write

## 0.0.1 - 2026-09-17

- 初次发布，将插件提交至 ZTools 插件仓库。
