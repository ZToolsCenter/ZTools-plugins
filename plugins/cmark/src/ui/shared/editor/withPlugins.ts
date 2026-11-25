/**
 * Slate 插件：键盘行为
 *
 * 覆盖 V1.0.0 的全部编辑快捷键，并处理代码块/表格/列表的结构性按键：
 *   Enter 在代码块内换行而不是分裂块；Tab 在表格内跳格、在列表内缩进；
 *   Backspace 在空列表项/空引用/空标题上退回普通段落。
 */
import {
  Editor,
  Element as SlateElement,
  Node,
  Path,
  Range,
  Transforms,
  type BaseEditor,
  type NodeEntry,
} from 'slate'
import type { ReactEditor } from 'slate-react'
import type { HistoryEditor } from 'slate-history'
import type { CMarkElement } from '../../../core/domain/slate-model'
import { isBlockElement } from '../../../core/domain/slate-model'

type Ed = BaseEditor & ReactEditor & HistoryEditor

const LIST_TYPES = ['bulleted-list', 'numbered-list']
const TEXT_ALIGN_NONE = undefined

/* ---------------- 通用工具 ---------------- */

function isList(n: unknown): boolean {
  return !!n && typeof n === 'object' && LIST_TYPES.includes((n as { type?: string }).type || '')
}

function isType(n: unknown, type: string): boolean {
  return !!n && typeof n === 'object' && (n as { type?: string }).type === type
}

/** 当前选区所在的块级节点（跳过 table-row / table-cell / list-item 这类容器） */
export function currentBlock(editor: Ed): NodeEntry<CMarkElement> | null {
  const { selection } = editor
  if (!selection) return null
  const [match] = Array.from(
    Editor.nodes(editor, {
      at: selection,
      match: (n) => SlateElement.isElement(n) && isBlockElement(n),
      mode: 'lowest',
    })
  ) as NodeEntry<CMarkElement>[]
  return match || null
}

/** 当前选区所在的列表容器（bulleted-list / numbered-list） */
export function currentList(editor: Ed): NodeEntry<CMarkElement> | null {
  const { selection } = editor
  if (!selection) return null
  const [match] = Array.from(
    Editor.nodes(editor, { at: selection, match: (n) => isList(n), mode: 'lowest' })
  ) as NodeEntry<CMarkElement>[]
  return match || null
}

export function currentTableCell(editor: Ed): NodeEntry<CMarkElement> | null {
  const { selection } = editor
  if (!selection) return null
  const [match] = Array.from(
    Editor.nodes(editor, { at: selection, match: (n) => isType(n, 'table-cell'), mode: 'lowest' })
  ) as NodeEntry<CMarkElement>[]
  return match || null
}

function setBlock(editor: Ed, props: Record<string, unknown>): void {
  Transforms.setNodes(editor, props as never, {
    match: (n) => SlateElement.isElement(n) && isBlockElement(n),
  })
}

/* ---------------- 块操作 ---------------- */

export function toggleHeading(editor: Ed, level: 1 | 2 | 3 | 4 | 5 | 6): void {
  const cur = currentBlock(editor)
  const same = cur && isType(cur[0], 'heading') && (cur[0] as { level?: number }).level === level
  setBlock(editor, same ? { type: 'paragraph' } : { type: 'heading', level })
}

export function toggleBlockquote(editor: Ed): void {
  const cur = currentBlock(editor)
  const same = cur && isType(cur[0], 'blockquote')
  setBlock(editor, { type: same ? 'paragraph' : 'blockquote' })
}

export function toggleParagraph(editor: Ed): void {
  setBlock(editor, { type: 'paragraph' })
}

/**
 * 列表切换：同类型再点一次取消、跨类型直接替换、不在列表里才新建。
 * 早期实现每次都 wrap，导致"ul 里套 ul"，这里必须按状态分支。
 */
export function toggleList(editor: Ed, kind: 'bulleted-list' | 'numbered-list' | 'task-list'): void {
  const want = kind === 'numbered-list' ? 'numbered-list' : 'bulleted-list'
  const isTask = kind === 'task-list'
  const cur = currentList(editor)

  if (cur) {
    const [, listPath] = cur
    const curType = (cur[0] as { type: string }).type
    const curItem = currentBlock(editor)
    const curChecked = curItem ? (curItem[0] as { checked?: boolean }).checked : undefined

    // 注意：所有 setNodes 都必须带 at + mode:'all'。
    // 只给 match 时 Slate 默认 at=selection、mode=lowest，只会改光标所在的那一项，
    // 结果是 3 项列表里只有 1 项变成任务项，其余仍是普通 li。
    const itemMatch = (n: unknown) =>
      SlateElement.isElement(n) && isType(n, 'list-item')

    if (curType === want && (isTask ? curChecked !== undefined : curChecked === undefined)) {
      // 同类型 → 取消列表。先把整棵子树的 list-item 都改回段落，
      // 再 unwrap，否则 unwrap 之后只剩光标那一项被改，其余变成根级裸 li
      Transforms.setNodes(
        editor,
        { type: 'paragraph', checked: undefined } as never,
        { at: listPath, match: itemMatch, mode: 'all' } as never
      )
      Transforms.unwrapNodes(editor, { match: (n) => isList(n), split: true })
      return
    }
    if (curType !== want) {
      Transforms.setNodes(editor, { type: want } as never, { at: listPath })
    }
    // 任务态作用于整个列表的所有项
    Transforms.setNodes(
      editor,
      (isTask ? { checked: false } : { checked: undefined }) as never,
      { at: listPath, match: itemMatch, mode: 'all' } as never
    )
    return
  }

  Transforms.setNodes(
    editor,
    (isTask ? { type: 'list-item', checked: false } : { type: 'list-item' }) as never,
    { match: (n) => SlateElement.isElement(n) && isBlockElement(n) }
  )
  Transforms.wrapNodes(editor, { type: want, children: [] } as never, {
    match: (n) => SlateElement.isElement(n) && isType(n, 'list-item'),
    split: true,
  })
}

/* ---------------- 表格 ---------------- */

export function insertTable(editor: Ed, rows = 2, cols = 2): void {
  const cell = (t: string) => ({ type: 'table-cell', children: [{ text: t }] })
  const body = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => cell(r === 0 ? `列 ${c + 1}` : ''))
  )
  Transforms.insertNodes(editor, {
    type: 'table',
    children: body.map((cells) => ({ type: 'table-row', children: cells })),
  } as never)
  Transforms.insertNodes(editor, { type: 'paragraph', children: [{ text: '' }] } as never)
}

/** 表格内 Tab：同行下一格，末格跳到下一行首格，末行末格追加一行 */
function tableTab(editor: Ed, reverse: boolean): boolean {
  const cell = currentTableCell(editor)
  if (!cell) return false
  const [, cellPath] = cell
  const rowPath = Path.parent(cellPath)
  const tablePath = Path.parent(rowPath)
  const table = Node.get(editor, tablePath) as { children: { children: unknown[] }[] }
  const rowIdx = rowPath[rowPath.length - 1]
  const colIdx = cellPath[cellPath.length - 1]
  // 列数以「当前行」为准：增删列、或某行被撑宽后会变成 ragged，
  // 拿首行列数算路径会指到不存在的格子上，Node.get 直接抛错
  const rowOf = (i: number) => (table.children[i] as { children: unknown[] } | undefined)?.children?.length || 0
  const colCount = rowOf(rowIdx) || 1
  const headCols = rowOf(0) || 1

  let nextRow = rowIdx
  let nextCol = reverse ? colIdx - 1 : colIdx + 1
  if (!reverse && nextCol >= colCount) {
    nextCol = 0
    nextRow = rowIdx + 1
  }
  if (reverse && nextCol < 0) {
    nextRow = rowIdx - 1
    nextCol = Math.max(0, rowOf(nextRow) - 1)
  }
  if (nextRow >= table.children.length) {
    // 末行末格：补一行（列数按表头，保证新行是规整的）
    Transforms.insertNodes(
      editor,
      {
        type: 'table-row',
        children: Array.from({ length: headCols }, () => ({
          type: 'table-cell',
          children: [{ text: '' }],
        })),
      } as never,
      { at: [...tablePath, table.children.length] }
    )
  } else if (nextRow < 0) {
    // 第一个格 Shift+Tab：把焦点放回第一个格，别吞掉按键
    Transforms.select(editor, Editor.start(editor, [...tablePath, 0, 0, 0]))
    return true
  }
  const target = [...tablePath, nextRow, Math.max(0, Math.min(nextCol, (rowOf(nextRow) || 1) - 1))]
  try {
    Transforms.select(editor, Editor.end(editor, [...target, 0]))
  } catch (e) {
    Transforms.select(editor, Editor.start(editor, [...tablePath, 0, 0, 0]))
  }
  return true
}

/* ---------------- 主插件 ---------------- */

export function withShortcuts(editor: Ed): Ed {
  const { insertBreak, insertText, deleteBackward, insertFragment } = editor

  // Enter 在代码块内插入换行，不分裂块
  editor.insertBreak = () => {
    const cur = currentBlock(editor)
    if (cur && isType(cur[0], 'codeblock')) {
      Transforms.insertText(editor, '\n')
      return
    }
    // 单元格里回车：Slate 默认会 splitNodes 把 cell 拆成两个，行被撑宽、列数不齐，
    // 后续 tableTab 按首行列数算路径就会越界。这里改成插入软换行。
    if (currentTableCell(editor)) {
      Transforms.insertText(editor, '\n')
      return
    }
    insertBreak()
  }

  // Backspace：空列表项退出列表、空引用/空标题退回段落
  editor.deleteBackward = (unit) => {
    const { selection } = editor
    if (selection && Range.isCollapsed(selection)) {
      const cur = currentBlock(editor)
      if (cur) {
        const [node, path] = cur
        const text = Node.string(node)
        const atStart = Editor.start(editor, path)
        if (text === '' && Range.isCollapsed(selection) && Path.equals(selection.anchor.path, atStart.path)) {
          if (isType(node, 'list-item')) {
            Transforms.unwrapNodes(editor, { match: (n) => isList(n), split: true })
            Transforms.setNodes(editor, { type: 'paragraph', checked: undefined } as never)
            return
          }
          if (isType(node, 'blockquote') || isType(node, 'heading')) {
            Transforms.setNodes(editor, { type: 'paragraph' } as never)
            return
          }
          if (isType(node, 'codeblock')) {
            Transforms.setNodes(editor, { type: 'paragraph' } as never)
            return
          }
        }
      }
    }
    deleteBackward(unit)
  }

  // Markdown 快捷输入：在段首输入标记 + 空格，直接转换块类型
  editor.insertText = (text) => {
    const { selection } = editor
    if (text === ' ' && selection && Range.isCollapsed(selection)) {
      const cur = currentBlock(editor)
      if (cur && isType(cur[0], 'paragraph')) {
        const [node] = cur
        const before = Node.string(node)
        const rules: [RegExp, () => void][] = [
          [/^(#{1,6})$/, () => toggleHeading(editor, Math.min(6, before.length) as 1 | 2 | 3)],
          [/^[-*+]$/, () => toggleList(editor, 'bulleted-list')],
          [/^>$/, () => toggleBlockquote(editor)],
          [/^\[\]$/, () => toggleList(editor, 'task-list')],
          [/^1\.$/, () => toggleList(editor, 'numbered-list')],
        ]
        for (const [re, run] of rules) {
          if (re.test(before)) {
            Transforms.delete(editor, { distance: before.length, unit: 'character', reverse: true })
            run()
            return
          }
        }
      }
    }
    insertText(text)
  }

  // 粘贴：纯文本按行拆块（保留结构），代码块内原样插入
  editor.insertFragment = (fragment) => {
    const cur = currentBlock(editor)
    if (cur && isType(cur[0], 'codeblock')) {
      const text = fragment.map((n) => Node.string(n)).join('\n')
      Transforms.insertText(editor, text)
      return
    }
    insertFragment(fragment)
  }

  return editor
}

/** 键盘事件处理：返回 true 表示已消费 */
export function handleKeyDown(
  editor: Ed,
  e: React.KeyboardEvent,
  actions: {
    toggleMark: (m: 'bold' | 'italic' | 'underline' | 'code' | 'strike' | 'highlight') => void
    setLink: () => void
    toggleBlock: (kind: 'paragraph' | 'blockquote' | 'bulleted-list' | 'numbered-list' | 'task-list' | 'heading', level?: number) => void
    insertNode: (kind: 'codeblock' | 'table' | 'hr' | 'math') => void
  }
): boolean {
  // 中文输入法正在组合（拼音还没上屏）时不能劫持按键，否则打字会误触发加粗/标题
  const native = e.nativeEvent as unknown as { isComposing?: boolean; keyCode?: number }
  if (native.isComposing || native.keyCode === 229) return false

  const ctrl = e.ctrlKey || e.metaKey

  // Tab：代码块缩进 / 表格跳格 / 列表缩进
  if (e.key === 'Tab') {
    const nowBlock = currentBlock(editor)
    if (nowBlock && isType(nowBlock[0], 'codeblock')) {
      e.preventDefault()
      Transforms.insertText(editor, e.shiftKey ? '' : '  ')
      if (e.shiftKey) {
        // 退格两格：把光标前的空格删掉
        const { selection } = editor
        if (selection) {
          for (let k = 0; k < 2; k++) {
            const before = Editor.before(editor, selection, { unit: 'character' })
            if (!before) break
            const ch = Editor.string(editor, { anchor: before, focus: selection.anchor })
            if (ch !== ' ') break
            Transforms.delete(editor, { distance: 1, unit: 'character', reverse: true })
          }
        }
      }
      return true
    }
    if (tableTab(editor, e.shiftKey)) {
      e.preventDefault()
      return true
    }
    const cur = currentBlock(editor)
    if (cur && isType(cur[0], 'list-item')) {
      e.preventDefault()
      const [, itemPath] = cur
      if (e.shiftKey) {
        // 反缩进：把这一项从内层列表里拎出来
        const parentPath = Path.parent(Path.parent(itemPath))
        if (parentPath.length === 0) return true
        const listNode = Node.get(editor, parentPath) as { type: string }
        Transforms.unwrapNodes(editor, { match: (n) => isList(n), split: true })
        void listNode
      } else {
        // 缩进：必须是同层里第二项之后，否则没有可以挂靠的父项
        const idx = itemPath[itemPath.length - 1]
        if (idx === 0) return true
        const listPath = Path.parent(itemPath)
        const list = Node.get(editor, listPath) as { type: string }
        Transforms.wrapNodes(editor, { type: list.type, children: [] } as never)
      }
      return true
    }
  }

  if (!ctrl) return false

  // Ctrl+Shift+X
  if (e.shiftKey) {
    // 括号键要用 e.code：按住 Shift 时 e.key 是 { 和 }，按 key 匹配永远不命中
    if (e.code === 'BracketLeft') {
      e.preventDefault()
      actions.toggleBlock('numbered-list')
      return true
    }
    if (e.code === 'BracketRight') {
      e.preventDefault()
      actions.toggleBlock('bulleted-list')
      return true
    }
    // Ctrl+Shift+B 不加粗也不该让浏览器开书签栏
    if (e.key.toUpperCase() === 'B') {
      e.preventDefault()
      return true
    }
    switch (e.key.toUpperCase()) {
      case 'K':
        e.preventDefault()
        actions.insertNode('codeblock')
        return true
      case 'O':
        e.preventDefault()
        actions.toggleBlock('task-list')
        return true
      case 'Q':
        e.preventDefault()
        actions.toggleBlock('blockquote')
        return true
      default:
        return false
    }
  }

  // Ctrl+X
  switch (e.key.toLowerCase()) {
    case 'b':
      e.preventDefault()
      actions.toggleMark('bold')
      return true
    case 'i':
      e.preventDefault()
      actions.toggleMark('italic')
      return true
    case 'u':
      e.preventDefault()
      actions.toggleMark('underline')
      return true
    case 'k':
      e.preventDefault()
      actions.setLink()
      return true
    case 't':
      e.preventDefault()
      actions.insertNode('table')
      return true
    case 'e':
      e.preventDefault()
      actions.toggleMark('code')
      return true
    case '0':
      e.preventDefault()
      actions.toggleBlock('paragraph')
      return true
    case '1':
    case '2':
    case '3':
    case '4':
    case '5':
    case '6':
      e.preventDefault()
      actions.toggleBlock('heading', Number(e.key))
      return true
    default:
      return false
  }
}

export { TEXT_ALIGN_NONE }