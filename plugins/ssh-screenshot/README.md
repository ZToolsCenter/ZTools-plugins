# SSH 截图

一个 ZTools 插件：把本地剪贴板里的最新截图通过 SSH 上传到远端，然后把远端绝对路径
自动粘贴到上一个焦点窗口。常见用途：在 SSH 里使用 Claude Code 等 CLI 工具时，
需要让远端进程读取本机的截图。

## 命令

| 命令 | 行为 |
| --- | --- |
| `粘贴截图路径` / `scp 截图` / `ssh 截图` | 取剪贴板最新图片 → SFTP 上传 → 把远端路径写入剪贴板并自动粘贴 |
| `SSH 截图配置` | 打开配置页面，设置 host / port / user / password / 远端目录 |

首次使用 `粘贴截图路径` 命令时，如果未配置完整，会自动跳到配置页。

## 开发

```bash
# 一次性安装两份依赖（构建用 + preload 运行时用）
npm install
(cd src/release_npm && npm install --omit=dev)

# 开发模式（vite dev server，端口 5179；plugin.json 已指向该端口）
npm run dev
```

## 构建插件包

```bash
bash build-plugin.sh
# 产物在 ./dist/，把整个目录加载到 ZTools 即可
```

`vite.config.js` 会把 `preload.js`、`plugin.json`、`logo.svg` 以及
`src/release_npm/node_modules` 拷贝到 `dist/`，使 preload 在运行时
可以 `require('node-ssh')`。

## 配置存储

配置（含密码）保存在 `window.ztools.dbStorage`，明文存储。如需更安全的存储方案，
可改用 Electron 的 `safeStorage` 或 OS keychain。

## 主要 API 依赖

- `window.ztools.onPluginEnter(cb)` — 收到 feature `code` 决定路由
- `window.ztools.clipboard.getHistory(page, size)` — 取最近一张图片的 `imagePath`
- `window.ztools.clipboard.writeContent({type:'text', content}, true)` — 写文本并触发粘贴
- `window.ztools.dbStorage.{get,set,remove}Item` — 本地配置持久化
- `window.ztools.outPlugin()` — 关闭插件窗口
