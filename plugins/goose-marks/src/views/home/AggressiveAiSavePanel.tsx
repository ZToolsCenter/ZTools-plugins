import { useCallback, useEffect, useRef, useState } from 'react'
import type { BookmarkLocation } from '@/types/bookmark'
import {
  normalizeAggressiveSaveUrl,
  type AggressiveAiSaveFailure,
  type AggressiveAiSaveResult
} from '@/services/aggressiveAiSave'
import { Ico } from './icon'

type Phase = 'idle' | 'error'

/**
 * AI 保存面板：只输入网址，自动整理标题/简介/分组并保存。
 * 校验通过后把任务交给主页队列，并在当前页显示进度或失败详情。
 */
export default function AggressiveAiSavePanel({
  initialUrl = '',
  autoStart = false,
  job,
  failure,
  onBack,
  onSubmit,
  onClearFailure,
  onOpenSettings
}: {
  initialUrl?: string
  autoStart?: boolean
  job?: { host: string; detail: string; status: 'queued' | 'running' } | null
  failure?: AggressiveAiSaveFailure | null
  onBack: () => void
  onSubmit: (url: string) => void
  onClearFailure: () => void
  onOpenSettings: () => void
}) {
  const [url, setUrl] = useState(initialUrl)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const submittedRef = useRef(false)
  const autoStartedRef = useRef(false)
  const busy = Boolean(job)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const submitSave = useCallback(
    (raw: string) => {
      if (submittedRef.current || busy) return
      const normalized = normalizeAggressiveSaveUrl(raw)
      if (!normalized) {
        setError('请输入有效链接（http/https）')
        setPhase('error')
        return
      }

      submittedRef.current = true
      setError('')
      onClearFailure()
      onSubmit(normalized)
    },
    [busy, onClearFailure, onSubmit]
  )

  // 外部带入 URL（如 uTools 特性）时自动开跑
  useEffect(() => {
    if (autoStartedRef.current) return
    if (!autoStart || !initialUrl.trim()) return
    autoStartedRef.current = true
    submitSave(initialUrl)
  }, [autoStart, initialUrl, submitSave])

  // 后台任务结束后允许用户重试；首次提交期间继续阻止粘贴/按钮造成重复入队。
  useEffect(() => {
    if (!busy) submittedRef.current = false
  }, [busy, failure])

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (!text?.trim()) return
      const next = text.trim()
      setUrl(next)
      submitSave(next)
    } catch {
      setError('无法读取剪贴板，请手动粘贴')
      setPhase('error')
    }
  }, [submitSave])

  const handleSubmit = useCallback(() => {
    submitSave(url)
  }, [submitSave, url])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onBack()
        return
      }
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return
      e.preventDefault()
      submitSave(url)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onBack, submitSave, url])

  return (
    <div className="gm-wiz is-new no-rail ag-save">
      <div className="gm-wiz-main">
        <div className="gm-wiz-topbar">
          <button className="gm-rail-back gm-wiz-back" onClick={onBack}>
            <Ico name="arrow-left" />
            返回列表
          </button>
        </div>

        <div className="gm-wiz-body">
          <div className="ag-save-panel">
            <div className="ag-save-head">
              <div className="ag-save-badge">
                <Ico name="sparkles" />
                <span className="ai-save-mode-title-gradient">AI 快速保存</span>
              </div>
              <h2>粘贴网址，自动整理并入库</h2>
              <p>AI 会生成标题与简介，并归入一个或多个合适分组，无需再点保存。</p>
            </div>

            <div className={`gm-url-big ag-save-url${busy ? ' is-busy' : ''}`}>
              <Ico name="link" className="gm-url-icon" />
              <div className="gm-url-field-wrap">
                <input
                  ref={inputRef}
                  type="text"
                  value={url}
                  placeholder="https://example.com 或 example.com"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  disabled={busy}
                  onChange={(e) => {
                    setUrl(e.target.value)
                    if (failure) onClearFailure()
                    if (phase === 'error') {
                      setPhase('idle')
                      setError('')
                    }
                  }}
                  onPaste={(e) => {
                    const text = e.clipboardData?.getData('text')?.trim()
                    if (!text) return
                    // 允许粘贴后立刻开跑
                    window.setTimeout(() => {
                      const latest = inputRef.current?.value || text
                      submitSave(latest)
                    }, 0)
                  }}
                />
              </div>
              <button
                type="button"
                className="ag-save-paste"
                onClick={() => void handlePaste()}
                title="从剪贴板粘贴并保存"
                disabled={busy}
              >
                <Ico name="clipboard" />
                粘贴
              </button>
            </div>

            {error && (
              <div className="gm-wiz-error">
                <Ico name="alert-circle" />
                {error}
              </div>
            )}

            {job && (
              <div className="ag-save-inline-status" role="status" aria-live="polite">
                <Ico name="loader" className="spin" />
                <div>
                  <div className="ag-save-inline-title">
                    {job.status === 'queued' ? '等待处理' : `正在整理 ${job.host}`}
                  </div>
                  <div className="ag-save-inline-detail">
                    {job.detail}
                  </div>
                </div>
              </div>
            )}

            {failure && !job && (
              <div className="ag-save-failure" role="alert">
                <span className="ag-save-failure-icon" aria-hidden="true"><Ico name="alert-circle" /></span>
                <div className="ag-save-failure-body">
                  <div className="ag-save-failure-title">{failure.message}</div>
                  <div className="ag-save-failure-detail">{failure.detail}</div>
                  <div className="ag-save-failure-recovery">{failure.recovery}</div>
                  {(failure.code === 'ai_unavailable' || failure.code === 'ai_failed') && (
                    <button type="button" className="ag-save-failure-settings" onClick={onOpenSettings}>
                      <Ico name="settings" />
                      检查 AI 设置
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="ag-save-tips">
              <div>
                <Ico name="zap" />
                Enter 或粘贴后自动开始
              </div>
              <div>
                <Ico name="folder" />
                成功后可在主页消息中跳到对应分组
              </div>
            </div>
          </div>
        </div>

        <footer className="gm-wiz-foot">
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={onBack}>
            取消
          </button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={!url.trim() || busy}>
            <Ico name={busy ? 'loader' : 'sparkles'} className={busy ? 'spin' : ''} />
            {busy ? '正在保存…' : failure ? '重新尝试' : 'AI 快速保存'}
          </button>
        </footer>
      </div>
    </div>
  )
}

/** 供主页拼成功 toast 文案 */
export function formatAggressiveSaveToast(result: AggressiveAiSaveResult): {
  title: string
  description: string
  jump: BookmarkLocation | null
} {
  const groups = result.groupLabels.length ? result.groupLabels.join('、') : '未分组'
  const fallbackNote = result.usedFallbackCollect ? '（未匹配到高置信分组）' : ''
  return {
    title: `已保存「${result.title || '书签'}」`,
    description: `分组：${groups}${fallbackNote}`,
    jump: result.locations[0] ?? null
  }
}
