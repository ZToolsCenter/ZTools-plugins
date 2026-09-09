/**
 * ============================================================================
 * 相似行配对（roadmap 任务 ENG-005：del/add 块 → 'modify' 修改对的数据层）
 * ============================================================================
 *
 * 在 ENG-001 行级骨架、ENG-002 tokenizer、ENG-003 行内 diff 之上实现
 * 「相似行配对」：把替换区域（连续 del 块紧跟连续 add 块）中内容相似的一对
 * del / add 行配成「修改对」，合并为 `type: 'modify'` 的 `DiffRow`（left /
 * right 同时存在，见 `./types.ts` 的约定），驱动并排视图行内高亮与合并箭头
 * （箭头交互本身归 UI-012，本模块只交付数据层：`LinePair[]` 与 'modify' 行）。
 *
 * 与 ENG-003 `applyInlineSpans` 的关系：后者在替换区域内做「位置配对」
 * （块内下标相同即配对，不判断相似度），本模块升级为「LCS / 相似度阈值配对」
 * —— 先对块内所有 (i, j) 计算相似度，再用单调 DP 求总分最大的保序配对，
 * 只有相似度 ≥ 阈值的行对才配成 'modify'。`applyInlineSpans` 本身与
 * ENG-003/004 的既有行为完全不受影响（本模块不复用其配对策略，只复用其
 * `computeSpans` 计算配对行的行内 spans）；compare() 的接线归 ENG-008/009，
 * 本模块不改动 `./diff.ts` 的任何出口。
 *
 * 相似度度量（`similarity`）：两侧文本经 ENG-002 `tokenizeWords` 切词后取
 * 最长公共子序列（LCS）长度，按 Dice 系数 `2 * lcs / (lenA + lenB)` 归一到
 * [0, 1]。选词 token 而非字符的原因：
 * - 中文（及日文假名 / 韩文谚文）经 `tokenizeWords` 逐字成 token，整行中文
 *   的 LCS 就是「逐字比较」，语义完全有意义；
 * - 拉丁文本按整词成 token（`hello` 是一个 token），避免字符级 LCS 把
 *   `cat` 与 `concat` 这类「子串巧合」误判为高度相似 —— 词级比较下二者
 *   LCS 为 0，相似度 0，符合直觉；
 * - 数字串、空白等其余 token 类别同样整体参与比较，粒度与词级行内高亮
 *   （ENG-003 的 `'word'` 粒度）一致。
 *
 * 配对算法（`pairBlock`）：单调（保持相对顺序）的最大权配对 —— 配对集合中
 * 任意两对 (i1,j1)、(i2,j2)（按 leftIndex 升序）恒有 i1 < i2 ⟺ j1 < j2，
 * 即配对行在各自块内的先后顺序与原行序一致（UI 合并箭头因此不会交叉）。
 * 用 O(n×m) 的迭代 DP 求解（无递归，不会爆栈），公式：
 *   f(i, j) = max( f(i-1, j), f(i, j-1),
 *                 f(i-1, j-1) + (score(i,j) ≥ threshold ? score(i,j) : -inf) )
 * 其中 f(i, j) 表示「只允许使用前 i 个 del 行与前 j 个 add 行」时的最大
 * 配对总分，回溯即得配对集合。相似度低于阈值的 (i, j) 以 -inf 参与转移，
 * 在「跳过恒不亏」（f 值恒 ≥ 0）的性质下天然被排除，与「只保留相似度
 * ≥ threshold 的配对」的约定一致。
 *
 * 注意：单调约束意味着完全交叉的两块（del [A, B] vs add [B', A']，且 A~A'、
 * B~B' 都相似）不可能同时取 (0,1) 与 (1,0) 两对 —— 后者的 rightIndex 必须
 * 大于前者，二者互斥。此时 DP 取总分更高的一对；要「两个方向都翻转」的
 * 相似对同时成立，需要更长的块（例如 add 侧多一行错位，见
 * tests/core/pairing.test.ts 的三行块用例）。
 *
 * 硬性约束（对齐 ENG-001/002/003/004 的引擎层约束）：
 * - 零 UI 依赖、零 DOM、零 store 依赖：只允许 import `./tokenizer.ts`、
 *   `./inline.ts` 与 `./types.ts`（均为纯逻辑引擎模块）；
 * - 不可变风格：所有导出函数返回新数组新对象，从不修改入参。
 * ============================================================================
 */

import { computeSpans } from './inline'
import { tokenizeWords } from './tokenizer'
import type { DiffRow, LinePair } from './types'

/* -------------------------------------------------------------------------- */
/* similarity：两行文本的相似度（Dice 系数 × 词 token LCS）                      */
/* -------------------------------------------------------------------------- */

/**
 * 计算两段文本的相似度（ENG-005 配对打分单元），取值范围 [0, 1]。
 *
 * 实现方式：两侧各经 `tokenizeWords` 切成词 token 序列（选词 token 的理由见
 * 文件头「相似度度量」一节：中文逐字 token 使 LCS 对中文整行有意义，拉丁按
 * 整词 token 避免子串误配），求最长公共子序列（LCS）长度（滚动两行的经典
 * O(lenA × lenB) DP，无递归），按 Dice 系数归一：
 *
 *     similarity = 2 * lcs / (lenA + lenB)
 *
 * 取值含义：1 = token 序列完全相同（含两侧同为空串），0 = 没有任何公共
 * token（含恰有一侧为空串），中间值随公共子序列占比连续变化。
 *
 * 空串边界（显式约定）：两侧都为空串 → 1（空对空视为完全相同，让两个
 * 「同时被删又被加的空行」能配对）；恰有一侧为空串 → 0（空行与非空行
 * 无任何公共内容，不配对）。实现上先于 tokenize 判断 —— 非空串经
 * `tokenizeWords` 恒产出至少 1 个 token（tokenizer 无损拼接铁律的推论），
 * 因此字符串级判空即可覆盖全部分母为零的情况。
 *
 * @param a 左侧文本（通常是 del 行的原文）
 * @param b 右侧文本（通常是 add 行的原文）
 * @returns 相似度，范围 [0, 1]；对任意输入满足对称性
 *          `similarity(a, b) === similarity(b, a)`
 */
export function similarity(a: string, b: string): number {
  if (a === '' && b === '') return 1
  if (a === '' || b === '') return 0

  const tokensA = tokenizeWords(a)
  const tokensB = tokenizeWords(b)
  const lcs = lcsLength(tokensA, tokensB)
  return (2 * lcs) / (tokensA.length + tokensB.length)
}

/**
 * 两个 token 序列的最长公共子序列（LCS）长度（模块内私有）。
 *
 * 经典线性空间 DP：只保留上一行与当前行两行状态（`Uint32Array` 滚动交换），
 * O(lenA × lenB) 时间、O(lenB) 空间，迭代实现无递归爆栈风险。任一序列为空
 * 返回 0。
 *
 * @param a 左 token 序列（`tokenizeWords` 的产物）
 * @param b 右 token 序列（同上）
 * @returns LCS 长度（≥ 0 的整数）
 */
function lcsLength(a: string[], b: string[]): number {
  const n = a.length
  const m = b.length
  if (n === 0 || m === 0) return 0

  // prev / curr 各有 m + 1 格，下标 0 恒为 0（「任一侧取 0 个 token」的
  // DP 边界）。交换复用两块缓冲，每轮开始前 curr 中残存的旧值会在内层循环
  // 里被逐格覆写（j 从 1 起，curr[0] 永远保持 0 且只被读），语义正确。
  let prev = new Uint32Array(m + 1)
  let curr = new Uint32Array(m + 1)

  for (let i = 1; i <= n; i += 1) {
    const tokenA = a[i - 1]
    for (let j = 1; j <= m; j += 1) {
      curr[j] =
        tokenA === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1])
    }
    ;[prev, curr] = [curr, prev]
  }

  return prev[m]
}

/* -------------------------------------------------------------------------- */
/* pairBlock：del 块与 add 块之间的单调最大配对                                  */
/* -------------------------------------------------------------------------- */

/**
 * 在一个替换区域内为 del 块与 add 块求「单调的最大配对」（ENG-005 核心）。
 *
 * 对块内所有 (i, j) 组合调用 `similarity(delTexts[i], addTexts[j])`，再用
 * O(n×m) 的迭代 DP（公式见文件头）求「保持相对顺序」的最大权配对并回溯出
 * 配对集合：
 *
 * - 单调性：结果按 `leftIndex` 升序排列时 `rightIndex` 也严格升序 —— 配对
 *   行在各自块内的相对顺序与原行序一致（UI-012 合并箭头因此不交叉）；
 * - 阈值：相似度 < threshold 的 (i, j) 以 -inf 参与转移（跳过恒不亏），因此
 *   不会出现在结果中，等价于「只保留 similarity ≥ threshold 的配对」；
 *   `similarity` 恰等于 threshold 的行对会被保留（≥ 语义）；
 * - 平局：总分相同的多个最优配对集合任取其一（本实现按「优先配对、其次
 *   跳过 del、最后跳过 add」的固定顺序回溯，输出确定）；任意平局结果的总分
 *   都等于 DP 最优值；
 * - 单调约束的推论：完全交叉的两块（del [A, B] vs add [B', A']，A~A' 且
 *   B~B'）最多只能取 (0,1)、(1,0) 之一（二者互斥），DP 取总分更高者；
 *   详见文件头「配对算法」一节与测试用例。
 *
 * 索引约定（对齐 `types.ts` 中 `LinePair` 的注释）：`leftIndex` / `rightIndex`
 * 均为【块内 0-based 下标】，不是全局行号；`similarity` 为该对的相似度原值。
 *
 * 复杂度：O(n×m) 时间与空间（相似度矩阵 + DP 表），迭代实现无递归爆栈。
 *
 * @param delTexts del 块内各行文本（按原行序）
 * @param addTexts add 块内各行文本（按原行序）
 * @param threshold 配对阈值（缺省 0.5）：similarity ≥ threshold 才允许配对
 * @returns 配对集合，按 `leftIndex` 升序排列（`rightIndex` 随之严格升序）；
 *          任一块为空、或所有组合都低于阈值时返回 `[]`
 */
export function pairBlock(
  delTexts: string[],
  addTexts: string[],
  threshold = 0.5,
): LinePair[] {
  const n = delTexts.length
  const m = addTexts.length
  if (n === 0 || m === 0) return []

  // 1. 预计算相似度矩阵（i, j → 相似度；低于阈值记为 NaN 表示「不可配对」，
  //    避免在 DP 与回溯中重复调用 similarity，也免去 -inf 的特殊书写 ——
  //    NaN 参与任何加法都得 NaN，与 -inf 同样不可能成为 max 的胜者）。
  const scores: number[][] = []
  for (let i = 0; i < n; i += 1) {
    const row: number[] = []
    for (let j = 0; j < m; j += 1) {
      const s = similarity(delTexts[i], addTexts[j])
      row.push(s >= threshold ? s : Number.NaN)
    }
    scores.push(row)
  }

  // 2. 迭代 DP：f[i][j] = 只用前 i 个 del 行与前 j 个 add 行的最大配对总分。
  //    边界 f[0][*] = f[*][0] = 0（不配任何对）；Float64Array 逐行分配，
  //    全表保留供回溯使用。
  const f: Float64Array[] = []
  for (let i = 0; i <= n; i += 1) f.push(new Float64Array(m + 1))

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const s = scores[i - 1][j - 1]
      // 不配 (i-1, j-1)：跳过 del 行（来自 f[i-1][j]）或跳过 add 行（f[i][j-1]）。
      let best = Math.max(f[i - 1][j], f[i][j - 1])
      // 配 (i-1, j-1)：仅当相似度达标（NaN 时自然被排除，见上）。
      if (!Number.isNaN(s)) {
        const paired = f[i - 1][j - 1] + s
        if (paired > best) best = paired
      }
      f[i][j] = best
    }
  }

  // 3. 回溯：从 (n, m) 逆推每一步的转移来源。三个分支的值由同一套浮点运算
  //    算出，`===` 判等即「该分支也是最优选择」的可靠判据；按「配对 → 跳过
  //    del → 跳过 add」的固定顺序取分支，平局时输出确定。逆推得到的配对
  //    leftIndex 严格递减，reverse 后即升序且 rightIndex 同步严格递增
  //    （每对同时消费 i 与 j，单调性由 DP 结构保证）。
  const pairs: LinePair[] = []
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    const s = scores[i - 1][j - 1]
    if (!Number.isNaN(s) && f[i][j] === f[i - 1][j - 1] + s) {
      pairs.push({ leftIndex: i - 1, rightIndex: j - 1, similarity: s })
      i -= 1
      j -= 1
    } else if (f[i][j] === f[i - 1][j]) {
      // del 行 i-1 未配对（或配对不优），跳过。
      i -= 1
    } else {
      // add 行 j-1 未配对，跳过。
      j -= 1
    }
  }
  pairs.reverse()
  return pairs
}

/* -------------------------------------------------------------------------- */
/* rowsWithPairing：在行骨架上执行相似行配对，产出 'modify' 行                    */
/* -------------------------------------------------------------------------- */

/**
 * 在行级骨架上执行相似行配对（ENG-005 主入口）：把替换区域内配对成功的
 * del / add 行合并为 `type: 'modify'` 的行，未配对的行保持原样。
 *
 * 处理流程：
 * 1. 顺序扫描行骨架，定位「连续 del 行块紧跟连续 add 行块」的替换区域
 *    （与 ENG-003 `applyInlineSpans` 相同的区域定义：jsdiff 保证同一替换
 *    区域内 removed 块先于 added 块出现，见 ENG-001 `diffLinesCore`；被
 *    equal / modify 等其他行隔断的 del / add 属于不同区域，分别处理）；
 * 2. 区域内取两侧行文本调用 `pairBlock`（阈值 `threshold`），得到单调配对
 *    集合；
 * 3. 配对成功的对 → 合并为一个 'modify' 行：`left` 取 del 行的 left（lineNo
 *    与 text 来自原 del 行），`right` 取 add 行的 right（lineNo 与 text 来自
 *    原 add 行），两侧 `words` 填 `computeSpans(delText, addText, 'word')`
 *    的词级 spans（拼接恒等于各自 text，见 `WordDiffSpan` 契约）；
 * 4. 未配对的 del / add 行保持原 type 与内容。
 *
 * 区域内的输出顺序约定（重要，供 UI 与后续任务对齐）：
 * - 非配对行保持自己在原骨架中的相对位置；
 * - 配对行放在【原 del 行的位置】（一对配对占原 del 行的那一格）；
 * - 因此区域内输出 = 「按原 del 行序逐行产出（配对行输出为 modify，未配对
 *   del 行原样）」+「未被配对消费的 add 行按原顺序追加在区域尾部」。
 *   例：del [D0, D1] / add [A0, A1, A2]，仅 (D0, A0) 配对 → 输出
 *   [modify(D0,A0), del(D1), add(A1), add(A2)]。等长全配对时区域行数由
 *   del + add 减半为 max(del块, add块)。
 *
 * 其他约定：
 * - `'equal'` 行原样保留（浅拷贝），纯 add / 纯 del（无配对区域）整块原样
 *   保留，均不产出 'modify'、不填 `words`；
 * - 'modify' 行的 `longLine`（ENG-012 占位字段）在任一侧原行为 true 时置
 *   true（保守合并，不丢失超长标记）；
 * - 行号不变量：modify 行的 `left.lineNo` 恒来自原 del 行、`right.lineNo`
 *   恒来自原 add 行（左右两列行号各自独立，UI-006 依赖此约定）。
 *
 * 不可变风格：返回新数组，未配对 / equal 行为浅拷贝的新行对象（side 对象
 * 与入参共享引用）；配对产生的 'modify' 行连同其 left / right side 对象都是
 * 新建对象。本函数从不修改入参的任何对象，也不调用 `applyInlineSpans`
 * （ENG-003/004 的既有行为不受影响）。
 *
 * @param rows 行级骨架（通常来自 `diffLinesCore`；若行已带 `words`，未配对
 *             行原样携带，配对行的 `words` 会被重新计算覆盖）
 * @param threshold 配对阈值（缺省 0.5），语义同 `pairBlock`
 * @returns 执行了相似行配对的新 `DiffRow[]`：equal 行与区域外的行序不变，
 *          配对区域按上方「输出顺序约定」排布
 */
export function rowsWithPairing(rows: DiffRow[], threshold = 0.5): DiffRow[] {
  const result: DiffRow[] = []

  let i = 0
  while (i < rows.length) {
    const row = rows[i]

    // 非 del 行（equal / add / 既有 modify 等）：不在配对区域头部，原样浅
    // 拷贝进入结果（add 行只可能与紧邻前方的 del 块配对，已在下方处理）。
    if (row.type !== 'del') {
      result.push({ ...row })
      i += 1
      continue
    }

    // 收集连续 del 块（与 applyInlineSpans 相同的区域定位：其后若隔了
    // equal / modify 等行再出现 del，属于下一个区域，由后续循环处理）。
    const delStart = i
    while (i < rows.length && rows[i].type === 'del') i += 1
    const delBlock = rows.slice(delStart, i)

    // del 块之后紧跟的连续 add 块（若有）构成一个替换区域。
    const addStart = i
    while (i < rows.length && rows[i].type === 'add') i += 1
    const addBlock = rows.slice(addStart, i)

    // 纯删除区域（del 块后面没有紧跟 add 块）：无配对对象，整块原样保留。
    if (addBlock.length === 0) {
      for (const delRow of delBlock) result.push({ ...delRow })
      continue
    }

    // 相似度配对：块内 0-based 索引 → 原行对象。
    const pairs = pairBlock(
      delBlock.map((r) => r.left!.text),
      addBlock.map((r) => r.right!.text),
      threshold,
    )

    // 配对查询结构：leftIndex → 配对（del 侧逐行查）；rightIndex 集合
    // （被消费的 add 行，区域尾部输出时跳过）。
    const pairByLeft = new Map<number, LinePair>()
    for (const pair of pairs) pairByLeft.set(pair.leftIndex, pair)
    const consumedAdd = new Set(pairs.map((p) => p.rightIndex))

    // 先按原 del 行序产出（配对行 → modify，落在原 del 行的位置）。
    for (let di = 0; di < delBlock.length; di += 1) {
      const delRow = delBlock[di]
      const pair = pairByLeft.get(di)
      if (pair === undefined) {
        // 未配对的 del 行：保持原 type 与内容（浅拷贝，side 共享引用）。
        result.push({ ...delRow })
        continue
      }

      const addRow = addBlock[pair.rightIndex]
      const delText = delRow.left!.text
      const addText = addRow.right!.text
      const spans = computeSpans(delText, addText, 'word')

      // 'modify' 修改对行：left/right 双侧齐全，行号各来自原 del / add 行，
      // words 填词级 spans（拼接恒等于各自 text）。longLine 保守合并。
      result.push({
        type: 'modify',
        left: { ...delRow.left!, words: spans.left },
        right: { ...addRow.right!, words: spans.right },
        ...(delRow.longLine === true || addRow.longLine === true
          ? { longLine: true as const }
          : {}),
      })
    }

    // 再追加未被配对消费的 add 行（保持原相对顺序，区域尾部）。
    for (let aj = 0; aj < addBlock.length; aj += 1) {
      if (!consumedAdd.has(aj)) result.push({ ...addBlock[aj] })
    }
  }

  return result
}
