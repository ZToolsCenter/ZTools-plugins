/**
 * 分支栏：侧边栏顶部 36px 的 git 状态条
 *
 * 布局对齐 V1.0.0 的 branch-bar.js：
 *   [⎇ 分支名 ·脏点] [拉取] [推送] [同步]
 * 左侧按钮只显示"我在哪"，点击打开工作区变更记录；不提供切换分支，
 * 因为笔记场景不需要分支工作流（这是 V1.0.0 定下的取舍）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { gitBridge } from '../../../runtime/legacy-bridge'

type GitState = { ok?: boolean; data?: { branch?: string; isRepo?: boolean; dirty?: number; ahead?: number; behind?: number } }
type GitResult = { ok?: boolean; message?: string; data?: { local?: boolean } }

type GitApi = {
  state?: () => Promise<GitState>
  pull?: () => Promise<GitResult>
  push?: () => Promise<GitResult>
  sync?: () => Promise<GitResult>
}

function git(): GitApi | undefined {
  return gitBridge() as unknown as GitApi | undefined
}

const ICON = {
  branch: (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
      <path d="M5 3.25a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0zM3.75 5.9a2.75 2.75 0 1 0-1.5 0v4.2a2.75 2.75 0 1 0 1.5 0V8.5h3.5a2.5 2.5 0 0 0 2.5-2.5V5.9a2.75 2.75 0 1 0-1.5 0v.1a1 1 0 0 1-1 1h-3.5zM12.25 5.15a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5zM4.5 13.05a1.25 1.25 0 1 0-1.5-1.24v1.24z" />
    </svg>
  ),
  pull: (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
      <path d="M8 1.5a.75.75 0 0 1 .75.75v6.94l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06l2.22 2.22V2.25A.75.75 0 0 1 8 1.5zM2.5 12.5a.75.75 0 0 1 .75.75v.25h9.5v-.25a.75.75 0 0 1 1.5 0v1a.75.75 0 0 1-.75.75H2.5a.75.75 0 0 1-.75-.75v-1a.75.75 0 0 1 .75-.75z" />
    </svg>
  ),
  push: (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
      <path d="M8 14.5a.75.75 0 0 1-.75-.75V6.81L5.03 9.03a.75.75 0 0 1-1.06-1.06l3.5-3.5a.75.75 0 0 1 1.06 0l3.5 3.5a.75.75 0 1 1-1.06 1.06L8.75 6.81v6.94a.75.75 0 0 1-.75.75zM2.5 2.5a.75.75 0 0 1 .75-.75h9.5a.75.75 0 0 1 .75.75v1a.75.75 0 0 1-1.5 0v-.25h-9.5v.25a.75.75 0 0 1-1.5 0v-1z" />
    </svg>
  ),
  sync: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z" />
    </svg>
  ),
}

export function BranchBar({ onOpenPanel }: { onOpenPanel: () => void }) {
  const [branch, setBranch] = useState('—')
  const [isRepo, setIsRepo] = useState(false)
  const [dirty, setDirty] = useState(0)
  const [busy, setBusy] = useState<'pull' | 'push' | 'sync' | null>(null)
  const aliveRef = useRef(true)

  const refresh = useCallback(async () => {
    const G = git()
    if (!G?.state) {
      setBranch('git')
      return
    }
    try {
      const r = await G.state()
      if (!aliveRef.current) return
      const ok = !!(r && r.ok && r.data)
      setIsRepo(!!(ok && r.data?.isRepo))
      setBranch(ok && r.data?.branch ? String(r.data.branch) : ok && r.data?.isRepo ? '(无分支)' : 'git')
      setDirty(ok ? Number(r.data?.dirty || 0) : 0)
    } catch (e) {}
  }, [])

  useEffect(() => {
    aliveRef.current = true
    void refresh()
    const t = window.setInterval(() => void refresh(), 30000)
    return () => {
      aliveRef.current = false
      window.clearInterval(t)
    }
  }, [refresh])

  const { hint, show: showHint } = useHint()

  const run = useCallback(
    async (kind: 'pull' | 'push' | 'sync') => {
      const G = git()
      const fn = kind === 'pull' ? G?.pull : kind === 'push' ? G?.push : G?.sync
      if (!fn) return
      setBusy(kind)
      try {
        const r = await fn.call(G)
        const done = kind === 'pull' ? '已拉取' : kind === 'push' ? '已推送' : '已同步'
        const fail = kind === 'pull' ? '拉取失败：' : kind === 'push' ? '推送失败：' : '同步失败：'
        if (r && r.ok) {
const msg = kind === 'sync' && r.data?.local ? '已提交到本机（未配置远程仓库）' : done
          showHint(msg, false)
        } else {
          showHint(fail + ((r && r.message) || '未知原因'), true)
        }
      } catch (e) {
        showHint('操作失败：' + ((e as Error)?.message || ''), true)
      } finally {
        setBusy(null)
        void refresh()
      }
    },
    [refresh, showHint]
  )

  const title = isRepo
    ? `当前分支：${branch}，点击查看改动与历史`
    : '这个文件夹还不是 git 仓库，点击查看'

  return (
    <>
    <div className="branch-bar">
      <button className="zbb-branch" type="button" title={title} onClick={onOpenPanel}>
        {ICON.branch}
        <span className="zbb-bname">{branch}</span>
        <span className={'zbb-dirty' + (dirty > 0 ? ' on' : '')} title="有未提交的改动" />
      </button>
      <button
        className="zbb-btn"
        type="button"
        title="拉取（git pull）"
        disabled={!!busy}
        onClick={() => void run('pull')}
      >
        {ICON.pull}
      </button>
      <button
        className="zbb-btn"
        type="button"
        title="推送（git push）"
        disabled={!!busy}
        onClick={() => void run('push')}
      >
        {ICON.push}
      </button>
      <button
        className={'zbb-btn' + (busy === 'sync' ? ' busy' : '')}
        type="button"
        title="同步（拉取然后推送）"
        disabled={!!busy}
        onClick={() => void run('sync')}
      >
        {ICON.sync}
      </button>
    </div>
    {hint ? createPortal(
      <div className={'app-toast' + (hint.err ? ' err' : '')}>{hint.text}</div>,
      document.body
    ) : null}
    </>
  )
}

/**
 * 拉取/推送/同步的反馈统一走插件内的底部小浮窗，不再调 window.ztools.showNotification。
 * 系统通知会在 Windows 右下角弹窗，成功失败都打扰；这里改成和 Git 面板一致的
 * 底部居中胶囊，2.6 秒自动消失。
 */
function useHint() {
  const [hint, setHint] = useState<{ text: string; err?: boolean } | null>(null)
  const timer = useRef<number | null>(null)
  const show = useCallback((text: string, err?: boolean) => {
    setHint({ text, err })
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setHint(null), 2600)
  }, [])
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])
  return { hint, show }
}