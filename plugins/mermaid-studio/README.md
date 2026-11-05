# Mermaid 图表工作室（ZTools 插件）

在 ZTools 里编辑、实时预览 Mermaid 图表，并导出为 PNG / SVG / PDF。

## 功能

- 行号编辑器：Tab / Shift+Tab 缩进、Enter 自动继承缩进、`Ctrl+S` 快速导出 PNG
- 实时预览：输入后 280ms 防抖渲染，过期结果自动丢弃
- 12 个内置模板：流程图、时序图、类图、状态图、ER 图、甘特图、饼图、思维导图、时间线、Git 图、象限图、C4 架构
- 4 种主题：浅色 / 深色 / 森林 / 中性
- 3 种布局：并排 / 仅编辑 / 仅预览，分栏可拖拽
- 预览缩放：`Ctrl+滚轮` 缩放，双击复位
- 导出：PNG（1x–4x）、SVG（保留矢量）、PDF（A4/A3/Letter/自适应纸张、可调页边距）
- 导出默认写入系统下载目录，勾选“选择位置”后弹出保存对话框

## 目录结构

```
src-ztools/                 # 可直接安装的插件目录
├── plugin.json             # 插件清单
├── logo.png / logo.svg     # 插件图标（含 SVG 源文件）
├── preload/
│   ├── services.js         # CommonJS 桥接：写文件 + 配置持久化
│   └── package.json        # { "type": "commonjs" }
└── page/index.html        # 构建产物（单文件内联）
```

> 构建输出目录不能命名为 `dist` 或 `build`：`ztools publish` 复制文件时会跳过这些名称的任意层级目录，
> 而本插件的页面就是构建产物，必须随插件一起发布。

## 开发

```bash
npm install
npm run dev      # 开发服务器 http://localhost:5173
npm run build    # 构建到 src-ztools/page
npm run test:e2e # 真实 Electron E2E
```

ZTools 中通过 `plugin.json` 的 `development.main` 使用开发服务器；生产环境使用 `main: page/index.html`。

## 关键实现说明

### 为什么构建成单文件

ZTools 通过 `file://` 加载插件页面，多文件 ESM 分块会被 CORS 策略拦截
（`Access to script at 'file:///...' from origin 'null' has been blocked by CORS policy`）。
因此构建时用 `vite-plugin-singlefile` + `inlineDynamicImports` 把 JS/CSS 全部内联进
`index.html`，保证离线可用且不受模块加载限制。

### 为什么导出前要替换 foreignObject

Mermaid 用 `<foreignObject>` 承载 HTML 标签，跨进 canvas 会污染画布并抛出
`Tainted canvases may not be exported`。`src/lib/mermaid-export.ts` 在导出副本中把
`foreignObject` 转成原生 `<text>`：

- `foreignObject` 无 `x`/`y` 时，位置由祖先 `translate` 决定，Mermaid 以标签盒宽度为居中基准，
  等价于 `x = width / 2`；
- 有 `x`/`y` 的标签（如连线标签）沿用原坐标；
- 颜色、字号、对齐必须写成内联 `style`，否则会被 Mermaid 样式表覆盖；
- 导出副本保留根 `id`，因为 Mermaid 的样式选择器为 `#id .xxx`。

### 安全边界

`preload/services.js` 只暴露三个方法：

- `saveFile({ format, base64, fileName, saveAs })`
- `readSettings()`
- `writeSettings(patch)`

格式限定 png/svg/pdf，写入体积上限 64MB，文件名会过滤路径分隔符与非法字符，
不向页面暴露 `fs`、`child_process` 或任意请求能力。
