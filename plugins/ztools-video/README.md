# 影视搜索 · ZTools 插件

在 ZTools 的开发插件管理中导入 [`src-ztools/plugin.json`](src-ztools/plugin.json)。插件目录是 `src-ztools/`，里面包含清单、图标、preload 依赖和构建后的页面。

在 ZTools 搜索「影视搜索」或「视频播放」。输入片名，点击结果即可播放；剧集支持选集、分页和切换线路。也可以在插件输入框直接粘贴 4K 影视播放页、MP4 直链或 M3U8 链接。若播放地址失效，可点「重试播放」重新获取。

顶部可切换「首页」「电影」「电视剧」「动漫」。首页用于搜索，三个频道按 4K 影视原站的分组和顺序显示影片。

在 ZTools 中点击影片或提交播放链接，会打开独立的播放详情窗口。选集、切换线路和重试都在播放窗口内完成；双击视频进入或退出全屏。主窗口保留当前列表，再选一部影片时复用播放窗口。

剧集播完会自动播放下一集，播放器复用同一个 video 元素换源，所以全屏看片时不会退出全屏。播放器下方的「自动连播」可以关掉这个行为，选择会被记住；单集影片和直链没有这个开关。播放器控制栏的播放按钮右侧还有「下一集」按钮，随时手动切集，全屏下同样可用；最后一集会自动隐藏。

播放进度会自动记录。点右上角的时钟图标进入「播放记录」页：同一部剧只保留一条，带影片封面，显示看到第几集、已看多久和剩余时长，右上角角标是记录条数。点记录会回到上次观看的那一集和位置；看完后进度归零，下次从头播放。记录支持单条删除和整体清空，保存在 ZTools 本地键值存储中，不上传。

站内搜索和播放地址解析使用 4K 影视的公开访客接口。播放界面使用 DPlayer；HLS 由随插件打包的 hls.js 接入 DPlayer，MPEG-TS 探测能识别带 PNG 前缀的分片。

## 开发与验证

```sh
npm ci
npm run dev
npm test
npm run build
```

开发预览：`http://127.0.0.1:15182/`。网页预览受浏览器跨域规则约束；实际线路以 ZTools 宿主为准。安装产物入口为 `src-ztools/dist/index.html`。

`npm run build` 会先执行 `build:preload`：把 [`preload-src/catalog.cjs`](preload-src/catalog.cjs) 连同 parse5 打包成自包含的 `src-ztools/preload/catalog.js`。插件仓库的发布流程会忽略所有 `node_modules` 目录（包括嵌套的），所以 preload 不能在运行时依赖外部包。改页面解析逻辑请编辑 `preload-src/`，不要直接改 `src-ztools/preload/catalog.js`——它是构建产物。

发布到插件仓库用 `ztools publish`（需先 `git init` 并提交，且 `CHANGELOG.md` 里有当前版本条目）。仓库会按 `src-ztools` 标准目录自动执行 `npm install` 和 `npm run build`，因此 `dist` 和 `node_modules` 不需要提交。

在 ZVC 环境中运行 `npm run test:e2e`，使用宿主提供的 `ZTOOLS_E2E_EXECUTABLE_PATH` 启动隔离的 ZTools 测试实例。测试包括生产包启动、preload 搜索、选集、本地 MP4 与普通 HLS 播放、独立播放窗口的双击全屏、全屏下自动连播且不退出全屏、关闭连播开关，以及播放记录页的入口、封面、续播、删除，还有分片返回网页时的错误提示。要同时验证实际站点的 MP4 和带 PNG 前缀的 HLS，运行：

```sh
ZTOOLS_VIDEO_LIVE=1 npm run test:e2e
```
