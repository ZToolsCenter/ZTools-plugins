## 发布打包要求

必须在项目根目录执行 `ztools publish`，不要进入 `public/` 或 `dist/` 子目录发布。

插件清单和静态运行文件放在 `public/`，Vite 构建输出到根目录 `dist/`。清单中的 `main` 必须使用 `index.html`，preload 使用 `preload/services.js`。

根目录执行 `npm install` 时会通过 `postinstall` 安装 `public/preload` 的运行依赖；Vite 构建会将完整 `public/` 内容复制到 `dist/`。发布前必须确认以下文件或目录存在：

- `dist/plugin.json`
- `dist/index.html`
- `dist/logo.png`
- `dist/preload/services.js`
- `dist/preload/docker-service.js`
- `dist/preload/node_modules/`
