/**
 * 首次使用引导：选目录 → 认识现有文件 → 决定是否启用版本控制
 *
 * 只在还没有做过引导时出现（.cmark/onboard.json 里没记录），
 * 已经用起来的用户永远不会看到它。
 *
 * 全部走 ports：插件端是 preload 桥、桌面端是 Rust 命令。
 * 之前这里直接调 window.__CMARK 的同步方法，独立端没有那套桥，
 * 结果每次都判成「没做过引导」；而「跳过」写的 done 也落不了盘，
 * 紧接着 location.reload()，表现就是关不掉的无限弹窗。
 */
import { useCallback, useEffect, useState } from 'react'
import { useNotes } from '../../../service/store/notes'
import { getPorts } from '../../../runtime/ports'
import type { TreeNode } from '../../../types/global.d.ts'

/** 递归数树里的笔记数（readAll 在大库上太慢，引导只要个大概） */
function countNotes(nodes: TreeNode[]): number {
  let n = 0
  for (const node of nodes) {
    if (node.type === 'note') n++
    if (node.children?.length) n += countNotes(node.children)
  }
  return n
}

export function Onboard() {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [ws, setWs] = useState('')
  const [count, setCount] = useState(0)
  const [isRepo, setIsRepo] = useState(false)
  const [busy, setBusy] = useState(false)
  const refreshTree = useNotes((s) => s.refreshTree)

  const probe = useCallback(async () => {
    try {
      const tree = await getPorts().ws.listTree()
      setCount(countNotes(tree.children || []))
    } catch (e) {}
    try {
      const d = await getPorts().vcs.detect()
      setIsRepo(!!(d.ok && d.value?.repoRoot))
    } catch (e) {}
  }, [])

  const markDone = useCallback(async () => {
    try {
      await getPorts().ws.writeOnboard({ done: true, at: Date.now() })
    } catch (e) {}
  }, [])

  useEffect(() => {
    void (async () => {
      const wsPort = getPorts().ws
      // onboard.json 里有 done 就再也不会出现
      try {
        const ob = await wsPort.readOnboard()
        if ((ob as { done?: boolean } | undefined)?.done) return
      } catch (e) {}

      // 已经绑定过工作区（老用户从插件端带过来的配置）就不打扰
      const root = wsPort.root()
      if (root) {
        try {
          if (await wsPort.isReady()) {
            await markDone()
            return
          }
        } catch (e) {}
      }

      setOpen(true)
      setWs(root || '')
      await probe()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pick = useCallback(async () => {
    const picked = await getPorts().ws.pick()
    if (!picked.ok || !picked.value) return
    const adopted = await getPorts().ws.adopt(picked.value)
    if (!adopted.ok) return
    setWs(picked.value)
    await probe()
  }, [probe])

  const finish = useCallback(async () => {
    await markDone()
    setOpen(false)
    refreshTree()
    void useNotes.getState().buildIndex()
  }, [markDone, refreshTree])

  if (!open) return null

  return (
    <div className="onboard-mask">
      <div className="onboard">
        <div className="ob-head">
          <span className="ob-title">开始使用 CMark</span>
          <span className="ob-step">{step + 1} / 3</span>
        </div>

        <div className="ob-body">
          {step === 0 ? (
            <>
              <p className="ob-lead">笔记以纯 Markdown 文件保存在你这个目录里，随时可以用其它编辑器打开。</p>
              <div className="ob-ws">
                <span className="ob-ws-icon">
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3">
                    <path d="M1.8 4.2h4.4l1.2 1.6h6.8v6.4H1.8z" />
                  </svg>
                </span>
                <span className="ob-ws-path" title={ws}>
                  {ws || '尚未选择'}
                </span>
                <button type="button" className="gp-b" onClick={() => void pick()}>
                  {ws ? '更换' : '选择目录'}
                </button>
              </div>
              <p className="ob-hint">默认会用文档目录下的 CMark 文件夹。</p>
            </>
          ) : step === 1 ? (
            <>
              <p className="ob-lead">
                {count > 0 ? `这里已经有 ${count} 篇 Markdown 笔记，会直接读进来。` : '这个目录还是空的，可以从头开始。'}
              </p>
              <ul className="ob-list">
                <li>
                  <b>{count}</b> 篇笔记
                </li>
                <li>
                  版本控制 <b>{isRepo ? '已启用' : '未启用'}</b>
                </li>
              </ul>
              {!isRepo ? (
                <p className="ob-hint">
                  启用后每次改动都会留有历史，可以回溯任意版本；不启用也能正常写笔记，之后在设置里随时可以开。
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="ob-lead">准备就绪。</p>
              <ul className="ob-list">
                <li>左侧目录树右键可以新建笔记与文件夹</li>
                <li>Ctrl+F 搜索，Ctrl+B 加粗，Ctrl+1/2/3 标题</li>
                <li>顶部工具栏可以插入表格、代码块、图片</li>
              </ul>
            </>
          )}
        </div>

        <div className="ob-acts">
          {step > 0 ? (
            <button type="button" className="gp-b" onClick={() => setStep((v) => v - 1)}>
              上一步
            </button>
          ) : null}
          <span style={{ flex: 1 }} />
          <button type="button" className="gp-b" onClick={() => void finish()}>
            跳过
          </button>
          {step === 1 && !isRepo ? (
            <button
              type="button"
              className="gp-b"
              disabled={busy || !ws}
              onClick={async () => {
                setBusy(true)
                try {
                  const r = await getPorts().vcs.init()
                  if (r.ok) setIsRepo(true)
                } finally {
                  setBusy(false)
                }
              }}
            >
              启用版本控制
            </button>
          ) : null}
          <button
            type="button"
            className="gp-b primary"
            disabled={step === 0 && !ws}
            onClick={() => (step < 2 ? setStep((v) => v + 1) : void finish())}
          >
            {step < 2 ? '下一步' : '开始使用'}
          </button>
        </div>
      </div>
    </div>
  )
}
