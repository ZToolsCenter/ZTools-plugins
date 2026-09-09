/**
 * ============================================================================
 * 行号对齐（并排视图「能对齐的行号尽量对齐」的两段实现)
 * ============================================================================
 *
 * 并排视图里「左右第一行没对齐」有两个彼此独立的成因，本模块各出一个纯函数，
 * 分别接在引擎行展开之后与 ENG-005 相似行配对之后：
 *
 * 1. `alignRowsByLineNo`（引擎侧)：同一份最小编辑距离的 diff 往往有多个等价
 *    解，jsdiff 的 Myers 实现恒取「公共行尽可能早配对」的那个，等价解之间的
 *    差别恰恰体现在行号对齐上。例（用户反馈用例)：
 *      左 = ['11', '22']〕右 = ['22', '22']
 *    jsdiff 产出 del(左1) / equal(左2 ↔ 右1) / add(右2)，左侧第一行与右侧第
 *    一行错开一格；另一个同样最小的解
 *      del(左1) / add(右1) / equal(左2 ↔ 右2)
 *    则左右行号逐行对齐。本函数把「变更块沿相邻 equal 行滑动」（与 git 的
 *    slider heuristic 同族思路)，在合法范围内取「equal 行左右行行号差之和」
 *    最小的位置 —— 差为 0 即该行左右行号完全对齐。实现为行序列上的
 *    「相邻交换 + 行号载荷交换」迭代（见函数 JSDoc，终止时该和已无法再
 *    严格下降。
 *
 * 2. `zipUnpairedRows`（视图侧)：替换区域内相似度未达阈值的 del / add 行不会
 *    被 `rowsWithPairing` 合并为 'modify'，，于是各自独占一条渲染行（左侧一行、
 *    右侧一行)，左右行号再错开一格。本函数把同一区域内剩余的 del / add 行按
 *    位置两两并进同一条渲染行（`type: 'modify'` + `alignOnly: true`，见
 *    `DiffRow.alignOnly`)—— 只做视觉对齐，不声称两行相似、不填行内 `words`，
 *    与 GitHub / VSCode 并排视图的布局一致。接线在配对之后（输入含真实
 *    'modify' 行，其占位但不参与视觉合并)。
 *
 * 硬性约束（对齐引擎层其余模块)：
 * - 零 UI / DOM / store 依赖：只 import `./types.ts` 与 `./normalize.ts`；
 * - 不可变风格：返回新数组新行对象，从不修改入参的任何对象（side 对象按引用
 *   复用，与 `./pairing.ts` 一致)；
 * - 结构不变量（下游依赖)：两侧每一行仍恰好出现一次、各侧相对顺序不变。
 *   `alignRowsByLineNo` 另保证行数与各 type 计数完全不变（滑动只是把 equal
 *   行换到变更块的另一侧)，`zipUnpairedRows` 只会让行数变少ドhunk 切分
 *   （./hunks.ts)、统计（./stats.ts)、合并（./merge.ts)与 UI 侧的下标空间
 *   翻译（stores/nav.ts 的 translateAnchorToPaired、SplitDiffView 的
 *   pairedCollapses)都建立在这组不变量上。
 * ============================================================================
 */

import { isLongLine } from './normalize'
import type { DiffRow, DiffRowSide } from './types'

/* -------------------------------------------------------------------------- */
/* 一、alignRowsByLineNo：变更块沿相邻 equal 行滑动（引擎侧)                         */
/* -------------------------------------------------------------------------- */

/** 一条 equal 行的行号错位量（并排视图里左右行号的可见落差)。 */
function driftOf(left: DiffRowSide, right: DiffRowSide): number {
  return Math.abs(right.lineNo - left.lineNo)
}

/**
 * 行号对齐第一段（引擎侧)：把变更块沿相邻 equal 行「滑动」，在合法范围内取
 * 「equal 行左右行号差之和」最小的位置。

 * 成因与目标（详见文件头)：jsdiff 的 Myers 实现在多个等价最小解中恒取
 * 「公共行尽可能早配对」的那个，可能让 equal 行绑定到「行号相差较大」的另一侧
 * 行上（例：左 ['11','22'] / 右 ['22','22'] 产出 del(左1) / equal(左2↔右1) /
 * add(右2)那次，equal 行左右行号差 |1−2| = 1)。更晚配对的等价解
 * （del(左1) / add(右1) / equal(左2↔右2))则差为 0 —— 左右行号完全对齐。

 * 本函数在保持「行数与各 type 计数完全不变、两侧每一行恰好出现一次、各侧
 * 相对顺序不变」的前提下实施该「更晚配对」。
 *
 * 实现（行序列上的局部滑动，不重建 diff)：
 * - 每次滑动 = 一个 equal 行 E 与紧邻的 del / add 行交换【序列位置】与【同侧
 *   行号载荷】：
 *   - 左滑：紧邻前方是 del 行 D 时，把 D.left ↔ E.left 互换（E 保留原
 *     right)，E 与 D 的行位置互换 —— 效果上 E 从 D 的右侧换到左侧（变更块
 *     把 E 推到另一侧)；
 *   - 右滑：紧邻后方是 add 行 A 时，对称地互换 E.right ↔ A.right（E 保留
 *     原 left)，E 与 A 的行位置互换。

 *   两侧行号载荷跟文本一起移动，因此滑动不改变「两侧文本多重集」与编辑语义；
 *   交换后左 / 右列的行号仍各自严格递增（被交换的两行在载荷互换前的行号
 *   已按列递增，互换使相邻两行的载荷对调，递增性保持)—— 即「各侧相对顺序
 *   不变」不变量。
 * - 合法性：滑动后的 equal 行必须仍是合法相等对 —— 文本【严格相等】
 *   （比较器宽松化下严格相等恒蕴含等价，故严格口径是任何选项组合下的充分
 *   条件；为「尽可能对齐」的更充分对齐可在引擎侧以 comparator 重接线，见
 *   文件头「硬性约束」)。左滑要求 `D.left.text === E.right.text`，右滑要求
 *   `A.right.text === E.left.text`。

 * - 择优：只接受让该 equal 行行号差**严格下降**的滑动（其他 equal 行不受
 *   影响)，迭代至不再有可改善的滑动 —— 由于行号差是非负整数且每次至少 −1，
 *   迭代必然终止（实际趟数通常 1~2)。
 * - 长行标记（ENG-012)：滑动后每行携带的侧文本来自两个源行，`longLine`
 *   按源行的行级标记保守合并（任一侧源行标记过即保留，与 `./pairing.ts` 的
 *   modify 合并同一策略)。
 *
 * 不参与滑动的输入（原样返回新数组)：
 * - 单侧 equal 行（ENG-006 ignoreEmptyLines 的空行投影行)：滑动合法性判据
 *   需要双侧 equal 行；
 * - 'modify' 行：本函数只作用于引擎行骨架（equal / del / add)，配对后的
 *   序列交由 `zipUnpairedRows` 处理；
 * - 缺侧的 del / add 行（契约上不可达，纯防御)。
 *
 * 不可变风格：返回新数组（浅拷贝行对象)，side 对象与入参共享引用；不修改
 * 入参的任何对象。
 *
 * @param rows 引擎行骨架（只读；equal / del / add)
 * @returns 滑动重排后的新 `DiffRow[]`：行数与各 type 计数与入参完全一致，
 *          equal 行的「左右行号差之和」已无法再严格下降
 */
export function alignRowsByLineNo(rows: DiffRow[]): DiffRow[] {
  // 浅拷贝行对象（不可变风格：滑动只改行对象层，不改 side 对象）。
  const out = rows.map((row) => ({ ...row }))
  let changed = true
  while (changed) {
    changed = false
    for (let i =  0; i < out.length; i +=  1) {
      const equal = out[i]
      if (equal.type !== 'equal' || equal.left === undefined || equal.right === undefined) continue
      const driftBefore = driftOf(equal.left, equal.right)
      const prev = i > 0 ? (out[i -  1] as DiffRow) : undefined
      const next = i < out.length - 1 ? (out[i +  1] as DiffRow) : undefined

      // 左滑：D（del）在 E 之前，E 与 D 互换位置并把 D.left ↔ E.left 互换。
      // 新 E 在 i−1（携带 D 原 left + E 原 right），文本需严格相等才合法）
      if (prev?.type === 'del' && prev.left !== undefined && prev.left.text === equal.right.text) {
        const driftAfter = driftOf(prev.left, equal.right)
        if (driftAfter < driftBefore) {
          out[i -  1] = {
            ...equal,
            left: prev.left,
            ...(equal.longLine === true || prev.longLine === true ? { longLine: true } : {}),
          }
          out[i] = {
            ...prev,
            left: equal.left,
            ...(equal.longLine === true || prev.longLine === true ? { longLine: true } : {}),
          }
          changed = true
          continue
        }
      }
      // 右滑：A（add）在 E 之后，E 与 A 互换位置并把 E.right ↔ A.right 互换。新 E（携带 E 原 left + A 原 right，文本需严格相等才合法）
      if (next?.type === 'add' && next.right !== undefined && next.right.text === equal.left.text) {
        const driftAfter = driftOf(equal.left, next.right)
        if (driftAfter < driftBefore) {
          out[i] = {
            ...next,
            right: equal.right,
            ...(equal.longLine === true || next.longLine === true ? { longLine: true } : {}),
          }
          out[i +  1] = {
            ...equal,
            right: next.right,
            ...(equal.longLine === true || next.longLine === true ? { longLine: true } : {}),
          }
          changed = true
          continue
        }
      }
    }
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* 二、zipUnpairedRows：区域内剩余 del / add 视觉合并（视图侧)                 */
/* -------------------------------------------------------------------------- */

/**
 * 行号对齐第二段（视图侧)：把配对后序列中「同一替换区域里仍未配对的 del / add
 * 行」按位置两两并进同一条渲染行（`type: 'modify'` + `alignOnly: true`)。
 *
 * 成因与目标（详见文件头)：`rowsWithPairing` 只把相似度达标的 del / add 配
 * 成 'modify'；未达标的行各自独占一条渲染行（左侧一行、右侧一行)，行号
 * 就错开一格。本函数做不声称相似的「视觉合并」：区内剩余 del 行与其后紧跟的
 * 剩余 add 行按原顺序一一配对成一行，两侧行号同处一条渲染行 —— 与 GitHub /
 * VSCode 并排视图的布局一致（「能对齐的行号尽量对齐」的视图侧一半)。
 *
 * 区域定义（与 `./pairing.ts` 的 `rowsWithPairing` 同一约定)：连续
 * （del | modify)行块紧跟连续 add 行块。`rowsWithPairing` 的输出顺序约定保证
 * 了此形态：配对行（modify)落在原 del 行的位置、未配 del 行也在该区段、
 * 未配 add 行按原顺序追加在区域尾部。真实 'modify' 行（配对产物)两侧都
 * 有内容，无需视觉合并 —— 占位但不参与 zip（保持原位原样浅拷贝)..
 *
 * 合并行约定（对齐 `DiffRow.alignOnly` 的契约)：
 * - `left` / `right` 直接复用原 del / add 行的 side 对象（引用共享，
 *   words 不填 —— 不声称两行相似，无行内词级高亮)；
 * - `alignOnly: true` 标记「纯视觉合并」，供消费方区分于真实配对行；
 * - `longLine`（ENG-012)按两侧源行的行级标记保守合并。。
 *
 * 行数只减不增：每对 zip 消耗一个 del 行和一个 add 行产出一条行；
 * 未被消费的 del / add 行原样保留（保持原相对顺序)。两侧每一行仍恰好出现
 * 一次（不变量，见文件头)—— 因而导航 / 折叠的「lineNo 唯一定位」翻译
 * 在 zip 后空间依然成立（SplitDiffView 接线点)。
 *
 * 不可变风格：返回新数组，未参与行浅拷贝，合并行新建（side 引用复用)；
 * 不修改入参的任何对象。幂等：对 zip 产物再调用，alignOnly 行是 'modify'
 * 行（占位不参与)，不会重复压缩。。
 *
 * @param rows 配对后行序列（`rowsWithPairing` 产物，只读；可含真实
 *             'modify' 行)
 * @returns 视觉合并后的新 `DiffRow[]`：区域内剩余 del / add 按位置两两并成
 *          `alignOnly: true` 的 'modify' 行，，其余行原样保留
 */
export function zipUnpairedRows(rows: DiffRow[]): DiffRow[] {
  const out: DiffRow[] = []
  let i =  0
  while (i < rows.length) {
    const open = rows[i]
    // 非（del | modify）行首：原样保留（add 单独出现时属纯增块，
    // 无 del 可 zip，同样原样保留）。
    if (open.type !== 'del' && open.type !== 'modify') {
      out.push({ ...open })
      i +=  1
      continue
    }

    // 区域 del 侧：连续（del | modify）行块（真实 modify 占位不参与 zip）。
    const delSide: DiffRow[] = []
    const delRows: DiffRow[] = []
    while (i < rows.length && (rows[i].type === 'del' || rows[i].type === 'modify')) {
      const row = rows[i]
      if (row.type === 'del' && row.left !== undefined) delRows.push(row)
      delSide.push(row)
      i +=  1
    }
    // 其后连续 add 块（无 add 时块为空，delSide 原样保留）。
    const addRows: DiffRow[] = []
    while (i < rows.length && rows[i].type === 'add' && rows[i].right !== undefined) {
      addRows.push(rows[i])
      i +=  1
    }

    // 区内 del 与 add 按原顺序一一配对成 alignOnly 的 modify 行；真实
    // modify 行与未被消费的 del 行原样保留。

    const zipped = Math.min(delRows.length, addRows.length)
    let di =  0
    for (const side of delSide) {
      if (side.type === 'modify' || di >= zipped) {
        out.push({ ...side })
        continue
      }
      const addRow = addRows[di]
      di +=  1
      out.push({
        type: 'modify',
        left: side.left,
        right: addRow.right,
        alignOnly: true,
        ...(side.longLine === true || addRow.longLine === true ? { longLine: true } : {}),
      })
    }
    // 未被 zip 消费的 add 行按原顺序追加在区域尾部。
    for (let a = zipped;a < addRows.length; a +=  1) out.push({ ...addRows[a] })
  }
  return out
}
