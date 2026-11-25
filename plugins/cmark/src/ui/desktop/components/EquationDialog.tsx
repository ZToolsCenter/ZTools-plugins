/**
 * 公式编辑弹窗
 *
 * 块级公式、行内公式、以及「插入公式」都走这一个弹窗：
 * 上方实时渲染 KaTeX 预览，下方是 LaTeX 文本域。
 *
 * 为什么不用内嵌输入框：公式节点是 void（没有文本子节点），
 * 就地编辑要把组件改成受控输入，光标和 Slate 选区会互相打架；
 * 弹窗是独立 DOM，不受编辑器选区影响，插入和编辑还能共用一套界面。
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import katex from 'katex'

export type EquationDialogPayload = {
  /** 初始 LaTeX */
  tex: string
  /** 标题，默认「编辑公式」 */
  title?: string
  /** 确定后回调；插入场景由调用方负责插节点 */
  onApply: (tex: string) => void
}

const listeners = new Set<(p: EquationDialogPayload) => void>()
let pending: EquationDialogPayload | null = null

/**
 * 打开公式弹窗。
 * 编辑器还没挂载宿主时先存起来，等 Host 挂载后立刻弹出。
 */
export function openEquationDialog(payload: EquationDialogPayload) {
  if (listeners.size === 0) {
    pending = payload
    return
  }
  listeners.forEach((fn) => fn(payload))
}

export function EquationDialogHost() {
  const [payload, setPayload] = useState<EquationDialogPayload | null>(null)
  const [tex, setTex] = useState('')
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const payloadRef = useRef<EquationDialogPayload | null>(null)

  payloadRef.current = payload

  useEffect(() => {
    const fn = (p: EquationDialogPayload) => {
      setPayload(p)
      setTex(p.tex || '')
    }
    listeners.add(fn)
    if (pending) {
      fn(pending)
      pending = null
    }
    return () => {
      listeners.delete(fn)
    }
  }, [])

  useEffect(() => {
    if (!payload) return
    const t = setTimeout(() => {
      areaRef.current?.focus()
      const len = areaRef.current?.value.length || 0
      areaRef.current?.setSelectionRange(len, len)
    }, 30)
    return () => clearTimeout(t)
  }, [payload])

  const close = () => setPayload(null)

  const apply = () => {
    const p = payloadRef.current
    if (p) {
      try {
        p.onApply(tex)
      } catch (e) {
        console.error('[equation-dialog]', e)
      }
    }
    setPayload(null)
  }

  useEffect(() => {
    if (!payload) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        setPayload(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [payload])

  let preview = ''
  if (payload) {
    try {
      preview = katex.renderToString(tex.trim() || '\\;', { throwOnError: false, displayMode: true })
    } catch (e) {
      preview = ''
    }
  }

  if (!payload) return null

  return createPortal(
    <div className="eq-mask" onMouseDown={close}>
      <div className="eq-dialog" onMouseDown={(ev) => ev.stopPropagation()}>
        <div className="eq-head">
          <span className="eq-title">{payload.title || '编辑公式'}</span>
          <button type="button" className="eq-x" onClick={close} title="关闭">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="eq-preview" dangerouslySetInnerHTML={{ __html: preview }} />
        {tex.trim() ? null : <div className="eq-empty">上方会实时显示公式效果</div>}

        <textarea
          ref={areaRef}
          className="eq-input"
          value={tex}
          spellCheck={false}
          placeholder="在这里输入 LaTeX，例如 \frac{a}{b} 或 \int_0^1 x^2\,dx"
          onChange={(ev) => setTex(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
              ev.preventDefault()
              apply()
            }
          }}
        />

        <div className="eq-foot">
          <span className="eq-hint">Ctrl+Enter 确定 · Esc 取消</span>
          <button type="button" className="eq-btn" onClick={close}>
            取消
          </button>
          <button type="button" className="eq-btn primary" onClick={apply}>
            确定
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}