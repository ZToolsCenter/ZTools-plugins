# 科研小盒（micro-tools）

科研常用小工具集合的 ZTools 插件。**纯 Preload（无构建步骤）**，可直接被 ZTools 以 `file://` 加载。

## 目录结构

```
micro-tools/
├── plugin.json              # 插件入口 + feature 触发配置
├── preload.js               # CommonJS：读两个数据集，合并后暴露 window.journalApi
├── index.html               # 前端界面（多功能 SPA）
├── index.css                # 样式
├── index.js                 # 前端逻辑
├── journals.json.gz         # JCR 2026 期刊数据（22,643 条，gzip -9）
├── ccf.json.gz              # CCF 第七版目录（677 条，gzip -9）
├── pack.sh                  # 打包为 .zpx（ASAR + brotli）
├── logo.png / logo.svg      # 插件图标
└── README.md
```

## 功能一览

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| **期刊 · 会议查询** | ✅ 可用 | 同一入口检索 JCR 2026 期刊与 CCF 第七版目录 |
| **数据库查询** | 🔧 体验版 | NCBI / PubMed / UniProt / PDB / Ensembl 等一键检索 |
| 文献速读 | 🚧 即将推出 | PDF 摘要提炼 |
| 单位换算 | 🚧 即将推出 | 科研常用单位 |

### 期刊 · 会议查询

一个入口同时检索两套体系，卡片上**有就显示、没有就不显示**：

| 数据 | 来源 | 卡片显示 |
| --- | --- | --- |
| 影响因子 / 分区 / JCI / 被引 | JCR 2026（22,643 条） | `IF 20.4`、`Q1`、四项统计 |
| CCF 等级 / 领域 / 变动 | CCF 第七版（677 条） | `CCF A`、`人工智能`、`晋级` |

- **三种情况都覆盖**：既有 IF 又有 CCF 等级（如 TPAMI：IF 20.4 + CCF A）；只有 CCF 等级（会议，如 CVPR；以及已被 JCR 除名的期刊，如 MTA）；只有 IF（非计算机领域期刊，如 Nature）。
- 检索字段：期刊/会议全称、JCR 缩写、**CCF 缩写**、ISSN、CCF 中文领域（可直接搜「人工智能」）。
- 顶部筛选条：**全部 / 期刊 / 会议**。
- 动作按钮：复制信息（纯文本多行）、JCR 官网、官方主页/DBLP。
- 相关性排序：精确 > 前缀 > 包含，同分按影响因子降序。

### 数据库查询

输入检索词 → 选择数据库 → 系统浏览器打开检索结果（`ztools.shellOpenExternal`）。
支持：NCBI Genome / Gene / Nucleotide、PubMed、UniProt、PDB、Ensembl、Google Scholar。

## 数据合并机制

`preload.js` 加载时把 CCF 目录按 ISSN 关联到 JCR 期刊：

- 关联成功（277/291 条 CCF 期刊，95.2%）→ CCF 字段挂到该 JCR 记录上，并把 CCF 缩写并入检索词表，**一张卡同时显示两套指标**。
- 未关联（386 条会议 + 14 条未被 JCR 收录的期刊）→ 作为独立记录并入统一检索数组，只显示 CCF 等级。

CCF 中跨领域重复收录的刊物（如 TOMM 同时挂「网络」和「图形学」）会合并为一条，领域显示为 `网络 · 图形学`。

## 数据源

- **JCR**：`2026年度JCR期刊名单（完整版）.xlsx` → 转换压缩为 `journals.json.gz`（短键名 + gzip -9，1.6 MB）。22,643 条，含 2025 JIF / 分区 / JCI 等字段。
- **CCF**：《中国计算机学会推荐国际学术会议和期刊目录》第七版（2026 年 3 月发布）→ `ccf.json.gz`（19.9 KB）。677 条 = 291 期刊 + 386 会议，分 A/B/C 三级、10 个领域方向。
- 两个数据集均为静态快照，更新时替换对应 `.gz` 文件即可（`pack.sh` 会自动打包）。

## 在 ZTools 中使用

1. 插件管理 → 添加本地插件，选择 `micro-tools/` 目录（或导入 `micro-tools-vX.Y.Z.zpx`）。
2. 搜索框输入：
   - `科研小盒` / `kyxh` — 打开工具箱首页
   - `期刊 Nature` / `影响因子 JACS` — 进入期刊·会议查询
   - `ccf CVPR` / `会议 NeurIPS` — 直接进入并切到「会议」筛选
   - `数据库 BRCA1` — 进入数据库查询
3. 划词后通过 `type: over` 触发「查询期刊/会议」，自动带入选中文本。

## 打包

```bash
bash pack.sh      # 产出 ../micro-tools-<version>.zpx（ASAR + brotli，自动排除 .git/.DS_Store）
```

## 开发者

- **开发者**：Asa12138
- **邮箱**：bfzede@gmail.com
