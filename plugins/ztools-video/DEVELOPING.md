# 开发说明

面向改这个插件代码的人。用户文档见 [README](README.md)。

## 构建

```sh
npm ci
npm run dev      # 开发预览 http://127.0.0.1:15182/
npm test         # 单元测试
npm run build    # 产出到 src-ztools/dist/
```

开发预览受浏览器跨域规则约束；实际线路以 ZTools 宿主为准。安装产物入口是 `src-ztools/dist/index.html`。

## preload 的打包

`npm run build` 会先执行 `build:preload`，把 [`preload-src/catalog.cjs`](preload-src/catalog.cjs) 连同 parse5 打包成自包含的 `src-ztools/preload/catalog.js`。

**不要直接改 `src-ztools/preload/catalog.js`**，它是构建产物。页面解析逻辑改 `preload-src/`。

之所以要打包：插件仓库的发布流程会删除所有层级的 `node_modules`（包括 `preload/` 下的），而 CI 只跑根目录的 `npm install`。如果 preload 在运行时 `require('parse5')`，发布后的插件会直接报错。

## 目录结构

```
preload-src/           preload 源码（会打包，含第三方依赖）
src/                   页面源码（Vue 3 + TypeScript）
  components/          界面组件
  history.ts           播放记录的读写与格式化
  prefs.ts             自动连播、免责声明等偏好
src-ztools/            插件发布目录
  plugin.json          插件清单
  preload/             preload 产物（catalog.js 是构建出来的）
  dist/                页面构建产物（不提交）
tests/unit/            Node 原生 assert 测试
tests/e2e/             真实 ZTools 宿主的端到端测试
docs/screenshots/      README 用截图
```

## 测试

单元测试用 Node 内置测试运行器，不需要额外依赖：

```sh
npm test
```

端到端测试会在隔离的 ZTools 实例里真实安装插件、播放视频：

```sh
ZTOOLS_E2E_EXECUTABLE_PATH='/Applications/ZTools.app/Contents/MacOS/ZTools' npm run test:e2e
```

要同时验证实际站点的 MP4 和带 PNG 前缀的 HLS：

```sh
ZTOOLS_VIDEO_LIVE=1 npm run test:e2e
```

跑真实站点的用例依赖站点可用性，链接会过期，不稳定的用例不要当成回归。

### 测试的组织方式

启动一个完整的 ZTools 实例（安装插件 + 加载页面）约 2 秒，远高于单条断言本身。所以用例按「能否共用一个实例」分组：一个实例内顺序跑完一组相关场景。新增场景时优先并入已有分组，不要为一条断言新开实例。

当前分组：

| 用例 | 覆盖内容 |
|---|---|
| 首屏与检索 | 安装、免责声明、频道切换、窄窗口、搜索选集、片源异常提示 |
| 播放器 | 下一集按钮、双击全屏、自动连播、连播开关 |
| 播放记录 | 封面、进度、续播、删除 |
| 实际线路 | 真实 MP4 与 HLS（默认跳过） |

## 刷新 README 截图

截图由测试生成，用的是真实站点内容：

```sh
ZTOOLS_VIDEO_SHOTS=1 ZTOOLS_E2E_EXECUTABLE_PATH='/Applications/ZTools.app/Contents/MacOS/ZTools' npm run test:e2e -- -g '生成 README 截图'
```

产物写到 `docs/screenshots/`：

| 文件 | 内容 |
|---|---|
| `home.png` | 首页搜索结果 |
| `player.png` | 播放窗口（控制栏 + 选集） |
| `history.png` | 播放记录页 |
| `channels.png` | 电影频道 |

截图会强制浅色主题并补白底——宿主窗口是透明的，不补底会截到窗口背后的深色桌面。

## 发布

发布到 ZTools 插件仓库：

```sh
ztools publish
```

前置条件（缺一项都会报错）：

- `src-ztools/plugin.json` 里的 `name` / `title` / `version` 齐全，`name` 只能是小写字母、数字和连字符
- `CHANGELOG.md` 里有当前版本条目，格式必须是 `## 1.10.0 - 2026-11-13` 且正文非空
- 是 Git 仓库，至少有一次提交，工作区干净
- logo 不能是模板默认图标

仓库侧的 CI 会按 `src-ztools` 标准目录自动跑 `npm install` 和 `npm run build`，所以 `dist` 和 `node_modules` 不需要提交。

发布后 CLI 会给出 PR 链接，还需要手动：上传截图、勾选自检清单、把 PR 从 Draft 切换为 Ready for review。

## 实现要点

- **播放器**：DPlayer，按需动态加载，主窗口不下载这 300 KB
- **HLS**：hls.js 通过 DPlayer 的 `customHls` 接入；分片做字节检测，识别「用网页代替视频分片」的片源
- **全屏**：全屏时 Chromium 把视频画在独立合成层，事件目标是面板而非 video，所以双击监听挂在 document 上用 `fullscreenElement` 判断
- **换集不退出全屏**：复用 DPlayer 的 `switchVideo`，同一个 video 元素换源，浏览器保持全屏状态
- **写入节流**：`timeupdate` 每秒触发约 4 次，按播放位置前进 5 秒才上报进度，避免频繁写存储和跨进程通知
- **存储**：`ztools.dbStorage` 底层是同步 IPC（`sendSync`），读取结果做了进程内缓存，减少阻塞
