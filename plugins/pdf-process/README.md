# PDF Process

> ZTools PDF 处理插件 — 压缩、合并、拆分、水印、图片提取、格式转换

使用 **React + Vite + TypeScript** 构建的 ZTools 插件，preload 依赖安装与产物校验已接入 npm 脚本，可直接进入 ZTools 中心仓库的 PR 构建流程。

## 功能

| 功能 | 说明 |
|------|------|
| **基本压缩** | `pdf-lib` 重写 PDF 对象流，结果不小于原文件时保留原文件 |
| **强压缩** | 浏览器 pdf.js + DOM canvas 按 72–150 DPI 栅格化为 JPEG 后合成 PDF；低质量自动灰度 |
| **合并** | 多 PDF 按序合并 |
| **拆分 / 提取** | 提取指定页、剪刀切点、每隔 N 页拆分 |
| **水印** | 纯 JS `pdf-lib + fontkit` 文字水印 |
| **转图片** | 浏览器端 pdf.js 渲染导出 PNG/JPG |
| **转 Word / PPT / Excel** | 文本型本地转换；扫描型由渲染器生成页面图后写 DOCX/PPTX，Excel 保留残余文本 |

## 快速开始

```bash
npm install
npm run dev
```

`postinstall` / `prebuild` 会自动按锁文件安装 `public/preload` 依赖，无需手动进入子目录。

### 构建

```bash
npm run build
```

构建后 `dist/` 即为 ZTools 打包源，构建脚本会：

- 用 esbuild 合并 preload 业务代码；
- 只复制 PDF.js 运行资源，不携带任何 EXE / 原生 Canvas 模块；
- 校验 `plugin.json`、版本、入口和平台；
- 按中心仓库 `archiver(level 9)` 同款算法生成临时 ZIP，并生成 ASAR 做 15 MB 双重门禁。

### 测试与 PR 自检

```bash
npm run ci
```

等价于中心 PR 流程的测试与构建：前端测试 + preload 测试 + 生产构建 + 15 MB 包体积校验。

## 项目结构

```
.
├── public/
│   ├── logo.png                 # 插件图标
│   ├── plugin.json
│   └── preload/
│       ├── services.js          # window.services 门面
│       ├── path-guard.js        # 路径 / https 白名单
│       ├── lib/                 # 深模块实现
│       │   ├── pdf-operations.js
│       │   ├── create-pdf-from-images.js
│       │   ├── settings-store.js
│       │   ├── task-paths.js
│       │   └── watermark-layout.js
│       └── convert/             # 本地 PDF→Office
├── scripts/
│   ├── install-preload-deps.cjs # 幂等安装 preload 依赖
│   └── optimize-package.cjs     # 产物精简 + ZIP/ASAR 体积门禁
├── src/
│   ├── Compress/ Split/ Merge/ Watermark/ …
│   ├── components/PdfConvertPage.tsx   # Word/PPT/Excel 共用
│   └── utils/                   # strongCompress、splitPlan、pickFiles、safeUrl
├── package.json
└── README.md
```
