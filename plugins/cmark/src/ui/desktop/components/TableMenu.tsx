/**
 * 表格右键菜单：9 项操作 + 列对齐
 *
 * 进入方式：在表格单元格内右键。菜单定位在鼠标处，点空白关闭。
 */
import { useEffect, useRef } from 'react'
import { Editor, Node as SlateNode, Path, Transforms, type BaseEditor } from 'slate'
import type { ReactEditor } from 'slate-react'
import type { HistoryEditor } from 'slate-history'

type Ed = BaseEditor & ReactEditor & HistoryEditor

type Props = {
  x: number
  y: number
  cellPath: number[]
  editor: Ed
  onClose: () => void
}

type TableNode = { align?: string[]; children: { children: unknown[] }[] }

export function TableMenu({ x, y, cellPath, editor, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as globalThis.Node)) onClose()
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onEsc)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onEsc)
    }
  }, [onClose])

  const tablePath = Path.parent(Path.parent(cellPath))
  const rowIdx = cellPath[cellPath.length - 2]
  const colIdx = cellPath[cellPath.length - 1]
  const table = SlateNode.get(editor, tablePath) as TableNode
  const colCount = table.children[0]?.children.length || 1

  const emptyCell = () => ({ type: 'table-cell', children: [{ text: '' }] })

  function insertRow(offset: 0 | 1) {
    const at = [...tablePath, rowIdx + offset]
    Transforms.insertNodes(
      editor,
      {
        type: 'table-row',
        children: Array.from({ length: colCount }, emptyCell),
      } as never,
      { at }
    )
    onClose()
  }

  function deleteRow() {
    if ((table.children as unknown[]).length <= 1) {
      onClose()
      return
    }
    Transforms.removeNodes(editor, { at: [...tablePath, rowIdx] })
    onClose()
  }

  function insertCol(offset: 0 | 1) {
    const rows = table.children.length
    for (let r = 0; r < rows; r++) {
      Transforms.insertNodes(editor, emptyCell() as never, {
        at: [...tablePath, r, colIdx + offset],
      })
    }
    onClose()
  }

  function deleteCol() {
    if (colCount <= 1) {
      onClose()
      return
    }
    const rows = table.children.length
    for (let r = rows - 1; r >= 0; r--) {
      Transforms.removeNodes(editor, { at: [...tablePath, r, colIdx] })
    }
    onClose()
  }

  function deleteTable() {
    Transforms.removeNodes(editor, { at: tablePath })
    onClose()
  }

  function setAlign(a: '' | 'left' | 'center' | 'right') {
    const next = [...(table.align || Array.from({ length: colCount }, () => ''))]
    while (next.length < colCount) next.push('')
    next[colIdx] = a
    Transforms.setNodes(editor, { align: next } as never, { at: tablePath })
    onClose()
  }

  const item = (label: string, run: () => void, danger = false) => (
    <button
      key={label}
      type="button"
      className={'tm-item' + (danger ? ' tm-danger' : '')}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {label}
    </button>
  )

  return (
    <div
      ref={ref}
      className="table-menu"
      style={{ left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {item('上方插入行', () => insertRow(0))}
      {item('下方插入行', () => insertRow(1))}
      {item('左侧插入列', () => insertCol(0))}
      {item('右侧插入列', () => insertCol(1))}
      <div className="tm-sep" />
      {item('删除本行', deleteRow, true)}
      {item('删除本列', deleteCol, true)}
      {item('删除整个表格', deleteTable, true)}
      <div className="tm-sep" />
      <div className="tm-label">列对齐</div>
      <div className="tm-row">
        <button type="button" className="tm-mini" onClick={() => setAlign('left')}>
          左
        </button>
        <button type="button" className="tm-mini" onClick={() => setAlign('center')}>
          中
        </button>
        <button type="button" className="tm-mini" onClick={() => setAlign('right')}>
          右
        </button>
        <button type="button" className="tm-mini" onClick={() => setAlign('')}>
          默认
        </button>
      </div>
    </div>
  )
}

void Editor