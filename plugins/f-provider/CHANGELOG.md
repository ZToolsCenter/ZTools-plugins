# Changelog


## 1.1.0 - 2026-08-20

- 新增 AI 翻译与 AI 识图 provider，复用宿主已配置的 AI 模型
- 新增 OCR 识别并翻译 feature，识别图片文字后自动切到翻译 tab 预填并触发翻译
- 新增 AI 公式识别与图床通道，补文字模式 AI 识图渠道切换
- 修复 OCR 识别后手动切翻译 tab 无法带入文本，及历史记录丢失

## 1.0.5 - 2026-08-13

- 新增历史记录模块及 tab 状态缓存
- 修复 scoped 下暗色模式样式失效，改用 .dark 类驱动 KaTeX 预览与模式切换高亮

## 1.0.4 - 2026-08-12

- 截图识别结果窗口改用原生标题栏并隐藏菜单栏，初始尺寸下限 800×600
- 新增 LaTeX 公式识别引擎及去重打包发布链路
- HTTP 请求支持系统代理（CONNECT 隧道），谷歌翻译改用官方 translate.googleapis.com 接口
- 翻译/代码翻译入口由 regex 改为 over 类型
- native/LaTeX 引擎改由 GitHub Release 分发并单例化引擎状态
- 为 Electron 沙箱 preload 补全 setImmediate polyfill
- 引擎下载支持镜像竞速/加速点选择/取消，合并识别子页并重构设置布局
- 收敛 onPluginEnter 至 App.vue 避免覆盖式劫持，版本升至 1.0.4
- 截图识别收敛至插件内流程并移除独立结果窗口

## 1.0.3 - 2026-07-22

- native 引擎改由 npmmirror npm 包分发，落地至 userData 目录

## 1.0.2 - 2026-07-15

- 翻译视图进入/恢复时自动聚焦并全选原文
- 翻译/代码翻译命令的 regex match 补回 /…/ 边界

## 1.0.1 - 2026-07-10

- 截图识别结果改为独立窗口展示（左图右文 + 拖动缩放）

## 1.0.0 - 2026-07-02

- 初次发布，将插件提交至 ZTools 插件仓库。
- ZTools OCR + 翻译提供商插件（截图识别 / 代码翻译 / manage）
- 微信 OCR 原生模块支持 macOS（libwxocr.dylib）
