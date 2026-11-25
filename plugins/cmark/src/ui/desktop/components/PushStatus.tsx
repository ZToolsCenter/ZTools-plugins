/**
 * 「有改动未推送到远端」状态按钮
 *
 * 头部第一个按钮（取代原来的钟表图标，两者功能本来就是同一个入口）。
 * 有关联远程仓库、且满足下面任一条件时高亮：
 *   - 当前这篇笔记有未提交的改动
 *   - 本地有提交尚未推送（ahead > 0）
 * 点击打开「文档变更记录」（file 模式）。
 */
import { useCallback, useEffect, useState } from 'react'
import { useNotes } from '../../../service/store/notes'
import { gitBridge, notes } from '../../../runtime/legacy-bridge'

type GitState = {
  ok?: boolean
  data?: {
    isRepo?: boolean
    dirty?: number
    ahead?: number
    files?: { path: string }[] | null
  }
}

type GitApi = {
  state?: () => Promise<GitState>
  remoteInfo?: () => Promise<{ ok?: boolean; data?: { hasRemote?: boolean } }>
  relOf?: (absPath: string) => string | null
}

const git = () => gitBridge() as unknown as GitApi | undefined

/** Git 集成是否开启：优先读 preload 的配置接口，回退 localStorage，都没值按开启处理 */
function readGitEnabled(): boolean {
  try {
    const api = (window as unknown as { __CMARK_GIT?: { get?: () => boolean | null } }).__CMARK_GIT
    const v = api?.get?.()
    if (v === true || v === false) return v
  } catch (e) {}
  try { return localStorage.getItem('cmark-git-enabled') !== '0' } catch (e) { return true }
}

/** 工作区相对 → 仓库相对 */
function repoRelOf(rel: string): string | null {
  try {
    const abs = (notes() as unknown as { absOf?: (r: string) => string })?.absOf?.(rel)
    return abs ? git()?.relOf?.(abs) || null : null
  } catch (e) {
    return null
  }
}

export function PushStatus({ onOpen }: { onOpen: () => void }) {
  const currentRel = useNotes((s) => s.currentRel)
  const [hasRemote, setHasRemote] = useState(false)
  const [pending, setPending] = useState(false)
  const [gitOn, setGitOn] = useState(readGitEnabled)

  // 设置里关掉 Git 集成时，这个云端按钮直接不显示
  useEffect(() => {
    const sync = () => setGitOn(readGitEnabled())
    window.addEventListener('cmark-git-changed', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.removeEventListener('cmark-git-changed', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])

  const poll = useCallback(async () => {
    const G = git()
    if (!G) return
    try {
      const ri = await G.remoteInfo?.()
      setHasRemote(!!(ri?.ok && ri.data?.hasRemote))
    } catch (e) {}
    try {
      const r = await G.state?.()
      if (r?.ok && r.data) {
        const st = r.data
        const repoRel = currentRel ? repoRelOf(currentRel) : null
        const hit = repoRel ? (st.files || []).some((f) => f.path === repoRel) : false
        // 高亮只在关联了远程仓库时表示「未推送」；没远程时只是入口
        setPending(!!st.ahead || hit)
      } else {
        setPending(false)
      }
    } catch (e) {}
  }, [currentRel])

  useEffect(() => {
    void poll()
    const iv = window.setInterval(() => void poll(), 10000)
    return () => window.clearInterval(iv)
  }, [poll])

  if (!gitOn) return null
  if (!currentRel) return null

  const warn = hasRemote && pending
  const title = warn
    ? '有改动尚未推送到远程仓库，点击查看并同步'
    : hasRemote
      ? '当前笔记与远端一致，点击查看变更记录'
      : '查看这篇笔记的变更记录'

  return (
    <button className={'iconbtn' + (warn ? ' warn-on' : '')} type="button" title={title} onClick={onOpen}>
      <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.6 11.4a2.9 2.9 0 0 1-.3-5.78 3.9 3.9 0 0 1 7.5-.4 2.7 2.7 0 0 1 .6 5.3" />
        <path d="M8 13.6V7.9" />
        <path d="M6.2 9.6 8 7.8l1.8 1.8" />
      </svg>
    </button>
  )
}
