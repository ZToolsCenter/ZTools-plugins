/**
 * ============================================================================
 * 共享类型层（roadmap 任务 FND-006）
 * ============================================================================
 *
 * 本文件是 M1 diff 引擎（ENG-001~013）与 M2 对比工作台 UI（UI-001~015）之间
 * 唯一的类型契约（single source of truth）。约定：
 *
 * 1. 纯类型模块：只包含 TypeScript 类型 / 接口 / 字面量联合，不含任何引擎逻辑；
 *    仅允许极少量「类型守卫」辅助函数（见文件末尾）。
 * 2. 数据流方向：UI 构造 `ComparePayload` → 引擎（ENG-001~013）产出 `DiffResult`
 *    → UI（UI-006~010 等）消费 `rows` / `hunks` / `collapses` / `stats`。
 * 3. 若未来类型规模膨胀需要拆分文件，拆出的文件一律放在 `src/core/` 下，
 *    并保持 `src/core/types.ts` 作为唯一入口 re-export 全部类型。
 *
 * 主要消费方速查：
 * - `DiffPrecision` / `DiffOptions` / `IgnoreRule` → ENG-004/006/007 读取，UI-005 产出
 * - `DiffRow` / `WordDiffSpan`                     → ENG-001/003/004/005 产出，UI-006/007/009 渲染
 * - `Hunk` / `CollapseRange`                       → ENG-008 产出，UI-007/008 消费
 * - `DiffStats`                                    → ENG-009 产出，UI-010 消费
 * - `ComparePayload`                               → UI-004 构造，引擎入口接收
 * - `DiffError` / `DiffResult`                     → 引擎统一返回，UI-013 错误提示
 * ============================================================================
 */

/* -------------------------------------------------------------------------- */
/* 一、对比选项（UI-005 工具栏 / 设置弹窗产出，ENG-004/006/007 消费）             */
/* -------------------------------------------------------------------------- */

/**
 * 差异对比精度（UI-005 精度下拉的四个取值）。
 *
 * - `'smart'`：智能策略（ENG-004）：默认档。行级骨架 + 变化行内词级高亮，
 *   整行等价但词不同等场景自动降级；精度切换基于同一输入缓存重投影，不重算原始 diff。
 * - `'line'`：行级 diff（ENG-001），只区分整行相同 / 增 / 删。
 * - `'word'`：词级 diff（ENG-003），基于 ENG-002 的 CJK 感知 tokenizer。
 * - `'char'`：字符级 diff（ENG-003）。
 */
export type DiffPrecision = 'smart' | 'line' | 'word' | 'char'

/**
 * 自定义忽略规则（UI-005 设置弹窗中管理，ENG-007 在对比前做规范化替换时消费）。
 */
export interface IgnoreRule {
  /** 稳定唯一标识，作为 UI 规则列表的 key（新增/删除/开关切换不依赖数组下标）。 */
  id: string
  /**
   * 正则源字符串（不含定界符 `/.../`）。
   * 非法正则在引擎侧返回 `DiffError`（`kind: 'invalid-regex'`），UI-013 据此提示。
   */
  pattern: string
  /**
   * 可选正则标志（如 `'g'`、`'gi'`）。
   * 未提供时由 ENG-007 按全局匹配（含 `g`）处理，保证一条规则替换整行所有命中。
   */
  flags?: string
  /** 启用开关：禁用的规则不参与本次对比的规范化，但仍保留在列表中。 */
  enabled: boolean
  /** 可选备注 / 规则名称，仅用于 UI 展示。 */
  label?: string
}

/**
 * 对比选项集合（与 `DiffPrecision` 精度正交组合，见 ENG-006）。
 */
export interface DiffOptions {
  /**
   * 忽略空白差异（ENG-006）：含行尾空白与整行缩进差异；
   * 被忽略的行视为规范化等价（`'equal'`），但 `text` 仍保留原文用于展示。
   */
  ignoreWhitespace: boolean
  /** 忽略大小写（ENG-006）：比较时统一小写，展示仍用原文。 */
  ignoreCase: boolean
  /** 忽略空行变化（ENG-006）：可选，缺省按 `false` 处理。 */
  ignoreEmptyLines?: boolean
  /** 自定义忽略规则列表（ENG-007）：对比前按顺序对文本做归一化替换（保留原串仅用于展示）。 */
  ignoreRules: IgnoreRule[]
}

/* -------------------------------------------------------------------------- */
/* 二、差异行模型（ENG-001/003/004/005 产出，UI-006/007/009 消费）               */
/* -------------------------------------------------------------------------- */

/**
 * 差异行类型。
 *
 * - `'equal'`：两侧等价（按当前 `DiffOptions` 规范化后等价即算，原文可能并不逐字符相同）。
 * - `'add'`：仅右侧存在的新增行（`left === undefined`）。
 * - `'del'`：仅左侧存在的删除行（`right === undefined`）。
 * - `'modify'`：相似行配对后的「修改对」行（ENG-005），`left` / `right` 同时存在，
 *   行内词级差异由两侧 `words` 承载。
 */
export type DiffRowType = 'equal' | 'add' | 'del' | 'modify'

/**
 * 行内词级差异片段（ENG-002 tokenizer + ENG-003/004 词级 diff 产出）。
 *
 * 约定：同一侧一行内的 spans 按顺序拼接（`spans.map(s => s.text).join('')`）
 * 必须恒等于该侧的 `text`；`changed === true` 的片段由 UI-006 做行内高亮。
 */
export interface WordDiffSpan {
  /** 片段文本。 */
  text: string
  /** 是否属于变化片段（`true` = 高亮）。 */
  changed: boolean
}

/**
 * 差异行的单侧内容（`DiffRow.left` / `DiffRow.right` 的形状）。
 */
export interface DiffRowSide {
  /**
   * 该侧在原始文件中的行号（1-based，不是结果序列下标）。
   * 并排视图左右两列行号各自独立计数（UI-006）。
   */
  lineNo: number
  /** 该行原文（未做忽略 / 规范化处理，供展示与合并 UI-012 使用）。 */
  text: string
  /**
   * 行内词级差异片段（可选）。仅变化行（`'modify'` 等）由 ENG-003/004 填充；
   * `'equal'` 行通常不填充。拼接约定见 `WordDiffSpan`。
   */
  words?: WordDiffSpan[]
}

/**
 * 差异行模型（diff 结果的最小渲染单元）。
 *
 * 并排视图约定（UI-006）：任意一行 `left` / `right` 至少一侧存在；
 * `'del'` 行 `right === undefined`，`'add'` 行 `left === undefined`。
 *
 * unified 视图渲染约定（UI-007）：按 `type` 渲染前缀 ——
 * `'equal'` → 空格（内容取任一侧，通常 `right`）；`'add'` → `'+'`（取 `right`）；
 * `'del'` → `'-'`（取 `left`）；`'modify'` → 拆为 `'-'`（left）与 `'+'`（right）两条。
 */
export interface DiffRow {
  /** 行类型，语义见 `DiffRowType`。 */
  type: DiffRowType
  /** 左侧（旧文本）内容；`'add'` 行为 `undefined`。 */
  left?: DiffRowSide
  /** 右侧（新文本）内容；`'del'` 行为 `undefined`。 */
  right?: DiffRowSide
  /**
   * 单行超长标记（ENG-012）：该行任一侧超过约 1 万字符时为 `true`，
   * 供 UI 默认截断并提供「展开」交互（不展开时渲染层 wrap 由换行开关控制）。
   */
  longLine?: boolean
  /**
   * 仅视觉对齐标记（行号对齐任务：`zipUnpairedRows` 产出，见 `./align.ts`）：
   * `true` 时该 `'modify'` 行是「把同一个替换区域内未配对的 del / add 两行
   * 并进同一条渲染行」的纯视觉合并 —— 左右行号各自来自原 del / add 行，
   * 但**不声称两行相似**、**不填 `words`**（无行内词级高亮），与 GitHub /
   * VSCode 并排视图的「行号尽量对齐」布局语义一致。消费约定：渲染层按普通
   * `'modify'` 行展示（左「−」右「+」）；词级 / 字符级重投影、统计、合并
   * 等逻辑对 `alignOnly: true` 行不做特殊处理（继续按普通 modify 行消费，
   * 只是它没有 `words` 可投影）。
   */
  alignOnly?: boolean
  /**
   * INT-008 行内评论占位字段：评估结论为「延后实现（⏸），不进入 v1」
   * （评估日期 2026-08-30，详见 docs/architecture.md §3「行内评论评估」）。
   * 类型保持空元组 `[]`：结构上不可存放内容，引擎与渲染层均不读写；
   * 未来落地时按架构文档 §3.4 挂载点清单整体替换，在此之前禁止塞入内容。
   */
  comments?: []
}

/* -------------------------------------------------------------------------- */
/* 三、hunk / 折叠 / 统计（ENG-008/009 产出，UI-007/008/010 消费）               */
/* -------------------------------------------------------------------------- */

/**
 * unified patch 的 hunk（@@ 头）数据（ENG-008 产出）。
 */
export interface Hunk {
  /**
   * `@@` 头原文，形如 `@@ -oldStart,oldLines +newStart,newLines @@`
   * （计数为 1 时 `,1` 可否省略由 ENG-008 决定；UI 原样展示该字符串，UI-007 可选显示）。
   */
  header: string
  /** 该 hunk 覆盖的行（含上下文行，默认 3 行、可调），是 `DiffResult.rows` 的连续切片。 */
  rows: DiffRow[]
  /** 旧文件（left）中本 hunk 的起始行号（1-based）。 */
  oldStart: number
  /** 旧文件（left）中本 hunk 覆盖的行数。 */
  oldLines: number
  /** 新文件（right）中本 hunk 的起始行号（1-based）。 */
  newStart: number
  /** 新文件（right）中本 hunk 覆盖的行数。 */
  newLines: number
}

/**
 * 折叠区间数据（ENG-008 产出，UI-008 消费）。
 *
 * 约定：`DiffResult.rows` 为完整展开的行序列（被折叠的行仍在其中）；
 * 在第 `beforeRow` 行之前有 `count` 行未更改内容（连续的 `'equal'` 行）被默认折叠，
 * 即被折叠区段为 `rows[beforeRow - count, beforeRow)`（0-based 下标，
 * 因此恒有 `count > 0` 且 `beforeRow >= count`）。
 * UI 在下标 `beforeRow` 之前渲染「⋯ 展开未更改的 N 行」折叠条，点击展开该区段。
 */
export interface CollapseRange {
  /** 折叠条插入位置：展开行序列中被折叠区段之后第一行的 0-based 下标。 */
  beforeRow: number
  /** 被折叠的未更改行数。 */
  count: number
}

/**
 * 对比统计（ENG-009 产出，UI-010 的 `+N −M` 徽标与统计条消费）。
 */
export interface DiffStats {
  /** 新增行数：`type === 'add'` 的行数。 */
  addedLines: number
  /** 删除行数：`type === 'del'` 的行数。 */
  removedLines: number
  /** 修改对数量：`type === 'modify'` 的行数（一对计 1；其左右两侧不计入 added/removed，避免重复计数）。 */
  modifiedPairs: number
  /** hunk 数量，恒等于 `hunks.length`。 */
  hunkCount: number
  /** 结果总行数，恒等于 `rows.length`。 */
  totalRows: number
}

/* -------------------------------------------------------------------------- */
/* 四、相似行配对（ENG-005 产出，驱动 'modify' 行与 UI-012 合并箭头）             */
/* -------------------------------------------------------------------------- */

/**
 * 相似行配对结果（ENG-005：del 块与 add 块之间按 LCS / 相似度阈值配对）。
 *
 * 索引约定：`leftIndex` 为 del 行在其 del 块内的 0-based 下标，`rightIndex` 为
 * add 行在其 add 块内的 0-based 下标（即「块内索引」约定；若 ENG-005 实现改为
 * 全局行号，必须同步更新本注释与所有消费方）。
 */
export interface LinePair {
  /** del 块内左侧行的 0-based 下标。 */
  leftIndex: number
  /** add 块内右侧行的 0-based 下标。 */
  rightIndex: number
  /** 两行相似度，取值范围 [0, 1]；仅达到 ENG-005 内部阈值的行对才会产出。 */
  similarity: number
}

/* -------------------------------------------------------------------------- */
/* 五、请求与结果（UI → 引擎 → UI 的统一契约）                                   */
/* -------------------------------------------------------------------------- */

/**
 * UI → 引擎的对比请求（UI-004「查找差异」按钮 / 实时对比防抖构造，INT-004 历史记录会序列化此结构）。
 */
export interface ComparePayload {
  /** 左侧（旧文本）原始输入，未做任何规范化，BOM / CRLF / 尾部换行原样保留。 */
  left: string
  /** 右侧（新文本）原始输入，同上。 */
  right: string
  /** 对比选项（必填，UI-005 当前开关状态）。 */
  options: DiffOptions
  // 【输入规范化策略（ENG-010 定稿；实现在 ./normalize.ts，引擎入口接线于
  // ./diff.ts 的 diffLinesCore / compareWithOptions）】：
  // 1. BOM：仅剥除文本开头的一个 U+FEFF（比较与展示管线都剥除 —— BOM 不可
  //    见，保留会造成幻影首行差异，DiffRow 各侧 text / lineNo 因此不含 BOM）。
  //    UTF-16 BOM（FF FE / FE FF）不做二进制级处理：本插件输入以字符串形态
  //    到达，preload 解码时已处理。
  // 2. 行尾符：CRLF / LF / CR 统一按行切分（splitLines），行内容不含行尾符
  //    → 混用行尾符不产生差异。
  // 3. 尾部换行有无：归一化为等价（'a\n' ≡ 'a'）—— 粘贴文本的尾部换行差异
  //    是最常见噪声源，行号与展示模型不受影响；「唯一差异是尾部换行」时
  //    analyzeInputPair（./normalize.ts）的 trailingNewlineDiffers 为 true，
  //    供 UI 未来展示「尾部换行不一致」提示徽标。
  // 4. 0 字节 / 空文本：'' 与 '' → 0 行、无差异；'' 与非空 → 纯增 / 纯删。
  // 除剥 BOM 外各侧 text 恒保留原文：规范化只用于相等性判定，不写回展示文本
  // （与合并 UI-012 的「原文合并」语义兼容）。单侧边界元数据（hadBom /
  // endsWithNewline / hasMixedLineEndings / isEmpty / byteLength）见
  // ./normalize.ts 的 NormalizedInput，供 UI 诊断与 ENG-011 大文本阈值复用。
}

/**
 * 引擎错误对象（判别联合，判别字段为 `kind`）。
 *
 * - `too-large`：ENG-011 大文本防护 —— 输入超过上限（默认 5MB / 10 万行）时返回，
 *   不执行 diff；UI-013 用它给出「文本过大」确认提示。
 * - `invalid-regex`：ENG-007 —— `DiffOptions.ignoreRules` 中存在非法正则时返回。
 * - `internal`：兜底内部错误，`message` 为人类可读描述。
 */
export type DiffError =
  | {
      /** 输入超限（ENG-011）。 */
      kind: 'too-large'
      /** 字节上限（默认 5MB，缺省表示引擎未启用该维度限制）。 */
      limitBytes?: number
      /** 行数上限（默认 10 万行，缺省同上）。 */
      limitLines?: number
      /** 实际输入字节数（可缺省）。 */
      actualBytes?: number
      /** 实际输入行数（可缺省）。 */
      actualLines?: number
    }
  | {
      /** 非法正则（ENG-007）。 */
      kind: 'invalid-regex'
      /** 出错的正则源字符串（便于 UI 定位到具体规则）。 */
      pattern: string
    }
  | {
      /** 内部错误兜底。 */
      kind: 'internal'
      /** 人类可读的错误描述。 */
      message: string
    }

/** `DiffError['kind']` 的快捷引用，供 UI 做 switch 分支收窄。 */
export type DiffErrorKind = DiffError['kind']

/**
 * 对比成功结果（`DiffResult` 的 `ok: true` 分支）。
 */
export interface DiffResultOk {
  /** 固定为 `true`，判别字段。 */
  ok: true
  /**
   * 完整展开的差异行序列（含未更改的 `'equal'` 行），并排视图（UI-006）、
   * 折叠（UI-008）与虚拟滚动（UI-009）的主数据源。
   */
  rows: DiffRow[]
  /** @@ 分块列表（ENG-008），unified 视图渲染（UI-007）与 hunk 导航（UI-010）消费。 */
  hunks: Hunk[]
  /** 默认折叠的未更改区段列表（ENG-008 → UI-008），语义见 `CollapseRange`。 */
  collapses: CollapseRange[]
  /** 统计数据（ENG-009 → UI-010），语义见 `DiffStats`。 */
  stats: DiffStats
}

/**
 * 对比失败结果（`DiffResult` 的 `ok: false` 分支）。
 */
export interface DiffResultErr {
  /** 固定为 `false`，判别字段。 */
  ok: false
  /** 错误详情，UI-013 按 `error.kind` 分支提示。 */
  error: DiffError
}

/**
 * 引擎统一返回模型（判别联合）：引擎入口只返回本类型，
 * UI 一律先判别 `ok` 再消费（可配合文件末尾的 `isDiffOk` 类型守卫）。
 */
export type DiffResult = DiffResultOk | DiffResultErr

/* -------------------------------------------------------------------------- */
/* 六、类型守卫（本文件仅有的运行时代码，极少量辅助函数，不含引擎逻辑）            */
/* -------------------------------------------------------------------------- */

/**
 * 判断引擎返回是否为成功结果，并将类型收窄为 `DiffResultOk`。
 */
export function isDiffOk(result: DiffResult): result is DiffResultOk {
  return result.ok
}

/**
 * 判断引擎返回是否为失败结果，并将类型收窄为 `DiffResultErr`。
 */
export function isDiffError(result: DiffResult): result is DiffResultErr {
  return !result.ok
}
