# SQLMate ZTools 插件集成需求文档

> 基于 [ZTools 开发者文档](https://ztoolscenter.github.io/ZTools-doc/) 规范编写
> SQLMate 核心库版本: v0.1.0

---

## 概述

SQLMate 所有业务逻辑均实现于 `src/lib/sql/` 中，为**纯函数、零副作用、无 DOM/Tauri 依赖**的 TypeScript 模块，编译为 CommonJS 后可直接在 ZTools 的 `preload.js` 中 `require` 使用。

本文档描述：
1. 插件目录结构
2. `plugin.json` 配置
3. `preload.js` 实现规范
4. 每个功能模块的 Node.js API

---

## 插件目录结构

ZTools 插件只识别原始的 `html + css + js`，**不能对 preload.js 及其依赖进行打包/压缩/混淆**。

```
sqlmate-plugin/
├── plugin.json          # 插件配置入口
├── logo.png             # 插件图标（png/jpg）
├── preload.js           # Node.js 桥接层（明文，不可混淆）
├── index.html           # 前端入口（可由 Vite 编译输出）
├── index.js             # 前端 JS（编译产物）
├── index.css            # 前端 CSS（编译产物）
└── lib/                 # SQLMate 核心库（明文源码，不可压缩）
    ├── merge.js
    ├── split.js
    ├── segment.js
    ├── format.js
    ├── extract.js
    ├── dedupe.js
    ├── mask.js
    ├── rename.js
    ├── offset.js
    ├── stats.js
    ├── convert_stmt.js
    ├── diff.js
    └── ddl_diff.js
```

> **关键规范**：`preload.js` 和 `lib/` 下的所有文件必须保持源码清晰可读，提交插件时将源码原样提交，ZTools 审核要求每一行代码可读。前端界面（`index.html/js/css`）可以使用 Vite 编译，但 Node.js 侧不行。

---

## plugin.json 配置

```json
{
  "name": "sqlmate",
  "title": "SQLMate",
  "description": "SQL 数据处理工具集 — 合并、拆分、脱敏、DDL对比等 13 项功能，数据不离本地",
  "version": "0.1.0",
  "main": "index.html",
  "logo": "logo.png",
  "preload": "preload.js",
  "development": {
    "main": "http://localhost:5173"
  },
  "features": [
    {
      "code": "merge",
      "explain": "合并 INSERT 语句为批量插入",
      "cmds": ["SQL合并", "合并INSERT", "sqlmate merge"]
    },
    {
      "code": "split",
      "explain": "拆分批量 INSERT 为单行语句",
      "cmds": ["SQL拆分", "拆分INSERT", "sqlmate split"]
    },
    {
      "code": "segment",
      "explain": "按行数或大小分割 SQL 文件",
      "cmds": ["SQL分割", "切割SQL", "sqlmate segment"]
    },
    {
      "code": "format",
      "explain": "格式化美化 SQL（支持多方言）",
      "cmds": ["SQL格式化", "美化SQL", "sqlmate format"]
    },
    {
      "code": "extract",
      "explain": "从 dump 中按表名抽取 INSERT 语句",
      "cmds": ["SQL抽取", "按表抽取", "sqlmate extract"]
    },
    {
      "code": "dedupe",
      "explain": "按主键对 INSERT 语句去重",
      "cmds": ["SQL去重", "INSERT去重", "sqlmate dedupe"]
    },
    {
      "code": "mask",
      "explain": "对 INSERT 数据脱敏（手机号/邮箱/姓名等）",
      "cmds": ["SQL脱敏", "数据脱敏", "sqlmate mask"]
    },
    {
      "code": "rename",
      "explain": "批量替换表名或列名",
      "cmds": ["表名替换", "列名替换", "sqlmate rename"]
    },
    {
      "code": "offset",
      "explain": "主键 ID 批量偏移，避免合库冲突",
      "cmds": ["ID偏移", "主键偏移", "sqlmate offset"]
    },
    {
      "code": "stats",
      "explain": "统计 SQL 文件中各表行数和大小",
      "cmds": ["SQL统计", "表统计", "sqlmate stats"]
    },
    {
      "code": "convert",
      "explain": "INSERT 改写为 UPDATE / UPSERT / INSERT IGNORE",
      "cmds": ["语句改写", "INSERT转UPDATE", "sqlmate convert"]
    },
    {
      "code": "diff",
      "explain": "按主键对比两份 SQL 数据差异",
      "cmds": ["SQL对比", "数据Diff", "sqlmate diff"]
    },
    {
      "code": "ddldiff",
      "explain": "对比两张表 DDL 差异并生成 ALTER SQL",
      "cmds": ["DDL对比", "表结构对比", "sqlmate ddl"]
    },
    {
      "code": "sqlmate",
      "explain": "打开 SQLMate 主界面",
      "cmds": ["sqlmate", "SQL工具箱"]
    }
  ]
}
```

---

## preload.js 实现

`preload.js` 遵循 CommonJS 规范，通过 `window` 对象向前端暴露 API。

```js
// preload.js
// SQLMate ZTools Plugin — Node.js 桥接层
// 注意：此文件不可压缩/混淆，保持源码清晰

const { mergeSQL }          = require('./lib/merge')
const { splitSQL }          = require('./lib/split')
const { segmentSQL }        = require('./lib/segment')
const { formatSQL }         = require('./lib/format')
const { scanTables, extractTables } = require('./lib/extract')
const { dedupeSql }         = require('./lib/dedupe')
const { maskSql }           = require('./lib/mask')
const { renameSql }         = require('./lib/rename')
const { offsetSql }         = require('./lib/offset')
const { analyzeSql, statsToMarkdown, statsToCsv } = require('./lib/stats')
const { convertStatements } = require('./lib/convert_stmt')
const { diffSql }           = require('./lib/diff')
const { parseDDL, diffDDL, generateAlterSql } = require('./lib/ddl_diff')
const fs = require('fs')

window.sqlmate = {

  // ── 合并 ──────────────────────────────────────────────────────────────────
  merge(sql, batchSize = 1000) {
    return mergeSQL(sql, { batchSize })
  },

  // ── 拆分 ──────────────────────────────────────────────────────────────────
  split(sql) {
    return splitSQL(sql)
  },

  // ── 分割 ──────────────────────────────────────────────────────────────────
  segmentByCount(sql, count = 10000) {
    return segmentSQL(sql, { mode: 'count', count })
  },

  segmentBySize(sql, sizeMB = 10) {
    return segmentSQL(sql, { mode: 'size', sizeMB })
  },

  // ── 格式化 ────────────────────────────────────────────────────────────────
  format(sql, dialect = 'mysql', indent = 2) {
    return formatSQL(sql, { dialect, indent })
  },

  // ── 按表名抽取 ────────────────────────────────────────────────────────────
  scanTables(sql) {
    return scanTables(sql)
  },

  extractTables(sql, tables) {
    return extractTables(sql, tables)
  },

  // ── 去重 ──────────────────────────────────────────────────────────────────
  dedupe(sql, keyColumn, keepLast = true) {
    return dedupeSql(sql, { keyColumn, keepLast })
  },

  dedupeByIndex(sql, keyColIndex, keepLast = true) {
    return dedupeSql(sql, { keyColIndex, keepLast })
  },

  // ── 脱敏 ──────────────────────────────────────────────────────────────────
  mask(sql, rules) {
    return maskSql(sql, rules)
  },

  // ── 表名/列名替换 ─────────────────────────────────────────────────────────
  rename(sql, rules) {
    return renameSql(sql, rules)
  },

  // ── 主键偏移 ──────────────────────────────────────────────────────────────
  offset(sql, rules) {
    return offsetSql(sql, rules)
  },

  // ── 文件统计 ──────────────────────────────────────────────────────────────
  analyze(sql) {
    return analyzeSql(sql)
  },

  statsToMarkdown(stats) {
    return statsToMarkdown(stats)
  },

  statsToCsv(stats) {
    return statsToCsv(stats)
  },

  // ── 语句改写 ──────────────────────────────────────────────────────────────
  convertToUpdate(sql, pkColumn, excludeColumns = []) {
    return convertStatements(sql, { mode: 'update', pkColumn, excludeColumns })
  },

  convertToMysqlUpsert(sql, pkColumn, excludeColumns = []) {
    return convertStatements(sql, { mode: 'mysql_upsert', pkColumn, excludeColumns })
  },

  convertToPgUpsert(sql, pkColumn, excludeColumns = []) {
    return convertStatements(sql, { mode: 'pg_upsert', pkColumn, excludeColumns })
  },

  convertToInsertIgnore(sql) {
    return convertStatements(sql, { mode: 'insert_ignore' })
  },

  // ── 数据行级 Diff ─────────────────────────────────────────────────────────
  diffData(leftSql, rightSql, keyColumn) {
    return diffSql(leftSql, rightSql, keyColumn)
  },

  diffDataByIndex(leftSql, rightSql, keyColIndex) {
    return diffSql(leftSql, rightSql, undefined, keyColIndex)
  },

  // ── DDL 结构对比 ──────────────────────────────────────────────────────────
  ddlDiff(srcDdl, dstDdl, dialect = 'mysql', includeIndexes = true) {
    const srcDef = parseDDL(srcDdl)
    const dstDef = parseDDL(dstDdl)
    const diff = diffDDL(dstDef, srcDef, includeIndexes)
    const alterSql = diff.hasChanges
      ? generateAlterSql(diff, dialect, dstDef.rawTableName)
      : ''
    return { diff, alterSql }
  },

  // ── 文件读取工具（供前端调用本地大文件）─────────────────────────────────
  readFile(filePath) {
    return fs.readFileSync(filePath, 'utf-8')
  },

  writeFile(filePath, content) {
    fs.writeFileSync(filePath, content, 'utf-8')
  },

  writeFiles(dir, files) {
    files.forEach(({ name, content }) => {
      fs.writeFileSync(require('path').join(dir, name), content, 'utf-8')
    })
  },
}
```

---

## API 参考

前端通过 `window.sqlmate.xxx()` 调用，以下描述每个方法的参数和返回值。

---

### merge — 合并 INSERT

```js
window.sqlmate.merge(sql, batchSize?)
```

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `sql` | `string` | — | 输入 SQL 文本 |
| `batchSize` | `number` | `1000` | 每批最大行数 |

**返回**

```js
{
  sql: string,           // 合并后的 SQL
  tableCount: number,    // 涉及表数量
  statementCount: number // 输出的 INSERT 语句条数
}
```

---

### split — 拆分 INSERT

```js
window.sqlmate.split(sql)
```

**返回**

```js
{
  sql: string,           // 拆分后的 SQL
  statementCount: number // 输出的单行 INSERT 数量
}
```

---

### segment — 分割文件

```js
// 按行数分割
window.sqlmate.segmentByCount(sql, count?)

// 按文件大小分割
window.sqlmate.segmentBySize(sql, sizeMB?)
```

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `count` | `number` | `10000` | 每文件最大语句数 |
| `sizeMB` | `number` | `10` | 每文件最大 MB 数 |

**返回**

```js
{
  files: [{ name: string, content: string }], // 文件名：output_001.sql ...
  fileCount: number
}
```

> 建议配合 `window.sqlmate.writeFiles(dir, files)` 写出到本地。

---

### format — 格式化 SQL

```js
window.sqlmate.format(sql, dialect?, indent?)
```

| 参数 | 类型 | 默认值 | 可选值 |
|---|---|---|---|
| `dialect` | `string` | `'mysql'` | `mysql` / `postgresql` / `tsql` / `plsql` / `sqlite` / `bigquery` |
| `indent` | `number` | `2` | `2` / `4` |

**返回**

```js
{
  sql: string,
  success: boolean,
  warning?: string  // 格式化失败时的提示
}
```

---

### extract — 按表名抽取

```js
// 第一步：扫描所有表名
window.sqlmate.scanTables(sql)
// 返回: [{ name: string, count: number }]

// 第二步：提取指定表
window.sqlmate.extractTables(sql, tables)
// tables: string[]，表名列表（大小写不敏感）
// 返回: { sql: string, count: number }
```

---

### dedupe — 去重

```js
// 按列名去重
window.sqlmate.dedupe(sql, keyColumn, keepLast?)

// 按列序号去重（INSERT 无列名时）
window.sqlmate.dedupeByIndex(sql, keyColIndex, keepLast?)
```

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `keyColumn` | `string` | — | 主键列名 |
| `keyColIndex` | `number` | — | 主键列 1-based 序号 |
| `keepLast` | `boolean` | `true` | `true` 保留最后一条，`false` 保留第一条 |

**返回**

```js
{
  sql: string,
  originalCount: number,
  keptCount: number,
  removedCount: number
}
```

---

### mask — 数据脱敏

```js
window.sqlmate.mask(sql, rules)
```

**MaskRule 结构**

```js
{
  column: string,        // 列名（必填）
  type: string,          // 脱敏类型（必填），见下表
  customValue?: string,  // type='custom_mask' 时的固定替换值
  regexPattern?: string, // type='regex_replace' 时的正则模式
  regexReplace?: string  // type='regex_replace' 时的替换模板
}
```

**type 可选值**

| 值 | 效果 | 示例输出 |
|---|---|---|
| `phone` | 随机中国手机号 | `13812345678` |
| `id_card` | 随机 18 位身份证 | `110101197001011234X` |
| `email` | 随机邮箱 | `user_12345@example.com` |
| `name` | 随机中文姓名 | `王伟` |
| `custom_mask` | 固定替换值 | `***`（或自定义） |
| `regex_replace` | 正则替换 | 自定义 |

> 同一列的相同原始值，在整次调用中始终生成相同假值（hash seed 机制，保持引用一致性）。

**返回**

```js
{
  sql: string,
  maskedCount: number, // 被脱敏的 INSERT 行数
  warnings: string[]   // 列名不存在等警告
}
```

---

### rename — 表名/列名替换

```js
window.sqlmate.rename(sql, rules)
```

**RenameRule 结构**

```js
{
  type: 'table' | 'column' | 'prefix',
  from: string,
  to: string
}
```

| type | 行为 |
|---|---|
| `table` | 精确匹配表名替换 |
| `column` | 替换列名列表中的指定列 |
| `prefix` | 替换表名前缀（`prod_` → `test_`） |

**返回**

```js
{
  sql: string,
  replacedCount: number // 被修改的 INSERT 行数
}
```

---

### offset — 主键偏移

```js
window.sqlmate.offset(sql, rules)
```

**OffsetRule 结构**

```js
{
  column: string,    // 列名（与 colIndex 二选一）
  colIndex?: number, // 1-based 列序号
  offset: number     // 偏移量（支持负数）
}
```

**返回**

```js
{
  sql: string,
  modifiedCount: number, // 修改行数
  skippedCount: number,  // 非数值跳过行数
  warnings: string[]
}
```

---

### stats — 文件统计

```js
const stats = window.sqlmate.analyze(sql)
// stats.tables: [{ tableName, rowCount, estimatedBytes }]
// stats.totalRows: number
// stats.inputBytes: number
// stats.durationMs: number

window.sqlmate.statsToMarkdown(stats)  // 返回 Markdown 表格字符串
window.sqlmate.statsToCsv(stats)       // 返回 CSV 字符串
```

---

### convert — 语句改写

```js
// INSERT → UPDATE
window.sqlmate.convertToUpdate(sql, pkColumn, excludeColumns?)

// INSERT → MySQL UPSERT (ON DUPLICATE KEY UPDATE)
window.sqlmate.convertToMysqlUpsert(sql, pkColumn, excludeColumns?)

// INSERT → PostgreSQL UPSERT (ON CONFLICT DO UPDATE)
window.sqlmate.convertToPgUpsert(sql, pkColumn, excludeColumns?)

// INSERT → INSERT IGNORE（无需主键）
window.sqlmate.convertToInsertIgnore(sql)
```

| 参数 | 类型 | 说明 |
|---|---|---|
| `pkColumn` | `string` | 主键列名 |
| `excludeColumns` | `string[]` | SET 子句中排除的列（如 `['created_at']`） |

**返回**

```js
{
  sql: string,
  convertedCount: number,
  skippedCount: number  // 无法解析主键的行数
}
```

---

### diffData — 数据行级 Diff

```js
// 按列名
window.sqlmate.diffData(leftSql, rightSql, keyColumn)

// 按列序号
window.sqlmate.diffDataByIndex(leftSql, rightSql, keyColIndex)
```

**返回**

```js
{
  rows: DiffRow[],       // 按 removed→modified→added→unchanged 排序
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
  leftValues: string[] | null,   // 旧值
  rightValues: string[] | null,  // 新值
  columns: string[] | null,      // 列名
  changedColumns: string[]       // 发生变更的列（仅 modified）
}
```

---

### ddlDiff — DDL 结构对比

```js
window.sqlmate.ddlDiff(srcDdl, dstDdl, dialect?, includeIndexes?)
```

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `srcDdl` | `string` | — | 源表 DDL（基准/期望状态） |
| `dstDdl` | `string` | — | 目标表 DDL（待修改的表） |
| `dialect` | `string` | `'mysql'` | `mysql` / `postgresql` / `oracle` |
| `includeIndexes` | `boolean` | `true` | 是否对比索引差异 |

> **方向说明**：源表有、目标表没有的字段 → 生成 `ADD COLUMN`；目标表有、源表没有的字段 → 生成 `DROP COLUMN`。

**返回**

```js
{
  diff: {
    fromTableName: string,
    toTableName: string,
    columnChanges: ColumnChange[], // { kind, column, fromColumn? }
    indexChanges: IndexChange[],   // { kind, index, fromIndex? }
    hasChanges: boolean
  },
  alterSql: string  // 生成的 ALTER TABLE 语句（无差异时为空字符串）
}
```

---

## 前端使用示例

```js
// index.js（前端代码，运行在渲染进程）

// 通过 onPluginEnter 获取用户触发时带入的文本
window.ztools.onPluginEnter(({ code, payload }) => {
  if (code === 'merge' && payload) {
    // 用户在搜索框粘贴了 SQL，直接处理
    const result = window.sqlmate.merge(payload, 1000)
    renderResult(result.sql)
  }
})

// 读取本地 SQL 文件（大文件场景）
function loadLocalFile() {
  const paths = window.ztools.showOpenDialog({
    filters: [{ name: 'SQL Files', extensions: ['sql', 'txt'] }]
  })
  if (!paths || paths.length === 0) return
  const content = window.sqlmate.readFile(paths[0])
  return content
}

// 保存结果到本地
function saveResult(content) {
  const savePath = window.ztools.showSaveDialog({
    defaultPath: 'output.sql',
    filters: [{ name: 'SQL Files', extensions: ['sql'] }]
  })
  if (!savePath) return
  window.sqlmate.writeFile(savePath, content)
  window.ztools.showNotification('保存成功')
}

// 直接复制结果到剪贴板
function copyResult(content) {
  window.ztools.copyText(content)
  window.ztools.showNotification('已复制到剪贴板')
}
```

---

## 注意事项

| 项目 | 说明 |
|---|---|
| **preload 不可混淆** | `preload.js` 及 `lib/` 下所有文件必须明文提交，ZTools 审核要求代码清晰可读 |
| **前端可编译** | `index.html/js/css` 可以用 Vite/Webpack 编译，只需保证输出到插件目录 |
| **大文件建议** | 所有核心函数为同步执行，处理超大文本（>50MB）时建议通过 `window.sqlmate.readFile` 读取文件路径，分块处理 |
| **format 依赖** | `lib/format.js` 依赖 `sql-formatter` npm 包，需将该包的源码放在 `lib/node_modules/` 下随插件一起提交 |
| **ddlDiff 单表限制** | `parseDDL` 每次只支持单张表 DDL，传入多表会抛出错误，前端需提前校验 |
| **mask 一致性** | 同一次 `mask()` 调用中，相同原始值始终生成相同假数据；跨次调用不保证一致 |
| **platform 字段** | 所有功能跨平台，`plugin.json` 的 features 无需设置 `platform` 字段 |
