# ztools-f-provider

<div align="center">

<img src="./public/logo.png" alt="Logo" width="120">

**一个 ZTools 提供商插件，把离线 OCR 与多家翻译封装为可复用的「OCR / 翻译提供商」**

_微信 OCR 离线识别 · LaTeX 公式识别 · 百度 / 谷歌 / 有道 / 微软翻译 · 代码命名翻译_

[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)](#-平台与限制)
[![ZTools](https://img.shields.io/badge/ZTools-插件-orange)](https://github.com/ZToolsCenter/ZTools)

</div>

---

## ✨ 特性

- 🔍 **离线 OCR** - 调用微信 OCR 引擎（Windows 子进程 / macOS 动态库），离线识别图片文字，带坐标逐行结果。运行时文件随插件下载
- 📐 **公式识别** - 基于 onnxruntime-node + pix2tex ONNX 模型，离线把图片中的数学公式识别为 LaTeX（Mac/Win 双端）
- 🌐 **多家翻译** - 百度 / 谷歌 / 有道 / 微软四种翻译提供商，统一接口、可设默认、凭据隔离
- 🧩 **Provider 抽象** - 以「提供商」形式注册进 ZTools，主程序与任意插件均可复用
- ⌨️ **代码翻译** - 把中文（或任意文本）翻译为英文，并生成 8 种代码命名风格候选，纯键盘操作
- 📸 **截图识别** - 进入即自动截屏框选区域，识别出文字并可视化悬浮在原图上，可点选复制
- 🖼️ **图片识别** - 拖入 / 选择图片即识别，文字模式用 canvas 绘图 + 透明文字层，公式模式用 KaTeX 渲染；支持全屏缩放拖动
- 🔁 **自动翻译** - 原文变化 1s 自动重译，支持语言互换、自动推断目标语言
- 📜 **历史记录** - OCR / 翻译结果按条目落盘到 `ztools.dbStorage`，管理页「历史记录」tab 可回看复制
- 🔒 **凭据安全** - 敏感凭据按插件命名空间隔离存入 `ztools.dbStorage`
- 🌍 **跨平台** - 翻译全平台可用；微信 OCR 与 LaTeX 公式识别覆盖 Windows + macOS（Linux 仅翻译）

## 📸 预览

<div align="center">
  <table>
    <tr>
      <td colspan="2" align="center">
        <img src="https://raw.githubusercontent.com/kaineooo/f-provider/main/.github/assets/screenshot-ocr.gif" alt="截图识别演示" width="100%">
        <p><i>截图识别 - 进入即截屏 → OCR → 文字悬浮可复制</i></p>
      </td>
    </tr>
    <tr>
      <td colspan="2" align="center">
        <img src="https://raw.githubusercontent.com/kaineooo/f-provider/main/.github/assets/img-translate.gif" alt="图片识别与翻译演示" width="100%">
        <p><i>图片识别与翻译 - 拖图识别 + 多提供商对比</i></p>
      </td>
    </tr>
    <tr>
      <td colspan="2" align="center">
        <img src="https://raw.githubusercontent.com/kaineooo/f-provider/main/.github/assets/code-translate.gif" alt="代码翻译演示" width="100%">
        <p><i>代码翻译 - 中文 → 英文 → 8 种命名风格，↑↓ 切换、回车粘贴</i></p>
      </td>
    </tr>
  </table>
</div>

## 🚀 快速开始

> `npm install` 只安装前端依赖；native 的依赖在 `build:native` 时自动安装。OCR 专有运行时（`wco_data` / `wechat-ocr-mac`）与 LaTeX 模型分别在 build 时从 NuGet / GitHub Release 拉取，**不**读取本机已装的微信，也不会随仓库分发。

### 安装依赖

```bash
npm install        # 仅装前端依赖；native 的依赖会在 build 时自动安装
```

### 构建

```bash
npm run build      # 前端打包：vue-tsc + vite build，产物在 dist/
npm run build:native  # 编译 native 模块（wechat_ocr.node，Win/Mac 分别在对应 CI 上构建）
npm run fetch:latex  # 拉取 LaTeX OCR 模型到 dist/latex/models/
```

native 与 LaTeX 引擎的 per-platform zip 由 GitHub Actions 在打 `v*` tag 时自动构建并发布到 Release（`native-win.zip` / `native-mac.zip` / `latex-ort-{win,mac}.zip` / `latex-models.zip`）。插件首次使用时由前端下载这些 Release 资产到 `<userData>/f-provider`，不走本机微信。

### 使用

1. 安装插件后，OCR / LaTeX 引擎会在首次调用时提示下载对应平台的 Release 资产（Windows / macOS）
2. 在「设置 → 提供商」中启用 / 设为默认 OCR 与翻译提供商
3. 主搜索框输入 `ZTools 提供商` 进入管理页，配置翻译凭据

## 🔌 作为 Provider 接入

本插件在 `plugin.json` 声明了 6 个 provider：2 个 `ocr` 类型（`ocr` = 微信 OCR、`latex-ocr` = 公式识别）与 4 个 `translation` 类型（`baidu` / `google` / `youdao` / `microsoft`），并在 preload 中调用 `ztools.registerProvider(<key>, handler)` 注册实现。

- 安装后，「设置 → 提供商」的「OCR」「翻译」tab 会分别列出这些 provider，可启用 / 设为默认
- 任何插件都可通过消费方 API 复用：

```js
// 便捷封装（走默认 OCR 提供商）
const { text, blocks, confidence } = await ztools.ocr('/path/to/image.png')

// 便捷封装（走默认翻译提供商）
const { text, detectedFrom } = await ztools.translate('hello', { from: 'en', to: 'zh-CN' })

// 或显式指定某个 provider（key 即 plugin.json 的声明 key）
await ztools.providers.invokeProvider('baidu', { text: 'hello', from: 'en', to: 'zh-CN' })
```

**OCR 契约**：输入 `{ image, lang? }`（`image` 为本地路径 / `data:` URI / `http(s)` URL），输出 `{ text, blocks?, confidence? }`。微信 OCR 返回逐行 `blocks`；`latex-ocr` 把整段公式作为单元素 `blocks` 返回，`text` 为 LaTeX 源码。

**翻译契约**（对齐宿主 `TranslationInput/Output`）：输入 `{ text, from?, to? }`（`from`/`to` 为语言码字符串，缺省视为自动检测 / 默认目标），输出 `{ text, detectedFrom? }`。语言码使用中性字符串：`auto` / `zh-CN` / `zh-TW` / `yue` / `en` / `ja` / `ko` / `fr` / `es` / `ru` / `de` / `it` / `tr` / `pt-PT` / `pt-BR` / `vi` / `id` / `th` / `ms` / `ar` / `hi` / `mn-Cyrl` / `mn-Mong` / `km` / `nb` / `nn` / `fa` / `sv` / `pl` / `nl` / `uk` / `uz`，各 provider 内部再映射到自家 API 的语种代码。

### 翻译凭据配置

| Provider | 是否需要凭据 | 说明 |
| --- | --- | --- |
| 百度 | ✅ | AppID / AppKey |
| 有道 | ✅ | AppKey / AppSecret |
| 微软 | ✅ | 鉴权方案（Edge Token 或 Signature） |
| 谷歌 | ❌ | 官方 `translate.googleapis.com` 端点（`client=gtx`），无需凭据；国内需走系统代理 |

凭据在「ZTools 提供商管理」入口（feature `code: manage`）侧边栏的「设置」子页填写并保存。敏感字段统一存入 `ztools.dbStorage`（按插件命名空间隔离），键名 `translate.<provider>`。

## 🧩 功能详解

本插件提供**五个 feature**：

### `code: manage` — 管理页

通过不同类型 cmd 承载多种入口，全部进入同一管理页，根据进入方式自动切到对应 tab：

- **关键词进入**（`text` 型 cmd `ZTools 提供商`）：可被搜索（支持拼音），默认打开「设置」tab
- **图片进入**（`img` / `files` 匹配型 cmd `识别图片文字`）：拖入或选择图片文件后，自动切到「OCR 识别」tab 的**文字**模式，展示原图预览并用该图片跑微信 OCR，展示带坐标的逐行结果
- **文本翻译进入**（`over` 型 cmd `翻译`，`minLength: 1`）：在主搜索框输入任意文本即可命中，进入后自动切到「翻译」tab，预填该文本并触发一次翻译

管理页底部悬浮导航（无分组，平铺）：

- **设置** - 微信 OCR 引擎 + LaTeX 引擎 + 翻译服务卡片网格（凭据 / 鉴权方案 / 引擎下载）
- **OCR 识别** - 同一页顶部切「文字 / 公式」两种模式，保留同一张图片与各自结果互不干扰
  - 文字模式：选图 / 拖拽 / 粘贴识别，画布绘制原图 + 透明文字层可点选复制；超级面板选图会先转 data URI 展示原图
  - 公式模式：`<img>` 预览原图 + 右侧 KaTeX 渲染 + LaTeX 源码 + 三种复制形式（源码 / 渲染文本 / 图片）
- **翻译** - 单 provider 实用翻译器，原文/译文左右结构、原文可编辑、顶部「自动翻译」开关——开启后原文变化 1s 自动重译，支持语言互换、自动推断目标语言
- **历史记录** - OCR 与翻译的结果条目按时间倒序列出，点击复用 / 复制；落盘到 `ztools.dbStorage`，切 tab 保留

> 引擎未就绪时，「OCR 识别」页会渲染下载卡片（可下载自救），下载就绪后自动补一次当前模式的识别；翻译相关子页全平台可用。

### `code: code-translate` — 代码翻译

把选中的中文文本（或任意文本）翻译为英文，再按多种代码命名风格生成候选列表，纯键盘操作：

- **进入**（`over` 型 cmd `代码翻译`，`minLength: 1`）：主搜索框输入任意文本即可命中
- **流程** - 含中文的文本经 translation provider（默认 microsoft → google → baidu → youdao 降级）翻译到英文（`auto` → `en`）；纯 ASCII 文本跳过翻译直接转换
- **候选风格（8 种）** - camelCase、PascalCase、snake_case、CONSTANT_CASE、kebab-case、camel_Snake（混合下划线+驼峰）、Pascal_Snake、flatcase（全小写无分隔）、UPPERFLAT（全大写无分隔）
- **键盘** - `↑` / `↓`（或 `Tab` / `Shift+Tab`）环形切换候选、`Enter` 确认、`Esc` 取消；也支持鼠标 hover/click
- **确认动作** - `Enter` 调 `ztools.hideMainWindowPasteText` 把结果粘贴回原光标位置并退出；粘贴失败时回退到复制 + Toast 提示
- **兜底** - provider 翻译失败时用原文做风格转换，保证候选列表非空

### `code: screen-ocr` — 截图识别文字

进入即自动调起系统截屏，框选区域后自动跑微信 OCR，结果留在主窗口内「OCR 识别」页展示（不再弹独立窗口）：

- **进入**（`text` 型 cmd `截图识别文字`）：可被搜索（支持拼音）。平台 `["win32", "darwin"]`
- **流程** - 进入即自动触发 `ztools.screenCapture` → 用户框选屏幕区域 → 截图回调返回 base64 → 自动调 `ocrImageDetail` 识别 → canvas 绘制截图 + 透明文字层（按坐标悬浮，鼠标 hover 预览 / 点击复制）+ 结果列表双向高亮。顶部「重新截图」可反复截
- **可视化**（复用 `OcrImageViewer`）- 图上文字鼠标悬浮弹出预览、点击复制；右下角「⛶」全屏预览，支持滚轮缩放（以鼠标为锚点）、拖动、按钮缩放/复位
- **取消** - 截屏时按 `Esc` 取消（不报错，回到待截图态）；非截屏态按 `Esc` 退出插件
- **复制** - 点击单行复制该行；「复制全部」复制全部识别文字
- **引擎未就绪** - 渲染 native 引擎下载卡片（允许下载自救），下载就绪后自动补一次截屏

### `code: latex-recognize` — 公式识别

把图片中的数学公式离线识别为 LaTeX，基于 onnxruntime-node + pix2tex ONNX 导出模型：

- **进入**：
  - `text` 型 cmd `公式识别`：可被搜索（支持拼音），进入「OCR 识别」tab 的**公式**模式
  - `img` / `files` 型 cmd `识别图片公式`：拖入或选择图片后自动切到公式模式并识别
- **流程** - `latexOcr.recognize(imagePath)` 返回 `{ latex }`；右侧用 KaTeX 渲染预览 + 源码 + 三种复制形式
- **引擎未就绪** - 渲染 LaTeX 引擎下载卡片（`latex-ort-{win,mac}.zip` + `latex-models.zip`），支持镜像竞速、加速点选择与取消；下载就绪后自动补识别当前图片

### `code: screen-latex` — 截图识别公式

进入即自动截屏，框选区域后跑 LaTeX 公式识别，结果留在主窗口内「OCR 识别」页的公式模式展示：

- **进入**（`text` 型 cmd `截图识别公式`）：可被搜索（支持拼音）。平台 `["win32", "darwin"]`
- 流程与「截图识别文字」对齐，把 `ocrImageDetail` 换成 `latexOcr.recognize`，可视化层用 `<img>` + KaTeX 预览（不使用 canvas 文字层）
- 引擎未就绪时同样走 LaTeX 下载卡片，下载就绪后自动补一次截屏

> 💡 **关于 cmd 类型**：`text` 型 cmd（label 即搜索关键字）是唯一能进入 ZTools 主搜索列表的 cmd 类型；`img`/`files`/`over`/`window` 仅在对应场景匹配时出现。因此若需要让插件「能被搜到且能打开」，至少要有一个 feature 携带 `text` 型 cmd。

## 🛠️ 技术栈

- **框架**: Vue 3 + TypeScript + Vite
- **UI**: ztools-ui（与宿主一致的组件库）
- **Provider 注册**: ZTools `ztools.registerProvider` API
- **原生模块**: C++ (Node-API / node-addon-api)
  - 微信 OCR 运行时（mmmojo IPC 桥接，Windows 走 `WeChatOCR.exe` 子进程，macOS 直接加载打包的 `libwxocr.dylib`）
  - 手写 protobuf 编解码
  - 任务队列 + 回调
- **LaTeX 公式识别**: onnxruntime-node + pix2tex ONNX 导出模型（RapidAI/RapidLaTeXOCR），跨平台
- **翻译**: 移植自 [STranslate](https://github.com/ZGGSONG/STranslate) 的纯 Node.js 实现

## 📁 项目结构

```
f-provider/
├── native/                      # 原生模块工程（wechat_ocr.node）
│   ├── binding.gyp              # node-gyp 构建配置
│   ├── package.json             # node-addon-api 依赖
│   ├── index.js                 # .node 加载入口（require）
│   ├── scripts/
│   │   ├── fetch-wco-data.cjs   #   build 时从 NuGet 拉取 Windows 微信 OCR 运行时（wco_data/）
│   │   ├── fetch-mac-vendor.cjs #   build 时从 npm 包拉取 macOS 微信 OCR 运行时（wechat-ocr-mac/）
│   │   └── fetch-latex-models.cjs#   build 时从 GitHub Release 拉取 LaTeX 公式识别模型
│   ├── src/                     # C++ 源
│   │   ├── addon.cc             #   N-API 绑定（init/ocr/dispose）
│   │   ├── mmmojo.{h,cc}        #   IPC 桥接库动态加载封装
│   │   ├── ocr_manager.{h,cc}   #   任务队列 + 回调
│   │   ├── pb.{h,cc}            #   手写 protobuf 编解码
│   │   └── ocr_protobuf.proto   #   消息定义（文档用）
│   ├── wco_data/                # Windows OCR 运行时（git-ignored，build 时自动获取）
│   └── wechat-ocr-mac/          # macOS OCR 运行时（git-ignored，build 时自动获取）
├── public/
│   ├── plugin.json              # 声明 providers.{ocr,latex-ocr,baidu,google,youdao,microsoft} + 五个 feature
│   ├── preload/services.js      # registerProvider(...) + 归一化输入 + 引擎下载/校验
│   └── logo.png
├── src/                         # Vue 前端（交互式 feature，全部基于 ztools-ui）
│   ├── App.vue                  #   按 action.code 分流
│   ├── main.ts                  #   注册 ztools-ui + 同步宿主主题
│   ├── components/              #   SettingLayout / EngineStatusCard / OcrImageViewer / HistoryView / ProviderLogo / GlobalFeedback
│   ├── composables/             #   useNativeEngine / useLatexEngine / useCaseConvert / useHistory / useSegmentIndicator
│   ├── views/                   #   Settings / Recognize（文字+公式合并）/ Translate / CodeTranslate
│   └── Manage/index.vue         #   manage feature 容器（底部悬浮导航）
├── scripts/
│   ├── copy-native.mjs          # 构建后把 native 资源拷进 dist/ 并打 per-platform zip
│   └── copy-latex.mjs           # 构建后把 LaTeX 引擎拷进 dist/ 并打 zip
└── package.json
```

## 📋 平台与限制

| 功能 | Windows | macOS | Linux |
| --- | :---: | :---: | :---: |
| 微信 OCR（文字识别） | ✅ | ✅ | ❌ |
| 截图识别文字 | ✅ | ✅ | ❌ |
| LaTeX 公式识别 | ✅ | ✅ | ❌ |
| 截图识别公式 | ✅ | ✅ | ❌ |
| 翻译（百度/谷歌/有道/微软） | ✅ | ✅ | ✅ |
| 历史记录 / 设置 / 代码翻译 | ✅ | ✅ | ✅ |

- **微信 OCR** 覆盖 Windows x64 与 macOS（Apple Silicon 原生编译的 `.node`，`libwxocr.dylib` 为 universal）。运行时文件随插件 GitHub Release 下载，**不读取本机已装的微信**。`screen-ocr` / `screen-latex` feature 用 `platform: ["win32", "darwin"]` 标注；`manage` feature 不限制平台，Linux 下可打开但「OCR 识别」页会显示引擎未就绪
- **LaTeX 公式识别** 基于 onnxruntime-node，Win/Mac 各有 per-platform 的 ORT 二进制 + 共享模型 zip，同样走 Release 资产下载
- **翻译** provider 为纯 Node.js 实现，跨平台无原生依赖；谷歌走 `translate.googleapis.com` 官方端点，国内需系统代理
- 微信 OCR 首次调用时拉起引擎（Windows 子进程 / macOS 动态库），长时间不再使用时 preload 会按需 `dispose` 释放

## 🐛 问题反馈

遇到问题？请在 [Issues](https://github.com/Particaly/ztools-f-provider/issues) 中反馈。

提交 Issue 时请包含：

- 操作系统版本
- 插件版本
- 复现步骤
- 错误日志（如有）

## 💝 致谢

- [STranslate](https://github.com/ZGGSONG/STranslate) - 翻译实现移植来源 & 微信 OCR 运行时获取方式参考
- [RapidAI/RapidLaTeXOCR](https://github.com/RapidAI/RapidLaTeXOCR) - LaTeX 公式识别 ONNX 模型来源
- [LaTeX-OCR](https://github.com/lukas-blecher/LaTeX-OCR) - pix2tex 模型本体（MIT）
- [ZTools](https://github.com/ZToolsCenter/ZTools) - Provider 抽象与契约
- [Vue.js](https://vuejs.org/) - 渐进式 JavaScript 框架
- [Vite](https://vite.dev/) - 下一代前端构建工具

## 📄 许可证

代码部分采用 [MIT License](./LICENSE) 许可证。

---

<div align="center">

**如果这个插件对你有帮助，请给个 Star ⭐️**

</div>
