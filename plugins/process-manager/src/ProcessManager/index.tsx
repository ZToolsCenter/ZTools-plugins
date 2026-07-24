import { useState, useRef, useEffect, useCallback } from 'react'
import { FiRefreshCw } from 'react-icons/fi'
import './index.css'
import { searchProcesses } from './search'
import { useProcessData, CACHE_TTL } from './useProcessData'

interface Props {
  keyword: string
}

export default function ProcessManager({ keyword }: Props) {
  const { processes, loading, refresh, lastUpdated } = useProcessData()
  const [toast, setToast] = useState('')
  const [killModal, setKillModal] = useState<{ pid: number; name: string } | null>(null)
  const [killing, setKilling] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)
  const startRef = useRef(0)
  const rafRef = useRef(0)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    const fill = barRef.current
    if (!fill) return
    const tick = () => {
      const pct = Math.min((Date.now() - startRef.current) / CACHE_TTL * 100, 100)
      fill.style.width = pct + '%'
      rafRef.current = requestAnimationFrame(tick)
    }
    startRef.current = Date.now()
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  useEffect(() => {
    startRef.current = Date.now()
  }, [lastUpdated])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 1500)
  }, [])

  const copy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => showToast('已复制: ' + text))
  }, [showToast])

  const confirmKill = useCallback((pid: number, name: string) => {
    setKillModal({ pid, name })
  }, [])

  const executeKill = useCallback(async () => {
    if (!killModal || killing) return

    setKilling(true)
    const result = await window.services.killProcess(killModal.pid)
    setKilling(false)
    setKillModal(null)

    if (result.success) {
      showToast(`已 Kill ${killModal.name} (PID: ${killModal.pid})`)
      refresh(true)
    } else {
      showToast(`Kill 失败: ${result.error}`)
    }
  }, [killModal, killing, showToast, refresh])

  const cancelKill = useCallback(() => {
    if (killing) return
    setKillModal(null)
  }, [killing])

  const handleContextMenu = useCallback((e: React.MouseEvent, pid: number, name: string) => {
    e.preventDefault()
    confirmKill(pid, name)
  }, [confirmKill])

  const filtered = searchProcesses(keyword, processes)

  return (
    <div className="pm">
      <div className="pm-header">
        <div className="pm-hints">
          <span className="pm-hint pm-hint-name">进程名</span>
          <span className="pm-hint pm-hint-pid">PID</span>
          <span className="pm-hint pm-hint-port">端口号</span>
          <span className="pm-hint pm-hint-path">文件路径</span>
        </div>
        <span className="pm-hint pm-hint-tip">右键可 Kill 进程</span>
      </div>

      {toast && <div className="pm-toast">{toast}</div>}

      <div className="pm-body">
        {loading && processes.length === 0 && (
          <div className="pm-empty">正在获取进程列表...</div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="pm-empty">
            {keyword ? '没有匹配的进程' : '暂无进程数据，请刷新'}
          </div>
        )}

        {filtered.map(p => (
          <div
            className="pm-item"
            key={p.pid}
            onContextMenu={(e) => handleContextMenu(e, p.pid, p.name)}
          >
            <div className="pm-item-top">
              <div className="pm-item-info">
                <div className="pm-item-row1">
                  <span className="pm-tag pm-tag-name" onClick={() => copy(p.name)}>{p.name}</span>
                  <span className="pm-tag pm-tag-pid" onClick={() => copy(String(p.pid))}>{p.pid}</span>
                  <span className="pm-path" onClick={() => copy(p.path)} title={p.path}>{p.path}</span>
                </div>
                <div className="pm-tags">
                  {p.ports.length > 0
                    ? p.ports.map(port => (
                        <span key={port} className="pm-tag pm-tag-port" onClick={() => copy(String(port))}>{port}</span>
                      ))
                    : <span className="pm-tag pm-tag-none">无端口占用</span>
                  }
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="pm-footer">
        <span>共 {filtered.length} 个结果</span>
        <span className="pm-footer-right">
          <span className="pm-updated">{lastUpdated || '--:--:--'}</span>
          <span className="pm-progress-tag"><span className="pm-progress-fill" ref={barRef} /></span>
          <button className="pm-refresh" onClick={() => refresh(true)}>
            <FiRefreshCw size={13} />
          </button>
        </span>
      </div>

      {killModal && (
        <div className="pm-modal-overlay" onClick={killing ? undefined : cancelKill}>
          <div className="pm-modal" onClick={e => e.stopPropagation()}>
            <div className="pm-modal-title">确认 Kill 进程</div>
            <div className="pm-modal-content">
              {killing
                ? <>正在 Kill <strong>{killModal.name}</strong> (PID: {killModal.pid})...</>
                : <>确定要 Kill 进程 <strong>{killModal.name}</strong> (PID: {killModal.pid}) 吗？</>
              }
            </div>
            <div className="pm-modal-actions">
              <button className="pm-modal-btn pm-modal-btn-cancel" onClick={cancelKill} disabled={killing}>取消</button>
              <button className="pm-modal-btn pm-modal-btn-confirm" onClick={executeKill} disabled={killing}>
                {killing ? '正在 Kill...' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
