# OCR 翻译

识别图片中的文字，并把识别结果跳转到 ZTools 中的翻译指令。

这是一个使用 **Vue 3 + Vite + TypeScript** 构建的 ZTools 插件。

## 功能特性

### OCR 翻译

- 触发指令：`OCR` / `文字识别` / `图片翻译`
- 触发指令：`OCR 文字识别+复制` / `OCR 文字识别+翻译`
- 触发指令：`截图文字识别` / `截图文字识别+复制` / `截图文字识别+翻译`
- 匹配指令：图片 → `OCR 文字识别` / `文字识别+复制` / `文字识别+翻译`，图片文件 → `识别图片文字`
- 可在 `OCR 设置` 中固定单个引擎，也可以选择“按优先级”并配置 1-4 顺位
- 固定单个云端引擎时，失败会直接报错；按优先级模式会按顺位尝试下一个引擎
- 按优先级模式会跳过未配置密钥的百度、腾讯和 OpenAI-compatible，避免无意义等待
- 云端请求支持 5-180 秒超时设置，避免长时间卡在某个供应商
- 如果接口返回 `unknown variant image_url`，说明当前 endpoint 或模型不支持图片输入，需要换视觉模型
- 可在 `OCR 设置` 中切换为 OCR.Space；留空 API Key 会使用 OCR.Space 测试 key
- 可在 `OCR 设置` 中配置百度 OCR、腾讯云 OCR 密钥，适配常见国内免费试用额度
- 可在 `OCR 设置` 中配置 OpenAI-compatible 视觉接口，适配云端供应商或自建 DeepSeek-OCR/vLLM 服务
- 可在设置页一键安装/启动本地 RapidOCR 服务，并选择 `本地 RapidOCR/PaddleOCR`
- 本地 OCR 默认识别中文和英文，图片会先进行放大、灰度和对比度增强后再识别
- 默认开启文本清理，会修正 `ZTools Al`、`OpenAl`、行首 `。` 误作项目符号等常见误识别；可在设置中关闭
- 普通 `OCR` 入口只展示识别结果，只有 `+复制`、`+翻译` 命令或按钮会继续执行复制/跳转
- 翻译流程会复制识别结果，并通过 `window.ztools.redirect()` 跳转到翻译指令
- 翻译目标默认是 `翻译`，旧的 `翻译文本` 设置会自动迁移为 `翻译`
- 翻译目标也可以改成 `插件标题/指令名`，例如 `翻译插件/翻译`
- OCR 引擎使用 `tesseract.js`，首次识别会加载 OCR 资源和语言数据

## 项目结构

```
.
├── public/
│   ├── logo.png              # 插件图标
│   ├── local-ocr-server/     # 打包进插件的一键安装服务脚本
│   ├── plugin.json           # 插件配置文件
│   └── preload/              # Preload 脚本目录
│       ├── package.json      # Preload 依赖配置
│       └── services.js       # Node.js 能力扩展
├── src/
│   ├── main.ts               # 入口文件
│   ├── main.css              # 全局样式
│   ├── App.vue               # 根组件
│   ├── env.d.ts              # 类型声明
│   └── Ocr/                  # OCR 功能组件
│       └── index.vue
├── index.html                # HTML 模板
├── vite.config.js            # Vite 配置
├── tsconfig.json             # TypeScript 配置
├── package.json              # 项目依赖
└── README.md                 # 项目文档
```

## 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

开发服务器将在 `http://localhost:5173` 启动。ZTools 会自动加载开发版本。

### 构建生产版本

```bash
npm run build
```

构建产物将输出到 `dist/` 目录。

## 工作方式

图片通过 ZTools 的 `img` / `files` 匹配指令进入插件，文件路径会在 `public/preload/services.js` 中读取为 Data URL，再交给渲染进程中的 `tesseract.js` 识别。插件也支持 `screenCapture()` 截图和 Electron 剪贴板图片读取。

识别完成后，插件会调用：

```ts
window.ztools.copyText(text)
window.ztools.redirect(target, text)
```

`target` 可以是单个指令名，例如 `翻译`；也可以是 `插件标题/指令名`，用于精准跳转到指定插件。

## 云端 OCR 配置

- ZTools AI：在 ZTools 的 AI 模型设置中添加支持图片的模型，然后在插件设置页选择 `ZTools AI`。
- OCR.Space：到 `ocr.space/ocrapi` 注册免费 API Key；插件设置页里提供了可点击链接，留空会使用测试 Key，仅适合临时验证。
- 百度 OCR：在百度智能云开通 OCR，填写 API Key 和 Secret Key。
- 腾讯云 OCR：在腾讯云开通 OCR，填写 SecretId、SecretKey 和地域。
- OpenAI-compatible：选择支持视觉输入的供应商，填 `Base URL`、模型名和 API Key。
- DeepSeek-OCR：这是 MIT 开源模型，不是官方免费云 API；自建 vLLM/OpenAI-compatible 服务后，把 endpoint 设为类似 `http://127.0.0.1:8000/v1`，模型名设为 `deepseek-ai/DeepSeek-OCR`。

## 本地 RapidOCR/PaddleOCR

项目内提供了一个轻量本地服务，源码路径为 [local-ocr-server](local-ocr-server)。当前 Windows 构建已把 RapidOCR 运行时打进插件，产物位于 `local-ocr-runtime/win32/`，会随 `dist/` 一起复制到 ZTools 插件目录。安装后可在设置页直接点击 `启动服务` 和 `停止服务`。

本地服务默认常驻后台，不会随插件窗口关闭自动退出；这是为了避免每次识别都重新加载模型。也可以在设置页把 `服务策略` 改为 `退出插件时自动停止`。需要手动关闭时，点击 `停止服务`。

如果插件已经包含内置 RapidOCR 运行时，用户电脑不需要 Python；设置页会显示 `运行时已内置`。没有内置运行时时，设置页会提示先安装 Python 3，并提供 `一键安装` 作为开发/备用路径。没有 Python 时仍可使用 OCR.Space、百度 OCR、腾讯云 OCR、ZTools AI 或 OpenAI-compatible 视觉接口。

```powershell
cd local-ocr-server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python server.py
```

默认 Endpoint 是 `http://127.0.0.1:8765/ocr`。

## 构建与发布

### 1. 构建插件

```bash
npm run build
```

Windows 下如需同时打包内置 RapidOCR 运行时：

```powershell
npm run build:with-runtime
```

当前 Windows runtime 约 265 MB，包含 `rapidocr-server.exe`、ONNX Runtime 和 PP-OCRv4 检测/分类/识别模型。首次启动不再需要下载模型。

### 2. 测试构建产物

将 `dist/` 目录中的所有文件复制到 ZTools 插件目录进行测试。

## 相关资源

- [ZTools 官方仓库](https://github.com/ZToolsCenter/ZTools)
- [ZTools API 类型包](https://www.npmjs.com/package/@ztools-center/ztools-api-types)
- [Vue 3 文档](https://vuejs.org/)
- [Vite 文档](https://vitejs.dev/)
