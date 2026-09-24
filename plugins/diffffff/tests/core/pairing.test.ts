/**
 * 相似行配对单元测试（roadmap 任务 ENG-005）。
 *
 * 覆盖 `src/core/pairing.ts` 的三个出口：
 * - `similarity`：词 token LCS + Dice 系数的取值边界 —— 相同串 = 1、无关串
 *   = 0、CJK 共享前缀高分（含恰好落在默认阈值 0.5 的边界样本）、空串边界
 *   （都空 = 1 / 单侧空 = 0）、前缀串、取值范围与对称性；
 * - `pairBlock`：LCS 单调配对对比「位置配对」的优势场景（del [A,B] vs
 *   add [B',A'] 的交叉错位）、低于阈值不配对（含 similarity 恰等于阈值的
 *   ≥ 语义）、空块 / 单行块、单调性与升序约定；
 * - `rowsWithPairing`：等长全配对（行数减半）、不等长部分配对（剩余 del /
 *   add 保持原样）、纯 add / 纯 del / 全 equal 无 modify、多区域独立配对、
 *   阈值参数、行号不变量（modify 行 left.lineNo 来自原 del 行、right.lineNo
 *   来自原 add 行）、不可变风格（structuredClone 对比入参未被修改），以及
 *   与 ENG-003 `applyInlineSpans` 的共存（互不干扰）。
 */
import { describe, expect, it } from 'vitest'
import { pairBlock, rowsWithPairing, similarity } from '../../src/core/pairing'
import { applyInlineSpans } from '../../src/core/inline'
import { diffLinesCore } from '../../src/core/diff'

/* -------------------------------------------------------------------------- */
/* similarity：取值与边界                                                       */
/* -------------------------------------------------------------------------- */

describe('similarity', () => {
  it('相同文本 → 1（含中英文与纯空白）', () => {
    expect(similarity('const x = 1;', 'const x = 1;')).toBe(1)
    expect(similarity('你好世界', '你好世界')).toBe(1)
    expect(similarity('  \t ', '  \t ')).toBe(1)
  })

  it('完全无关文本 → 0（拉丁整词不匹配 / CJK 无公共字）', () => {
    // 词 token 层面 'abc' 与 'xyz' 是两个不同的整词，LCS = 0；
    // 字符级 LCS 会因子串巧合给出非零分，这正是选词 token 的原因之一。
    expect(similarity('abc', 'xyz')).toBe(0)
    expect(similarity('甲乙丙', '丁戊己')).toBe(0)
  })

  it('「你好世界」vs「你好地球」→ 0.5：CJK 逐字 token 使共享前缀「你好」贡献一半', () => {
    // tokens [你,好,世,界] vs [你,好,地,球]，LCS = 2，Dice = 2*2/(4+4) = 0.5
    // （恰好落在默认阈值上，同时被 pairBlock 的 ≥ 语义用例复用）。
    expect(similarity('你好世界', '你好地球')).toBe(0.5)
  })

  it('重合度更高的 CJK 文本得分接近 1', () => {
    // tokens 4 vs 5，LCS = 4，Dice = 8/9 ≈ 0.889。
    expect(similarity('你好世界', '你好世界地')).toBeCloseTo(8 / 9)
  })

  it('空串边界：都空 → 1，单侧空 → 0', () => {
    expect(similarity('', '')).toBe(1)
    expect(similarity('', 'abc')).toBe(0)
    expect(similarity('abc', '')).toBe(0)
    expect(similarity('', '你好世界')).toBe(0)
  })

  it('前缀串：共享 token 越多分越高', () => {
    // [你,好] vs [你,好,世,界]：LCS = 2，Dice = 4/6 = 2/3。
    expect(similarity('你好', '你好世界')).toBeCloseTo(2 / 3)
    // [hello,' ',world] vs [hello]：LCS = 1，Dice = 2/4 = 0.5（整词比较）。
    expect(similarity('hello world', 'hello')).toBe(0.5)
  })

  it('取值恒在 [0,1] 且关于参数对称', () => {
    const samples: Array<[string, string]> = [
      ['你好世界', '你好地球'],
      ['const x = 1;', 'const x = 2;'],
      ['apple pie', 'apple pie'],
      ['abc', ''],
      ['', ''],
      ['a🎉b', 'a🎉c𠀀'],
      ['foo bar baz', 'bar baz qux'],
    ]
    for (const [a, b] of samples) {
      const s = similarity(a, b)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(1)
      expect(similarity(b, a)).toBe(s)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* pairBlock：单调最大配对                                                      */
/* -------------------------------------------------------------------------- */

describe('pairBlock', () => {
  it('错位两行块：LCS 配对找到正确的交叉对，位置配对会错配', () => {
    // del [A, B] vs add [B', A']：A~A' 相似度 5/6，B~B' 相似度 3/4，
    // 位置配对会给 (0,0)=A↔B' 与 (1,1)=B↔A'（相似度均为 0，全部错配）。
    // 单调约束下 (0,1) 与 (1,0) 互斥（后者的 rightIndex 必须更大），
    // DP 取总分更高者 (0,1) = A↔A' —— 即「相对位置配对发生了交叉」的正确配对。
    const pairs = pairBlock(['苹果香蕉橘子', '猫狗鸟鱼'], ['猫狗鼠鱼', '苹果香蕉梨子'])

    expect(pairs).toHaveLength(1)
    expect(pairs[0].leftIndex).toBe(0)
    expect(pairs[0].rightIndex).toBe(1)
    expect(pairs[0].similarity).toBeCloseTo(10 / 12)
    // 位置配对的那一对（相似度 0）绝不应出现。
    expect(pairs.some((p) => p.leftIndex === 0 && p.rightIndex === 0)).toBe(false)
  })

  it('错位三行块：两个交叉相似对同时成立，位置配对全部错配', () => {
    // add 侧头部多一行无关行，使 A↔A'（0→1）与 B↔B'（1→2）可同时单调成立；
    // 位置配对会给 (0,0)=A↔无关行 与 (1,1)=B↔A'（相似度均为 0）—— 全错。
    const pairs = pairBlock(
      ['苹果香蕉橘子', '猫狗鸟鱼'],
      ['完全无关的内容', '苹果香蕉梨子', '猫狗鼠鱼'],
    )

    expect(pairs.map((p) => [p.leftIndex, p.rightIndex])).toEqual([
      [0, 1],
      [1, 2],
    ])
    expect(pairs[0].similarity).toBeCloseTo(10 / 12)
    expect(pairs[1].similarity).toBeCloseTo(6 / 8)
  })

  it('低于阈值不配对；similarity 恰等于阈值时按 ≥ 语义保留', () => {
    // similarity('你好世界', '你好地球') = 0.5，恰等于默认阈值 → 配对。
    expect(pairBlock(['你好世界'], ['你好地球'])).toEqual([
      { leftIndex: 0, rightIndex: 0, similarity: 0.5 },
    ])
    // 阈值调过 0.5 → 不配对。
    expect(pairBlock(['你好世界'], ['你好地球'], 0.51)).toEqual([])
    // 完全无关 → 不配对。
    expect(pairBlock(['abc'], ['xyz'])).toEqual([])
  })

  it('空块边界：任一块为空返回 []', () => {
    expect(pairBlock([], [])).toEqual([])
    expect(pairBlock(['你好世界'], [])).toEqual([])
    expect(pairBlock([], ['你好世界'])).toEqual([])
  })

  it('单行块：相似则产出一对，索引均为 0', () => {
    const pairs = pairBlock(['苹果香蕉橘子'], ['苹果香蕉梨子'])
    expect(pairs).toHaveLength(1)
    expect(pairs[0].leftIndex).toBe(0)
    expect(pairs[0].rightIndex).toBe(0)
    expect(pairs[0].similarity).toBeCloseTo(10 / 12)
  })

  it('多对结果按 leftIndex 升序、rightIndex 严格升序（单调）', () => {
    // del [aa, bb, cc] vs add [aa, cc]：bb 被删，cc 错位到 add[1]。
    expect(pairBlock(['aa', 'bb', 'cc'], ['aa', 'cc'])).toEqual([
      { leftIndex: 0, rightIndex: 0, similarity: 1 },
      { leftIndex: 2, rightIndex: 1, similarity: 1 },
    ])
  })

  it('del 多于 add：不相似的 del 行被跳过', () => {
    expect(pairBlock(['aa', 'zz'], ['aa'])).toEqual([
      { leftIndex: 0, rightIndex: 0, similarity: 1 },
    ])
  })
})

/* -------------------------------------------------------------------------- */
/* rowsWithPairing：行骨架 → 'modify' 行                                        */
/* -------------------------------------------------------------------------- */

describe('rowsWithPairing 等长 del/add 块', () => {
  const left = '苹果香蕉橘子\n猫狗鸟鱼'
  const right = '苹果香蕉梨子\n猫狗鼠鱼'

  it('全部配对为 modify：行数减半为 max(del块, add块)，双侧齐全', () => {
    const rows = diffLinesCore(left, right)
    expect(rows.map((r) => r.type)).toEqual(['del', 'del', 'add', 'add'])

    const result = rowsWithPairing(rows)
    expect(result.map((r) => r.type)).toEqual(['modify', 'modify'])
    expect(result).toHaveLength(2) // max(2, 2) = 2，由 4 行减半
    for (const row of result) {
      expect(row.left).toBeDefined()
      expect(row.right).toBeDefined()
    }
  })

  it('words 拼接恒等于各自 text，且只有变化的字标红', () => {
    const result = rowsWithPairing(diffLinesCore(left, right))
    for (const row of result) {
      expect(row.left!.words!.map((s) => s.text).join('')).toBe(row.left!.text)
      expect(row.right!.words!.map((s) => s.text).join('')).toBe(row.right!.text)
    }
    // 第 1 对：橘 → 梨；第 2 对：鸟 → 鼠（其余 token changed: false）。
    expect(result[0].left!.words!.filter((s) => s.changed).map((s) => s.text)).toEqual(['橘'])
    expect(result[0].right!.words!.filter((s) => s.changed).map((s) => s.text)).toEqual(['梨'])
    expect(result[1].left!.words!.filter((s) => s.changed).map((s) => s.text)).toEqual(['鸟'])
    expect(result[1].right!.words!.filter((s) => s.changed).map((s) => s.text)).toEqual(['鼠'])
  })

  it('modify 行内容与行号来自原 del / add 行', () => {
    const rows = diffLinesCore(left, right)
    const result = rowsWithPairing(rows)

    expect(result[0].left).toMatchObject({ lineNo: rows[0].left!.lineNo, text: '苹果香蕉橘子' })
    expect(result[0].right).toMatchObject({ lineNo: rows[2].right!.lineNo, text: '苹果香蕉梨子' })
    expect(result[1].left).toMatchObject({ lineNo: rows[1].left!.lineNo, text: '猫狗鸟鱼' })
    expect(result[1].right).toMatchObject({ lineNo: rows[3].right!.lineNo, text: '猫狗鼠鱼' })
  })
})

describe('rowsWithPairing 不等长 del/add 块', () => {
  it('del 多于 add：配对行合并，剩余 del 保持原样（行数 = max）', () => {
    // del 块 3 行 + add 块 1 行，仅 del[0] 与 add[0] 相似（0.5）。
    const rows = diffLinesCore('你好世界\n猫狗鸟鱼\n平仄平平', '你好地球')
    expect(rows.map((r) => r.type)).toEqual(['del', 'del', 'del', 'add'])

    const result = rowsWithPairing(rows)
    expect(result.map((r) => r.type)).toEqual(['modify', 'del', 'del'])
    expect(result).toHaveLength(3) // max(3, 1) = 3

    // 配对行：双侧齐全，词级 spans 标红变化的字。
    expect(result[0].left).toMatchObject({ lineNo: 1, text: '你好世界' })
    expect(result[0].right).toMatchObject({ lineNo: 1, text: '你好地球' })
    expect(result[0].left!.words!.map((s) => s.text).join('')).toBe('你好世界')
    expect(result[0].right!.words!.map((s) => s.text).join('')).toBe('你好地球')
    expect(result[0].left!.words!.filter((s) => s.changed).map((s) => s.text)).toEqual(['世界'])
    expect(result[0].right!.words!.filter((s) => s.changed).map((s) => s.text)).toEqual(['地球'])

    // 未配对的 del 行：保持原 type 与内容，不填 words。
    expect(result[1]).toMatchObject({ type: 'del', left: { lineNo: 2, text: '猫狗鸟鱼' } })
    expect(result[1].right).toBeUndefined()
    expect(result[1].left!.words).toBeUndefined()
    expect(result[2]).toMatchObject({ type: 'del', left: { lineNo: 3, text: '平仄平平' } })
    expect(result[2].right).toBeUndefined()
    expect(result[2].left!.words).toBeUndefined()
  })

  it('add 多于 del：剩余 add 追加在区域尾部（行数 = max）', () => {
    // del 块 2 行 + add 块 3 行，仅 del[0] 与 add[0] 相似（0.5）。
    // 甲乙丙丁 vs 丁戊己 的相似度 = 2*1/7 ≈ 0.29，低于阈值不配对。
    const rows = diffLinesCore('你好世界\n甲乙丙丁', '你好地球\n丁戊己\n庚辛壬')
    expect(rows.map((r) => r.type)).toEqual(['del', 'del', 'add', 'add', 'add'])

    const result = rowsWithPairing(rows)
    expect(result.map((r) => r.type)).toEqual(['modify', 'del', 'add', 'add'])
    expect(result).toHaveLength(4) // max(2, 3) = 4

    // 配对行在原 del[0] 的位置。
    expect(result[0].type).toBe('modify')
    expect(result[0].left).toMatchObject({ lineNo: 1, text: '你好世界' })
    expect(result[0].right).toMatchObject({ lineNo: 1, text: '你好地球' })
    // 未配对的 del 行保持原骨架位置（modify 之后）。
    expect(result[1]).toMatchObject({ type: 'del', left: { lineNo: 2, text: '甲乙丙丁' } })
    // 未被消费的 add 行按原顺序追加在区域尾部。
    expect(result[2]).toMatchObject({ type: 'add', right: { lineNo: 2, text: '丁戊己' } })
    expect(result[2].left).toBeUndefined()
    expect(result[3]).toMatchObject({ type: 'add', right: { lineNo: 3, text: '庚辛壬' } })
    expect(result[3].left).toBeUndefined()
  })

  it('阈值调高：相似但未达标的行不配对，保持 del/add 原样', () => {
    const rows = diffLinesCore('你好世界\n甲乙丙丁', '你好地球\n丁戊己\n庚辛壬')
    const result = rowsWithPairing(rows, 0.9)

    expect(result.map((r) => r.type)).toEqual(['del', 'del', 'add', 'add', 'add'])
    for (const row of result) {
      expect(row.type === 'del' || row.type === 'add').toBe(true)
      expect(row.left?.words).toBeUndefined()
      expect(row.right?.words).toBeUndefined()
    }
  })
})

describe('rowsWithPairing 无配对区域与多区域', () => {
  it('纯 add / 纯 del：不产出 modify', () => {
    const pureAdd = rowsWithPairing(diffLinesCore('', 'a\nb'))
    expect(pureAdd.map((r) => r.type)).toEqual(['add', 'add'])
    for (const row of pureAdd) {
      expect(row.left).toBeUndefined()
      expect(row.right).toBeDefined()
    }

    const pureDel = rowsWithPairing(diffLinesCore('a\nb', ''))
    expect(pureDel.map((r) => r.type)).toEqual(['del', 'del'])
    for (const row of pureDel) {
      expect(row.left).toBeDefined()
      expect(row.right).toBeUndefined()
    }

    // equal 后跟纯 add：同样没有配对区域。
    const equalThenAdd = rowsWithPairing(diffLinesCore('a', 'a\nb'))
    expect(equalThenAdd.map((r) => r.type)).toEqual(['equal', 'add'])
  })

  it('全部 equal：原样保留，无 modify', () => {
    const rows = diffLinesCore('a\nb', 'a\nb')
    const result = rowsWithPairing(rows)

    expect(result).toEqual(rows)
    expect(result.map((r) => r.type)).toEqual(['equal', 'equal'])
    for (const row of result) {
      expect(row.left!.words).toBeUndefined()
      expect(row.right!.words).toBeUndefined()
    }
  })

  it('多区域交错：每个区域独立配对，equal 行原样保留', () => {
    const rows = diffLinesCore('keep1\n甲乙丙丁\nkeep2\n戊己庚辛', 'keep1\n甲乙丙丁改\nkeep2\n戊己庚辛壬')
    expect(rows.map((r) => r.type)).toEqual(['equal', 'del', 'add', 'equal', 'del', 'add'])

    const result = rowsWithPairing(rows)
    expect(result.map((r) => r.type)).toEqual(['equal', 'modify', 'equal', 'modify'])
    // 区域 1：甲乙丙丁 ↔ 甲乙丙丁改（8/9）；区域 2：戊己庚辛 ↔ 戊己庚辛壬（8/9）。
    expect(result[0]).toMatchObject({ left: { lineNo: 1, text: 'keep1' }, right: { lineNo: 1, text: 'keep1' } })
    expect(result[1].left).toMatchObject({ lineNo: 2, text: '甲乙丙丁' })
    expect(result[1].right).toMatchObject({ lineNo: 2, text: '甲乙丙丁改' })
    expect(result[2]).toMatchObject({ left: { lineNo: 3, text: 'keep2' }, right: { lineNo: 3, text: 'keep2' } })
    expect(result[3].left).toMatchObject({ lineNo: 4, text: '戊己庚辛' })
    expect(result[3].right).toMatchObject({ lineNo: 4, text: '戊己庚辛壬' })
    for (const idx of [1, 3]) {
      expect(result[idx].left!.words!.map((s) => s.text).join('')).toBe(result[idx].left!.text)
      expect(result[idx].right!.words!.map((s) => s.text).join('')).toBe(result[idx].right!.text)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* rowsWithPairing：行号不变量                                                  */
/* -------------------------------------------------------------------------- */

describe('rowsWithPairing 行号不变量', () => {
  it('modify 行的 left.lineNo 来自原 del 行、right.lineNo 来自原 add 行（左右各自独立）', () => {
    const rows = diffLinesCore('你好世界\n甲乙丙丁', '你好地球\n丁戊己\n庚辛壬')
    const delRows = rows.filter((r) => r.type === 'del')
    const addRows = rows.filter((r) => r.type === 'add')
    expect(delRows).toHaveLength(2)
    expect(addRows).toHaveLength(3)

    const result = rowsWithPairing(rows)
    const modify = result.find((r) => r.type === 'modify')!
    expect(modify).toBeDefined()
    // 左侧行号来自原 del[0]，右侧行号来自原 add[0]。
    expect(modify.left!.lineNo).toBe(delRows[0].left!.lineNo)
    expect(modify.right!.lineNo).toBe(addRows[0].right!.lineNo)
    // 未配对行各自保持原行号：del 侧 2，add 侧 2、3。
    const restDel = result.find((r) => r.type === 'del')!
    expect(restDel.left!.lineNo).toBe(delRows[1].left!.lineNo)
    const restAdds = result.filter((r) => r.type === 'add')
    expect(restAdds.map((r) => r.right!.lineNo)).toEqual([
      addRows[1].right!.lineNo,
      addRows[2].right!.lineNo,
    ])
  })
})

/* -------------------------------------------------------------------------- */
/* rowsWithPairing：不可变风格                                                  */
/* -------------------------------------------------------------------------- */

describe('rowsWithPairing 不可变风格', () => {
  it('返回新数组新对象，入参（含嵌套 side）完全不被修改', () => {
    const rows = diffLinesCore('苹果香蕉橘子\n猫狗鸟鱼', '苹果香蕉梨子\n猫狗鼠鱼')
    const before = structuredClone(rows)

    const result = rowsWithPairing(rows)

    // 入参数组逐元素深度不变。
    expect(rows).toEqual(before)
    // 原行的 type 未被改成 modify，原行未携带 words。
    expect(rows.map((r) => r.type)).toEqual(['del', 'del', 'add', 'add'])
    expect(rows[0].left!.words).toBeUndefined()
    expect(rows[2].right!.words).toBeUndefined()
    // 新数组新对象：所有结果行都不是原行对象；modify 行连 side 对象也是新建的。
    expect(result).not.toBe(rows)
    result.forEach((row, idx) => expect(row).not.toBe(rows[idx]))
    expect(result[0].left).not.toBe(rows[0].left)
    expect(result[0].right).not.toBe(rows[2].right)
    // 新对象携带配对结果。
    expect(result[0].type).toBe('modify')
    expect(result[0].left!.words).toBeDefined()
  })
})

/* -------------------------------------------------------------------------- */
/* 与 ENG-003 applyInlineSpans 的共存                                           */
/* -------------------------------------------------------------------------- */

describe('与 ENG-003 applyInlineSpans 共存', () => {
  it('rowsWithPairing 不影响 applyInlineSpans 的既有行为（位置配对 + words），二者互不干扰', () => {
    const rows = diffLinesCore('a\nb1\nc', 'a\nb2\nc')
    const before = structuredClone(rows)

    // ENG-003 既有出口行为不变：位置配对填 words，行骨架 del/add 不合并。
    const inline = applyInlineSpans(rows, 'word')
    expect(inline.map((r) => r.type)).toEqual(['equal', 'del', 'add', 'equal'])
    expect(inline[1].left!.words).toEqual([
      { text: 'b', changed: false },
      { text: '1', changed: true },
    ])
    expect(inline[2].right!.words).toEqual([
      { text: 'b', changed: false },
      { text: '2', changed: true },
    ])

    // ENG-005 出口在同一骨架上产出 modify（b1 vs b2 相似度 = 0.5 ≥ 0.5）。
    const paired = rowsWithPairing(rows)
    expect(paired.map((r) => r.type)).toEqual(['equal', 'modify', 'equal'])
    expect(paired[1].left!.text).toBe('b1')
    expect(paired[1].right!.text).toBe('b2')
    expect(paired[1].left!.words!.map((s) => s.text).join('')).toBe('b1')
    expect(paired[1].right!.words!.map((s) => s.text).join('')).toBe('b2')

    // 两次调用后入参仍然原封不动。
    expect(rows).toEqual(before)
  })
})
