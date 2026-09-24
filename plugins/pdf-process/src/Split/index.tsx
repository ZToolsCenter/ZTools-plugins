import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import FileUpload from '../components/FileUpload'
import OperationResult from '../components/OperationResult'
import { useOperation } from '../hooks/useOperation'
import { useSharedFiles, type SharedFile } from '../context/SharedFilesContext'
import { generateTaskId, buildTaskOutputDir } from '../hooks/useTaskFolder'
import { withInputPath } from '../utils/fileFromShared'
import { renderPdfAllPageThumbs } from '../utils/pdfThumb'
import {
  beforePagesFromCutAfter,
  buildSplitInvocation,
  cutAfterFromEvery,
  formatPlanAsSpec,
  formatRangeLabel,
  pagesToRanges,
  parseSplitSpec,
  rangesFromCutAfter,
} from '../utils/splitPlan'
import './index.css'

interface SplitProps {
  onBack?: () => void
}

function resolvePath(file: SharedFile) {
  return file.rawFile ? window.ztools.getPathForFile(file.rawFile) : file.path
}

function shortName(name: string, max = 14) {
  const base = name.replace(/\.pdf$/i, '')
  if (base.length <= max) return base
  return base.slice(0, max - 1) + '…'
}

export default function Split(_props: SplitProps) {
  const { files, selectedFiles, addFiles, clear, removeFile, selectFile } = useSharedFiles()
  // Split is single-file: prefer selected, else first
  const target = selectedFiles[0] || files[0] || null

  // Auto-select first workspace file so split UI always has a target
  useEffect(() => {
    if (files.length > 0 && selectedFiles.length === 0 && files[0]) {
      selectFile(files[0].id, { exclusive: true })
    }
  }, [files, selectedFiles.length, selectFile])

  /** cut = scissors split whole doc; extract = keep only selected pages/ranges */
  type SplitMode = 'cut' | 'extract'
  const [mode, setMode] = useState<SplitMode>('extract')
  const [autoSplit, setAutoSplit] = useState(false)
  const [everyN, setEveryN] = useState(1)
  const [manualCuts, setManualCuts] = useState<Set<number>>(() => new Set())
  /** Explicit ranges from text input (may have gaps); null = derive from cuts. */
  const [explicitRanges, setExplicitRanges] = useState<Array<[number, number]> | null>(null)
  /** Selected pages in extract mode (1-based). */
  const [selectedPages, setSelectedPages] = useState<Set<number>>(() => new Set())
  /** Range-select anchor for shift-click in extract mode. */
  const [rangeAnchor, setRangeAnchor] = useState<number | null>(null)
  const [specText, setSpecText] = useState('')
  const [specError, setSpecError] = useState<string | null>(null)
  const [specFocused, setSpecFocused] = useState(false)
  const [pageThumbs, setPageThumbs] = useState<string[]>([])
  const [pageCount, setPageCount] = useState(0)
  const [loadingThumbs, setLoadingThumbs] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const abortRef = useRef({ aborted: false })
  const loadedForRef = useRef<string | null>(null)

  const { processing, result, error, execute, cancel } = useOperation<string[]>()

  // Reset cuts / thumbs when target file changes
  useEffect(() => {
    abortRef.current.aborted = true
    abortRef.current = { aborted: false }
    setManualCuts(new Set())
    setExplicitRanges(null)
    setSelectedPages(new Set())
    setRangeAnchor(null)
    setSpecText('')
    setSpecError(null)
    setPageThumbs([])
    setPageCount(target?.pageCount || 0)
    setLoadError(null)
    loadedForRef.current = null

    if (!target) {
      setLoadingThumbs(false)
      return
    }

    const signal = abortRef.current
    const fileId = target.id
    setLoadingThumbs(true)

    // Path-only (system dialog): page count via preload, placeholder thumbs
    if (!target.rawFile) {
      const filePath = resolvePath(target)
      void (async () => {
        try {
          let n = 0
          if (typeof window.services.getPdfPageCount === 'function') {
            n = await window.services.getPdfPageCount(filePath)
          }
          if (signal.aborted) return
          if (n > 0) {
            loadedForRef.current = fileId
            setPageCount(n)
            setPageThumbs(new Array(n))
            setLoadingThumbs(false)
          } else {
            setLoadError('无法读取页数。可拖入 PDF 以生成页面预览。')
            setLoadingThumbs(false)
          }
        } catch (e: any) {
          if (signal.aborted) return
          setLoadError(e?.message || '无法读取 PDF 页数')
          setLoadingThumbs(false)
        }
      })()
      return () => {
        signal.aborted = true
      }
    }

    void renderPdfAllPageThumbs(target.rawFile, {
      maxWidth: 160,
      signal,
      onPage: (i, url, total) => {
        if (signal.aborted) return
        setPageCount(total)
        setPageThumbs((prev) => {
          const next = prev.length === total ? prev.slice() : new Array(total)
          next[i - 1] = url
          return next
        })
      },
    })
      .then(({ pageCount: n, thumbs }) => {
        if (signal.aborted) return
        loadedForRef.current = fileId
        setPageCount(n)
        setPageThumbs(thumbs)
        setLoadingThumbs(false)
      })
      .catch((e) => {
        if (signal.aborted) return
        setLoadError(e?.message || '无法渲染页面预览')
        setLoadingThumbs(false)
      })

    return () => {
      signal.aborted = true
    }
  }, [target?.id, target?.rawFile, target?.pageCount, target?.path])

  const effectiveCuts = useMemo(() => {
    if (!pageCount || mode !== 'cut') return [] as number[]
    if (autoSplit) return cutAfterFromEvery(pageCount, everyN)
    return Array.from(manualCuts).filter((c) => c >= 1 && c < pageCount).sort((a, b) => a - b)
  }, [mode, autoSplit, everyN, manualCuts, pageCount])

  const plan = useMemo(() => {
    if (pageCount <= 0) return [] as Array<[number, number]>
    if (mode === 'extract') {
      if (explicitRanges && explicitRanges.length > 0) return explicitRanges
      return pagesToRanges(selectedPages)
    }
    // cut mode
    if (!autoSplit && explicitRanges && explicitRanges.length > 0) return explicitRanges
    return rangesFromCutAfter(pageCount, effectiveCuts)
  }, [pageCount, mode, autoSplit, explicitRanges, selectedPages, effectiveCuts])

  const partCount = plan.length
  /** In extract mode we merge into one file by default. */
  const outputFileCount = mode === 'extract' ? (plan.length > 0 ? 1 : 0) : partCount

  // Keep text box in sync with scissors / selection (unless user is typing)
  useEffect(() => {
    if (specFocused || (mode === 'cut' && autoSplit)) return
    if (pageCount <= 0) {
      setSpecText('')
      return
    }
    setSpecText(formatPlanAsSpec(plan))
    setSpecError(null)
  }, [plan, pageCount, specFocused, mode, autoSplit])

  const applySpecText = useCallback(
    (text: string) => {
      setSpecText(text)
      if (!pageCount || (mode === 'cut' && autoSplit)) return
      const parsed = parseSplitSpec(text, pageCount)
      if (parsed.ok === false) {
        setSpecError(parsed.error)
        return
      }
      setSpecError(null)

      if (mode === 'extract') {
        const raw = String(text || '').trim()
        if (!raw) {
          setSelectedPages(new Set())
          setExplicitRanges(null)
          setRangeAnchor(null)
          return
        }
        // Pure page list "2,5,8" must mean keep those pages — NOT cut-after.
        const tokens = raw.split(/[,;，、\s]+/).map((s) => s.trim()).filter(Boolean)
        const allSingles = tokens.length > 0 && tokens.every((t) => /^\d+$/.test(t))
        if (allSingles) {
          const pages = new Set<number>()
          for (const t of tokens) {
            const v = parseInt(t, 10)
            if (v < 1 || v > pageCount) {
              setSpecError('页码超出范围：' + v)
              return
            }
            pages.add(v)
          }
          setSpecError(null)
          setSelectedPages(pages)
          setExplicitRanges(pagesToRanges(pages))
          setRangeAnchor(null)
          return
        }
        // ranges handled below via parseSplitSpec
        // Range form "15-20" / "1-3,8,12-15"
        const pages = new Set<number>()
        for (const [a, b] of parsed.ranges) {
          for (let p = a; p <= b; p++) pages.add(p)
        }
        setSelectedPages(pages)
        setExplicitRanges(parsed.ranges)
        setRangeAnchor(null)
        return
      }

      // cut mode
      setManualCuts(new Set(parsed.cuts))
      if (parsed.mode === 'ranges') {
        const coversAll =
          parsed.ranges.length > 0 &&
          parsed.ranges[0][0] === 1 &&
          parsed.ranges[parsed.ranges.length - 1][1] === pageCount &&
          parsed.ranges.every((r, i) => i === 0 || r[0] === parsed.ranges[i - 1][1] + 1)
        setExplicitRanges(coversAll ? null : parsed.ranges)
      } else {
        setExplicitRanges(null)
      }
    },
    [pageCount, autoSplit, mode],
  )

  const toggleCutAfter = useCallback(
    (afterPage: number) => {
      if (mode !== 'cut' || autoSplit) return
      if (afterPage < 1 || afterPage >= pageCount) return
      setExplicitRanges(null)
      setManualCuts((prev) => {
        const next = new Set(prev)
        if (next.has(afterPage)) next.delete(afterPage)
        else next.add(afterPage)
        return next
      })
    },
    [mode, autoSplit, pageCount],
  )

  const toggleExtractPage = useCallback(
    (pageNo: number, opts?: { shift?: boolean }) => {
      if (mode !== 'extract' || pageNo < 1 || pageNo > pageCount) return
      setExplicitRanges(null)
      if (opts?.shift && rangeAnchor != null) {
        const lo = Math.min(rangeAnchor, pageNo)
        const hi = Math.max(rangeAnchor, pageNo)
        setSelectedPages((prev) => {
          const next = new Set(prev)
          for (let p = lo; p <= hi; p++) next.add(p)
          return next
        })
        return
      }
      setRangeAnchor(pageNo)
      setSelectedPages((prev) => {
        const next = new Set(prev)
        if (next.has(pageNo)) next.delete(pageNo)
        else next.add(pageNo)
        return next
      })
    },
    [mode, pageCount, rangeAnchor],
  )

  const selectExtractRange = useCallback(
    (start: number, end: number) => {
      if (mode !== 'extract' || pageCount <= 0) return
      const lo = Math.max(1, Math.min(start, end))
      const hi = Math.min(pageCount, Math.max(start, end))
      const pages = new Set<number>()
      for (let p = lo; p <= hi; p++) pages.add(p)
      setSelectedPages(pages)
      setExplicitRanges([[lo, hi]])
      setRangeAnchor(lo)
      setSpecText(formatRangeLabel(lo, hi))
      setSpecError(null)
    },
    [mode, pageCount],
  )

  const handleUpload = (list: File[]) => {
    clear()
    addFiles(list.slice(0, 1))
  }

  const handleClear = () => {
    clear()
    setManualCuts(new Set())
    setExplicitRanges(null)
    setSelectedPages(new Set())
    setRangeAnchor(null)
    setSpecText('')
    setSpecError(null)
    setPageThumbs([])
    setPageCount(0)
  }

  const handleSplit = () => {
    if (!target) return
    if (pageCount <= 0) {
      window.ztools.showNotification('无法获取页数')
      return
    }
    if (specError) {
      window.ztools.showNotification(specError)
      return
    }
    if (mode === 'extract' && plan.length === 0) {
      window.ztools.showNotification('请选择要提取的页码，例如 15-20')
      return
    }
    execute(async () => {
      const taskId = generateTaskId(target.name || target.path)
      const outputDir = buildTaskOutputDir(window.ztools.getPath('downloads'), 'split', taskId)

      const intent =
        mode === 'extract'
          ? ({ mode: 'extract', ranges: plan } as const)
          : autoSplit
            ? ({ mode: 'cut', kind: 'span', span: Math.max(1, everyN) } as const)
            : explicitRanges && explicitRanges.length > 0
              ? ({
                  mode: 'cut',
                  kind: 'ranges',
                  ranges: explicitRanges,
                  mergeRanges: false as const,
                } as const)
              : effectiveCuts.length === 0
                ? ({ mode: 'cut', kind: 'whole', pageCount } as const)
                : ({
                    mode: 'cut',
                    kind: 'before',
                    beforePages: beforePagesFromCutAfter(effectiveCuts),
                  } as const)

      const args = buildSplitInvocation(intent)
      const out = await withInputPath(target, (inputPath) =>
        window.services.splitPdf(inputPath, outputDir, args),
      )

      const list = Array.isArray(out) ? out : [out]
      window.ztools.showNotification(
        (mode === 'extract' ? '提取完成（' : '拆分完成（') + list.length + ' 个文件）',
      )
      return list
    })
  }

  const cutSet = useMemo(() => new Set(effectiveCuts), [effectiveCuts])
  const selectedPageSet = selectedPages

  return (
    <div className="split-page">
      <h1 className="feature-title split-title">PDF 拆分</h1>

      <div className="split-toolbar">
        <div className="split-toolbar-left">
          {target ? (
            <div className="split-mode-group" role="tablist" aria-label="拆分模式">
              <button
                type="button"
                role="tab"
                className={'split-mode-btn' + (mode === 'extract' ? ' active' : '')}
                aria-selected={mode === 'extract'}
                onClick={() => {
                  setMode('extract')
                  setAutoSplit(false)
                  setManualCuts(new Set())
                  setExplicitRanges(null)
                  setSpecError(null)
                }}
              >
                提取指定页
              </button>
              <button
                type="button"
                role="tab"
                className={'split-mode-btn' + (mode === 'cut' ? ' active' : '')}
                aria-selected={mode === 'cut'}
                onClick={() => {
                  setMode('cut')
                  setSelectedPages(new Set())
                  setExplicitRanges(null)
                  setSpecError(null)
                }}
              >
                完整拆分
              </button>
            </div>
          ) : null}

          {target && mode === 'cut' ? (
            <label className={'split-auto' + (autoSplit ? ' on' : '')}>
              <input
                type="checkbox"
                checked={autoSplit}
                onChange={(e) => {
                  setAutoSplit(e.target.checked)
                  if (e.target.checked) {
                    setExplicitRanges(null)
                    setSpecError(null)
                  }
                }}
              />
              <span>自动拆分，每隔</span>
              <input
                className="split-every-input"
                type="number"
                min={1}
                max={Math.max(1, pageCount || 999)}
                value={everyN}
                disabled={!autoSplit}
                onChange={(e) => setEveryN(Math.max(1, Number(e.target.value) || 1))}
                onClick={(e) => e.stopPropagation()}
              />
              <span>页面</span>
            </label>
          ) : null}

          {target && mode === 'extract' && pageCount > 0 ? (
            <div className="split-extract-actions">
              <button
                type="button"
                className="split-tool-btn"
                onClick={() => selectExtractRange(1, pageCount)}
              >
                全选
              </button>
              <button
                type="button"
                className="split-tool-btn"
                onClick={() => {
                  setSelectedPages(new Set())
                  setExplicitRanges(null)
                  setRangeAnchor(null)
                  setSpecText('')
                  setSpecError(null)
                }}
              >
                清空选择
              </button>
            </div>
          ) : null}
        </div>

        <div className="split-toolbar-right">
          {target ? (
            <button type="button" className="split-tool-btn" onClick={handleClear}>
              <span className="split-tool-icon">🗑</span>
              清空列表
            </button>
          ) : null}
        </div>
      </div>

      {!target ? (
        <FileUpload
          title="PDF 拆分"
          subtitle="选择一个 PDF，提取指定页或完整拆分"
          accept=".pdf"
          multiple={false}
          onFilesSelected={handleUpload}
        />
      ) : (
        <div className="split-body">
          {files.length > 1 ? (
            <p className="split-note">
              拆分一次处理一个文件（当前：{target.name}）。列表中另有 {files.length - 1} 个文件可在侧栏其它功能使用。
              <button
                type="button"
                className="split-link-btn"
                onClick={() => removeFile(target.id)}
              >
                移除此文件
              </button>
            </p>
          ) : null}

          {loadError ? <p className="error-text">{loadError}</p> : null}
          {loadingThumbs ? (
            <p className="split-loading">
              正在生成页面预览… {pageThumbs.filter(Boolean).length}/{pageCount || '?'}
            </p>
          ) : null}

          <div className="split-grid" role="list">
            {Array.from({ length: pageCount || 0 }, (_, idx) => {
              const pageNo = idx + 1
              const thumb = pageThumbs[idx]
              const cutAfter = mode === 'cut' && cutSet.has(pageNo)
              const isSelected = mode === 'extract' && selectedPageSet.has(pageNo)
              const isLast = pageNo === pageCount
              return (
                <div
                  key={pageNo}
                  className={'split-cell' + (cutAfter ? ' has-cut' : '')}
                  role="listitem"
                >
                  <div
                    className={
                      'split-card' +
                      (isSelected ? ' selected' : '') +
                      (mode === 'extract' ? ' selectable' : '')
                    }
                    onClick={
                      mode === 'extract'
                        ? (e) => toggleExtractPage(pageNo, { shift: e.shiftKey })
                        : undefined
                    }
                    role={mode === 'extract' ? 'button' : undefined}
                    tabIndex={mode === 'extract' ? 0 : undefined}
                    onKeyDown={
                      mode === 'extract'
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              toggleExtractPage(pageNo, { shift: e.shiftKey })
                            }
                          }
                        : undefined
                    }
                    aria-pressed={mode === 'extract' ? isSelected : undefined}
                    title={
                      mode === 'extract'
                        ? isSelected
                          ? '取消选择第 ' + pageNo + ' 页（Shift+点击可连选）'
                          : '选择第 ' + pageNo + ' 页（Shift+点击可连选）'
                        : undefined
                    }
                  >
                    <div className="split-card-thumb">
                      {thumb ? (
                        <img src={thumb} alt={'第 ' + pageNo + ' 页'} draggable={false} />
                      ) : (
                        <div className="split-card-placeholder">{loadingThumbs ? '…' : 'PDF'}</div>
                      )}
                      {isSelected ? <span className="split-card-check" aria-hidden>✓</span> : null}
                    </div>
                    <div className="split-card-caption" title={target.name}>
                      <span className="split-card-name">{shortName(target.name)}</span>
                    </div>
                    <div className="split-card-num">{pageNo}</div>
                  </div>

                  {mode === 'cut' && !isLast ? (
                    <button
                      type="button"
                      className={'split-cut-btn' + (cutAfter ? ' active' : '') + (autoSplit ? ' locked' : '')}
                      title={
                        autoSplit
                          ? '自动拆分模式下由「每隔 N 页」控制'
                          : cutAfter
                            ? '取消在此拆分'
                            : '在此页后拆分'
                      }
                      disabled={autoSplit}
                      onClick={() => toggleCutAfter(pageNo)}
                      aria-pressed={cutAfter}
                    >
                      ✂
                    </button>
                  ) : (
                    <span className="split-cut-spacer" aria-hidden />
                  )}
                </div>
              )
            })}
          </div>

          {pageCount > 0 ? (
            <div className="split-spec-row">
              <label className="split-spec-label" htmlFor="split-spec-input">
                {mode === 'extract' ? '提取页码' : '拆分页码'}
              </label>
              <input
                id="split-spec-input"
                className={'split-spec-input' + (specError ? ' error' : '')}
                type="text"
                value={mode === 'cut' && autoSplit ? formatPlanAsSpec(plan) : specText}
                disabled={mode === 'cut' && autoSplit}
                placeholder={
                  mode === 'extract'
                    ? '例：15-20  或  1-3,8,12-15（只保留这些页，合并为一个 PDF）'
                    : '例：1-3,4-6 或 2,5（在第 2、5 页后切开）'
                }
                spellCheck={false}
                onFocus={() => setSpecFocused(true)}
                onBlur={() => {
                  setSpecFocused(false)
                  if (!(mode === 'cut' && autoSplit)) applySpecText(specText)
                }}
                onChange={(e) => applySpecText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    ;(e.target as HTMLInputElement).blur()
                  }
                }}
              />
              <span className="split-spec-hint">
                {mode === 'extract'
                  ? '只导出列出的页；点击缩略图可选页，Shift+点击连选。多个范围会合并成 1 个 PDF。'
                  : autoSplit
                    ? '自动拆分时由「每隔 N 页」生成'
                    : '支持范围 1-3,4-6；或切割点 2,5（页后切开）'}
              </span>
              {specError ? <span className="split-spec-error">{specError}</span> : null}
            </div>
          ) : null}

          {pageCount > 0 ? (
            <div className="split-plan">
              <span className="split-plan-label">
                {mode === 'extract'
                  ? plan.length === 0
                    ? '尚未选择页码'
                    : '将提取为 1 个文件：'
                  : '将拆成 ' + partCount + ' 个文件：'}
              </span>
              <span className="split-plan-ranges">
                {plan.map(([a, b], i) => (
                  <span key={i} className="split-plan-chip">
                    {formatRangeLabel(a, b)}
                  </span>
                ))}
              </span>
            </div>
          ) : null}

          {error && !processing ? <p className="error-text">拆分失败：{error}</p> : null}
          <OperationResult result={result} onReset={() => {}} />
        </div>
      )}

      {target ? (
        <div className="split-footer">
          {!processing ? (
            <button
              type="button"
              className="split-start-btn"
              onClick={handleSplit}
              disabled={
                pageCount <= 0 ||
                !!specError ||
                (mode === 'extract' && outputFileCount === 0)
              }
            >
              {mode === 'extract'
                ? '确认提取（' + outputFileCount + ' 个文件）'
                : '确认分割（' + partCount + ' 个文件）'}
            </button>
          ) : (
            <button type="button" className="split-start-btn stop" onClick={cancel}>
              停止
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}
