# 科研小盒（micro-tools）

科研常用小工具集合的 ZTools 插件。**纯 Preload（无构建步骤）**，可直接被 ZTools 以 `file://` 加载。

## 目录结构

```
micro-tools/
├── plugin.json                              # 插件入口 + feature 触发配置
├── preload.js                               # CommonJS：读 xlsx，暴露 window.journalApi
├── index.html                               # 前端界面（多功能 SPA）
├── index.css                                # 样式
├── index.js                                 # 前端逻辑
├── 2026年度JCR期刊名单（完整版）.xlsx        # 期刊数据源（22,643 条，与插件一起发布）
├── vendor/xlsx.full.min.js                  # SheetJS 单文件发行版
├── logo.png                                 # 插件图标
└── README.md
```

## 功能一览

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| **期刊查询** | ✅ 可用 | 基于 JCR 2026 名单查询影响因子(JIF)、分区、JCI、被引等 |
| **数据库查询** | 🔧 体验版 | NCBI Genome / Gene / Nucleotide、PubMed、UniProt、PDB、Ensembl、Google Scholar 一键检索 |
| 文献速读 | 🚧 即将推出 | PDF 摘要提炼 |
| 单位换算 | 🚧 即将推出 | 科研常用单位 |

### 期刊查询

- 按 **期刊名 / JCR 缩写 / ISSN** 模糊检索（220ms 防抖），结果按 **JIF 高→低排序**。
- 卡片展示：**2025 JIF 徽标、JCR 分区 Q1–Q4 配色、JCI、总被引、金色 OA%、各学科分区详情、出版商、学科、ISSN**。
- 「复制信息」经 `ztools.copyText()` + `showNotification()`。

### 数据库查询

- 输入检索词 → 选择数据库卡片 → 在系统浏览器中打开对应检索结果页（通过 `ztools.shellOpenExternal` 或回退到 `window.open`）。
- 支持数据库：NCBI Genome / NCBI Gene / NCBI Nucleotide / PubMed / UniProt / PDB / Ensembl / Google Scholar。

## 为什么是“纯 Preload”格式

- `preload.js` 用 Node `fs` 读同目录 xlsx，经 SheetJS 解析后暴露给前端；前端只渲染 UI。
- 不依赖 Vite/Webpack 等构建工具，所有资源用相对路径引用（`index.css`/`index.js`/`logo.png`），因此 ZTools 用 `file://` 加载 `index.html` 时所有资源正常解析。
- 这规避了 Vite 构建产物用绝对 `/assets/...` 路径在插件环境下加载失败的问题。

## 在 ZTools 中使用

1. ZTools → 插件管理 → 添加本地插件，选择 `micro-tools/` 目录。
2. 搜索框输入：
   - `科研小盒` / `kydh` — 打开工具箱首页
   - `期刊 Nature` / `影响因子 JACS` / `journal nat rev mol cell bio` — 直接进入期刊查询
   - `数据库 BRCA1` / `ncbi genome TP53` — 进入数据库查询并带入关键词
3. 或直接打开插件，从首页点卡片进入各功能。

## 数据源

- 影响因子来自 `2026年度JCR期刊名单（完整版）.xlsx`（2025 JIF / JCR 分区 / JCI 等 33 个字段，22,643 条记录）。
- 更新数据只需替换同目录下的 xlsx 文件，列名保持一致即可自动适配（见 preload.js 中 COLUMN_MAP）。

## 开发者

- **开发者**：Asa12138
- **邮箱**：bfzede@gmail.com

