## 发布打包问题记录

之前在 `timestamp/src-ztools/` 子目录执行 `ztools publish`，导致提交插件时只提交了 `plugin.json` 和 Logo，缺少源码、`package.json` 和构建产物，官方 Action 打包后无法安装。

以后必须在项目根目录发布：清单放在 `public/plugin.json`，Vite 构建输出到 `dist/`，清单中的 `main` 使用 `index.html`。发布前确认 `dist/plugin.json`、`dist/index.html` 和 `dist/logo.png` 存在。
