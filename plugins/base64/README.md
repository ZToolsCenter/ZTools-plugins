# Base64 编解码 · ZTools 插件

纯 HTML/CSS/JavaScript 插件，无运行时第三方依赖、无需构建、无需联网。

## 下载与截图

从 [GitHub Releases](https://github.com/fuyanghulin/base64-ztools/releases/latest) 下载 `.zpx` 安装包，导入 ZTools 即可使用。`.zip` 提供完整插件文件。

![文本编码](https://raw.githubusercontent.com/fuyanghulin/base64-ztools/main/docs/screenshots/text-encode.png)

![图片解码与保存](https://raw.githubusercontent.com/fuyanghulin/base64-ztools/main/docs/screenshots/image-decode.png)

## 使用

在 ZTools 的本地插件开发/导入入口选择本目录的 `plugin.json`。保持同目录中的 HTML、JS、CSS 和 logo.png 完整。搜索 `base64`、`base64编码` 或 `base64解码` 打开插件。

- **文本编码**：输入或粘贴文本，自动转换；支持中文、Emoji、多行和空白字符。
- **图片编码**：切换到「图片」，选择、拖入或粘贴图片。可切换纯 Base64 / 含 Data URL 前缀。
- **解码**：粘贴 Base64；文本直接显示，图片自动预览，点击「保存图片」选择保存位置。图片按原始字节保存，不重新压缩或转码。
- 支持 PNG、JPEG、GIF、WebP、BMP、ICO、AVIF、SVG 的内容识别；实际预览取决于宿主浏览器的格式支持与文件完整性。
- 支持标准 Base64、URL-safe、缺省末尾填充和含换行的内容。文本按 UTF-8 解码，非法文本或无法识别的二进制会显示错误。
- 输入后 250 ms 自动转换，也可以使用 `Ctrl / ⌘ + Enter`。编码和解码各自保留本次会话的输入；输入区底部的「清空内容」用于清空当前模式的内容和结果。
- 最大原始内容 20 MB；不上传内容，不记录历史。SVG 仅以图片元素预览，不注入页面。

也可以直接在浏览器打开 `index.html` 使用。浏览器环境的保存走下载功能，ZTools 环境使用原生保存对话框。

### 原生图片选择

ZTools 中的「选择图片」和「更换图片」改用 `ztools.showOpenDialog`。宿主会在对话框期间抑制失焦自动隐藏，解决 HTML 文件选择框导致整个 ZTools 窗口消失的问题。取消选图或读取失败时保留当前图片及结果；浏览器独立使用时仍采用 HTML 文件选择框。

## 开发与验证

```shell
npm ci
npm test
npm run test:ui
npm run package
npm run verify
```

`npm test` 验证编解码、格式识别、边界校验及 preload 保存字节/取消/错误处理。`npm run test:ui` 默认通过本机 Microsoft Edge 运行 Playwright，检查真实页面交互、下载文件、图片预览、窄窗口和深色样式。可设置 `BROWSER_CHANNEL=chrome` 使用 Chrome。

`npm run package` 自动整理最新插件文件到 `dist/base64/`，再生成安装包，无需先执行 build，也无需到 ZTools 界面手动打包。打包脚本参考同级 `json-formatter-ztools`，ZPX 使用 ASAR + Brotli（压缩级别 5），并额外输出 ZIP 文件包。

生成文件位于 `release/`，文件名自动读取 `plugin.json` 的 `name` 和 `version`。当前为：

- `release/base64-1.0.0.zpx`：ZTools 安装包。
- `release/base64-1.0.0.zip`：插件文件压缩包。

`npm run verify` 解压检查两种包的文件清单、入口及配置，并逐字节核对包内文件与当前源码是否一致。需要重新打包时再次运行 `npm run package` 即可；其他版本的发布文件会保留。只想生成插件目录时使用 `npm run build`。

打包依赖仅供开发使用（Node.js >= 22.12.0），不会装进插件包。无需携带 node_modules 或测试文件，命令不会发布到插件市场。

文件分工：`codec.js` 为共享编解码与图片识别逻辑；`app.js` 为交互；`preload.js` 调用 ZTools 保存对话框并写入文件；`plugin.json` 注册功能命令。preload 保留可读 CommonJS 源码。

## 开发依据

- [快速开始](https://ohmyztools.cc/getting-started.html)
- [插件配置](https://ohmyztools.cc/plugin-json.html)
- [preload 规范](https://ohmyztools.cc/preload-js.html)
- [插件 API：进入事件、复制、保存对话框](https://ohmyztools.cc/plugin-api.html)

自动测试中的 ZTools API 使用替身验证契约。v1.0.0 已通过逻辑与浏览器交互测试；作者已在真实 ZTools 中确认打开插件、文本编解码、选择图片和保存图片正常。
