# Changelog


## 2.3.0 - 2026-08-29

- 移除 handle 开头的 outPlugin()，它会在 ffmpeg 执行前销毁插件进程（点了没反应）
- 修 flac 转换失败，加 -map 0:a:0 跳过封面/多轨
- plugin.json 改用 ZTools 的 match 语法，type:files 命令才能被超级面板匹配到
- 输出目录只读时自动回退桌面；错误提示保留 ffmpeg 原始 stderr
- 转换前弹「开始转换 N 个文件…」；诊断日志写 %TEMP%/ncm-converter-debug.log

## 2.2.0 - 2026-08-28

- 初次发布，将插件提交至 ZTools 插件仓库。
