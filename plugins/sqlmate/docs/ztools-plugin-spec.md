# SQLMate ZTools 插件集成规范文档

> 基于 [ZTools 开发者文档](https://ztoolscenter.github.io/ZTools-doc/) 规范编写
> SQLMate 核心库版本: v1.0.0

---

## 概述

SQLMate 所有业务逻辑均实现于 `public/preload/lib/` 中，为 **CommonJS 纯函数模块，零副作用、无 DOM 依赖**，直接在 ZTools 的 `preload.js` 中 `require` 使用。

前端通过 `window.services.xxx()` 调用 Node.js 服务层，服务层自动根据文件大小路由到内存处理或流式处理路径。

---

## 插件目录结构

ZTools 插件只识别原始的 `html + css + js`，**preload 侧不能打包/压缩/混淆**。

```
sqlmate-plugin/
├── public/
│   ├── plugin.json              # 插件配置入口
│   ├── logo.png                 # 插件图标
│   ├── logo.svg                 # 图标源文件
│   └── preload/                 # Node.js 服务层（明文，不可混淆）
│       ├── services.js          # 统一 API 入口，自动路由大/小文件
│       └── lib/                 # 纯函数核心库
│           ├── merge.js
│           ├── split.js
│           ├── segment.js
│           ├── extract.js
│           ├── dedupe.js
│           ├── mask.js
│           ├── rename.js
│           ├── offset.js
│           ├── stats.js
│           ├── convert_stmt.js
│           ├── convert.js       # CSV/xlsx ↔ SQL 互转
│           ├── diff.js
│           ├── ddl_diff.js
│           └── stream/          # 大文件流式处理库（>10MB）
│               ├── common.js
│               ├── merge.js
│               ├── split.js
│               ├── segment.js
│               ├── extract.js
│               └── dedupe.js
├── src/                         # 前端源码（React + TypeScript）
├── dist/                        # 构建产物（发布插件时使用此目录）
└── index.html                   # 前端入口
```

> **关键规范**：`preload/` 下所有文件必须保持源码清晰可读，不可压缩/混淆。前端（`src/`）可使用 Vite 编译，产物输出到 `dist/`。

---

## plugin.json 配置

```json
{
  "name": "sqlmate",
  "title": "SQLMate",
  "description": "SQL 数据处理工具集 — 合并、拆分、去重、脱敏、DDL对比等，数据不离本地",
  "version": "1.0.0",
  "main": "index.html",
  "logo": "logo.png",
  "preload": "preload/services.js",
  "development": {
    "main": "http://localhost:5173"
  },
  "features": [
    { "code": "merge",     "cmds": ["SQL合并", "合并INSERT", "sqlmate merge"] },
    { "code": "split",     "cmds": ["SQL拆分", "拆分INSERT", "sqlmate split"] },
    { "code": "segment",   "cmds": ["SQL分割", "切割SQL", "sqlmate segment"] },
    { "code": "extract",   "cmds": ["SQL抽取", "按表抽取", "sqlmate extract"] },
    { "code": "dedupe",    "cmds": ["SQL去重", "INSERT去重", "sqlmate dedupe"] },
    { "code": "mask",      "cmds": ["SQL脱敏", "数据脱敏", "sqlmate mask"] },
    { "code": "rename",    "cmds": ["表名替换", "列名替换", "sqlmate rename"] },
    { "code": "offset",    "cmds": ["ID偏移", "主键偏移", "sqlmate offset"] },
    { "code": "stats",     "cmds": ["SQL统计", "表统计", "sqlmate stats"] },
    { "code": "convert",   "cmds": ["语句改写", "INSERT转UPDATE", "sqlmate convert"] },
    { "code": "sqltoCsv",  "cmds": ["SQL导出", "导出CSV", "导出Excel", "sqlmate export"] },
    { "code": "csvToSql",  "cmds": ["CSV转SQL", "Excel转SQL", "导入CSV", "sqlmate import"] },
    { "code": "diff",      "cmds": ["SQL对比", "数据Diff", "sqlmate diff"] },
    { "code": "ddldiff",   "cmds": ["DDL对比", "表结构对比", "sqlmate ddl"] }
  ]
}
```

---

## 大文件自动路由

服务层以 **10 MB** 为阈值自动切换处理路径：

| 文件大小 | 路径 | 说明 |
|---|---|---|
| ≤ 10 MB | 内存处理 | 读入字符串，纯函数处理，结果可直接展示 |
| > 10 MB | 流式处理 | `readline` 逐行读取，`O(1)` 内存，结果写出到文件 |

前端通过 `window.services.getFileSize(path)` 先查文件大小，再决定是否读取内容到界面。

---

## API 参考

前端通过 `window.services.xxx()` 调用，所有接受文件路径的方法均自动判断大小并路由。

---

### 工具方法

```js
// 获取文件字节大小（不读内容，用于大小判断）
window.services.getFileSize(filePath) → number

// 读取小文件内容（≤10MB）
window.services.readFile(filePath) → string

// 写单个文件
window.services.writeFile(filePath, content)

// 批量写多个文件到目录
window.services.writeFiles(dir, [{ name, content }])

// 格式化辅助
window.services.formatBytes(bytes) → string        // 如 "12.3 MB"
window.services.statsToMarkdown(stats) → string
window.services.statsToCsv(stats) → string
```

---

### merge — 合并 INSERT

```js
window.services.merge(inputSql, outputPath?, options?)
```

| 参数 | 类型 | 说明 |
|---|---|---|
| `inputSql` | `string` | SQL 字符串或文件路径 |
| `outputPath` | `string?` | 输出文件路径（大文件必填） |
| `options.batchSize` | `number` | 每批最大行数，默认 `1000` |
| `options.onProgress` | `(pct) => void` | 进度回调 0–100 |

**返回**

```js
{ sql?: string, tableCount: number, statementCount: number }
```

---

### split — 拆分 INSERT

```js
window.services.split(inputSql, outputPath?, options?)
```

| 参数 | 类型 | 说明 |
|---|---|---|
| `options.onProgress` | `(pct) => void` | 进度回调 |

**返回**

```js
{ sql?: string, statementCount: number }
```

---

### segment — 分割文件

```js
window.services.segment(inputSql, outputDir?, options?)
```

| 参数 | 类型 | 说明 |
|---|---|---|
| `options.mode` | `'count' \| 'size'` | 分割模式 |
| `options.count` | `number` | 每文件最大语句数，默认 `10000` |
| `options.sizeMB` | `number` | 每文件最大 MB，默认 `10` |
| `options.onProgress` | `(pct) => void` | 进度回调 |

**返回（小文件）**

```js
{ files: [{ name: string, content: string }], fileCount: number }
```

**返回（大文件）**

```js
{ fileCount: number, fileNames: string[] }
```

---

### scanTables / extractTables — 按表名抽取

```js
// 第一步：扫描所有表名
window.services.scanTables(inputSql, onProgress?)
// 返回: [{ name: string, count: number }]

// 第二步：提取指定表
window.services.extractTables(inputSql, tables, outputPath?, onProgress?)
// tables: string[]，大小写不敏感
// 返回: { sql?: string, count: number }
```

---

### dedupe — 去重

```js
window.services.dedupe(inputSql, outputPath?, options?)
```

| 参数 | 类型 | 说明 |
|---|---|---|
| `options.keyColumn` | `string` | 主键列名（与 keyColIndex 二选一） |
| `options.keyColIndex` | `number` | 主键列 1-based 序号 |
| `options.keepLast` | `boolean` | `true` 保留最后一条，默认 `true` |
| `options.onProgress` | `(pct) => void` | 进度回调 |

**返回**

```js
{ sql?: string, originalCount: number, keptCount: number, removedCount: number }
```

---

### mask — 数据脱敏

```js
window.services.mask(inputSql, outputPath?, rules, onProgress?)
```

**MaskRule 结构**

```js
{
  column: string,        // 列名（必填）
  type: string,          // 脱敏类型，见下表
  customValue?: string,  // type='custom_mask' 时的固定替换值
  regexPattern?: string, // type='regex_replace' 时的正则
  regexReplace?: string  // type='regex_replace' 时的替换模板
}
```

| type | 效果 | 示例 |
|---|---|---|
| `phone` | 随机中国手机号 | `13812345678` |
| `id_card` | 随机 18 位身份证 | `110101197001011234X` |
| `email` | 随机邮箱 | `user_12345@example.com` |
| `name` | 随机中文姓名 | `王伟` |
| `custom_mask` | 固定替换值 | `***` |
| `regex_replace` | 正则替换 | 自定义 |

> 同一次调用中，相同原始值始终生成相同假值（hash seed 机制）。

**返回**

```js
{ sql?: string, maskedCount: number, warnings: string[] }
```

---

### rename — 表名/列名替换

```js
window.services.rename(inputSql, outputPath?, rules, onProgress?)
```

**RenameRule 结构**

```js
{ type: 'table' | 'column' | 'prefix', from: string, to: string }
```

**返回**

```js
{ sql?: string, replacedCount: number }
```

---

### offset — 主键偏移

```js
window.services.offset(inputSql, outputPath?, rules, onProgress?)
```

**OffsetRule 结构**

```js
{ column?: string, colIndex?: number, offset: number }
```

**返回**

```js
{ sql?: string, modifiedCount: number, skippedCount: number, warnings: string[] }
```

---

### analyze — 文件统计

```js
window.services.analyze(inputSql, onProgress?)
```

**返回**

```js
{
  tables: [{ tableName: string, rowCount: number, estimatedBytes: number }],
  totalRows: number,
  totalStatements: number,
  inputBytes: number,
  durationMs: number
}
```

---

### convert — 语句改写

```js
window.services.convert(inputSql, outputPath?, options?)
```

| 参数 | 类型 | 说明 |
|---|---|---|
| `options.mode` | `'update' \| 'mysql_upsert' \| 'pg_upsert' \| 'insert_ignore'` | 改写模式 |
| `options.pkColumn` | `string` | 主键列名 |
| `options.pkColIndex` | `number` | 主键列 1-based 序号 |
| `options.excludeColumns` | `string[]` | SET 子句中排除的列 |
| `options.onProgress` | `(pct) => void` | 进度回调 |

**返回**

```js
{ sql?: string, convertedCount: number, skippedCount: number }
```

---

### sqlToCsv / sqlToXlsx — SQL 导出

```js
// SQL → CSV（单表→文件，多表→目录）
window.services.sqlToCsv(inputSql, outputPath, options?)

// SQL → xlsx（多表→多 Sheet）
window.services.sqlToXlsx(inputSql, outputPath, options?)
```

| 参数 | 类型 | 说明 |
|---|---|---|
| `inputSql` | `string` | SQL 字符串或文件路径 |
| `outputPath` | `string` | 输出文件/目录路径 |
| `options.onProgress` | `(info) => void` | 进度回调，`info = { bytesRead, totalBytes, pct }` |

**返回**

```js
// sqlToCsv
{ tableCount: number, rowCount: number, files: string[] }

// sqlToXlsx
{ tableCount: number, rowCount: number }
```

---

### csvToSql / xlsxToSql — 格式导入

```js
// CSV → SQL INSERT
window.services.csvToSql(csvPath, options)

// xlsx → SQL INSERT（多 Sheet → 多表）
window.services.xlsxToSql(xlsxPath, options?)
```

**csvToSql options**

| 参数 | 类型 | 说明 |
|---|---|---|
| `tableName` | `string` | 目标表名（必填） |
| `noHeader` | `boolean` | 无列名行，自动生成 col1, col2...，默认 `false` |
| `batchSize` | `number` | 批量 INSERT 每批行数，`0` = 单行模式，默认 `0` |
| `detectNumeric` | `boolean` | 纯数字列不加引号，默认 `true` |
| `onProgress` | `(info) => void` | 进度回调，`info = { rowsRead }` |

**xlsxToSql options**

| 参数 | 类型 | 说明 |
|---|---|---|
| `tableNameOverride` | `string` | 覆盖表名（留空使用 Sheet 名） |
| `noHeader` | `boolean` | 无列名行，默认 `false` |
| `batchSize` | `number` | 批量 INSERT 每批行数，默认 `0` |
| `detectNumeric` | `boolean` | 默认 `true` |
| `onProgress` | `(info) => void` | 进度回调，`info = { rowsRead, totalRows, pct }` |

**返回**

```js
// csvToSql
{ sql: string, rowCount: number }

// xlsxToSql
{ sql: string, tableCount: number, rowCount: number }
```

---

### diffData — 数据行级 Diff

```js
window.services.diffData(leftInput, rightInput, options?)
```

| 参数 | 类型 | 说明 |
|---|---|---|
| `leftInput` | `string` | 旧数据 SQL 字符串或文件路径 |
| `rightInput` | `string` | 新数据 SQL 字符串或文件路径 |
| `options.keyColumn` | `string` | 主键列名 |
| `options.keyColIndex` | `number` | 主键列 1-based 序号 |

**返回**

```js
{
  rows: DiffRow[],
  addedCount: number,
  removedCount: number,
  modifiedCount: number,
  unchangedCount: number
}
```

**DiffRow 结构**

```js
{
  status: 'added' | 'removed' | 'modified' | 'unchanged',
  tableName: string,
  keyValue: string,
  leftValues: string[] | null,
  rightValues: string[] | null,
  columns: string[] | null,
  changedColumns: string[]   // 仅 modified 时有值
}
```

---

### ddlDiff — DDL 结构对比

```js
window.services.ddlDiff(srcDdl, dstDdl, dialect?, includeIndexes?)
```

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `srcDdl` | `string` | — | 源表 DDL（基准/期望状态） |
| `dstDdl` | `string` | — | 目标表 DDL（待修改的表） |
| `dialect` | `string` | `'mysql'` | `mysql` / `postgresql` / `oracle` |
| `includeIndexes` | `boolean` | `true` | 是否对比索引 |

> **方向说明**：源表有、目标表没有 → `ADD COLUMN`；目标表有、源表没有 → `DROP COLUMN`。

**返回**

```js
{
  diff: {
    fromTableName: string,
    toTableName: string,
    columnChanges: ColumnChange[],
    indexChanges: IndexChange[],
    hasChanges: boolean
  },
  alterSql: string   // 无差异时为空字符串
}
```

---

## 前端使用示例

```js
// 通过 onPluginEnter 获取用户触发时带入的文本
window.ztools.onPluginEnter(({ code, payload }) => {
  if (code === 'merge' && payload) {
    window.services.merge(payload, null, { batchSize: 1000 }).then((result) => {
      renderResult(result.sql)
    })
  }
})

// 先查大小再决定是否读内容（避免大文件 OOM）
function loadFile(filePath) {
  const size = window.services.getFileSize(filePath)
  if (size > 10 * 1024 * 1024) {
    return { isLarge: true, filePath, content: '' }
  }
  return { isLarge: false, filePath, content: window.services.readFile(filePath) }
}

// 大文件带进度处理
async function mergeWithProgress(filePath, outputPath) {
  const result = await window.services.merge(filePath, outputPath, {
    batchSize: 1000,
    onProgress: (pct) => updateProgressBar(pct),
  })
  window.ztools.showNotification(`合并完成，共 ${result.statementCount} 条`)
}

// 保存结果
function saveResult(content) {
  const savePath = window.ztools.showSaveDialog({
    defaultPath: 'output.sql',
    filters: [{ name: 'SQL Files', extensions: ['sql'] }],
  })
  if (!savePath) return
  window.services.writeFile(savePath, content)
  window.ztools.showNotification('保存成功')
}
```

---

## 注意事项

| 项目 | 说明 |
|---|---|
| **preload 不可混淆** | `preload/` 下所有文件必须明文提交，ZTools 审核要求代码清晰可读 |
| **前端可编译** | `src/` 可用 Vite 编译，产物输出到 `dist/`，插件发布使用 `dist/` |
| **大文件阈值** | 以 10 MB 为界，服务层自动路由；前端通过 `getFileSize` 判断是否显示文件模式 UI |
| **schema 限定表名** | 所有 SQL 重建函数均正确处理 `db.table` 格式，输出为 `` `db`.`table` `` |
| **ddlDiff 单表限制** | `parseDDL` 每次只支持单张表 DDL，传入多表会抛出错误 |
| **mask 一致性** | 同一次 `mask()` 调用中，相同原始值始终生成相同假数据；跨次调用不保证一致 |
| **dedupe 内存** | `keyToIndex` Map 随唯一键数量线性增长，亿级去重场景需注意内存上限 |
| **format 功能** | 当前版本未包含 SQL 格式化功能（原文档中的 `format` 已移除） |
