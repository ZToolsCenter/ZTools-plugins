import { useCallback, useEffect, useMemo, useRef, type UIEvent } from 'react'
import type { BookmarkLocation } from '@/types/bookmark'
import { useBookmarkStore } from '@/stores/bookmark'
import { useSettingsStore } from '@/stores/settings'
import {
  useBookmarkForm,
  useBookmarkFormStore,
  isValidUrlInput,
  URL_FETCH_PASTE_DEBOUNCE_MS,
} from '@/hooks/useBookmarkForm'
import { CategoryMultiSelect } from '@/components/CategoryMultiSelect'
import { iconToDisplayUrl } from '@/services/iconCache'
import { Ico } from './icon'
import { Image } from '@/components/ui/image'
import type { HomeItem } from './viewModel'

/**
 * 新建/编辑书签表单
 * --------------------------------------------------------------------------
 * 新建不再经过独立「捕获链接 / 智能识别」页面，直接进入可编辑确认页。
 * URL 抓取作为表单内的轻量辅助能力存在，避免流程臃肿。
 */

export default function AddBookmarkWizard({
  editItem,
  onBack,
}: {
  editItem: HomeItem | null
  onBack: (jump?: BookmarkLocation) => void
}) {
  const bookmarks = useBookmarkStore((s) => s.bookmarks)
  const {
    showAdd,
    draft,
    draftLocations,
    previewIcon,
    iconLoading,
    iconFetchPhase,
    formError,
    isSaving,
    isGenerating,
    editingId,
    originalUrl,
    lastFetchedUrl,
    categorySuggestion,
    set,
    patchDraft,
    openAdd,
    openEdit,
    handleSave,
    runUrlFetch,
    requestDelete,
    applyCategorySuggestion,
    dismissCategorySuggestion,
    onTitleInput,
    onDescInput,
    isTitleDirty,
    isDescDirty,
    isDraftTemplate,
    titleSuggestion,
    applyTitleSuggestion,
    takeOverTitle,
    takeOverDesc,
    canUseAi,
  } = useBookmarkForm()

  const aiFormAutoPolish = useSettingsStore((s) => s.aiFormAutoPolish)
  const setAiFormAutoPolish = useSettingsStore((s) => s.setAiFormAutoPolish)

  // 以入口 editItem 为准（比 store.editingId 更稳：openEdit 异步生效前首帧不会误判新建）
  const isNewEntry = !editItem
  const isEdit = !!editingId
  const titleFetching = iconLoading && !isTitleDirty
  const descFetching = iconLoading && !isDescDirty
  const previewIconUrl = iconToDisplayUrl(previewIcon ?? undefined) || ''

  // 新建时一旦识别到模板占位符，默认打开全局搜索（用户仍可关掉）
  const wasTemplateRef = useRef(false)
  useEffect(() => {
    if (isDraftTemplate && !wasTemplateRef.current && !editingId) {
      patchDraft({ allowUniversal: true })
    }
    wasTemplateRef.current = isDraftTemplate
  }, [isDraftTemplate, editingId, patchDraft])

  // ---- 关闭联动：hook 保存成功后 set({ showAdd:false }) -> 触发 onBack ----
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack
  const wasOpenRef = useRef(false)
  const pendingJumpRef = useRef<BookmarkLocation | null>(null)
  useEffect(() => {
    if (showAdd) {
      wasOpenRef.current = true
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false
      onBackRef.current(pendingJumpRef.current ?? undefined)
      pendingJumpRef.current = null
    }
  }, [showAdd])

  // ---- 打开：编辑加载已有书签，新建初始化空表单 ----
  const editItemId = editItem?.id ?? null
  useEffect(() => {
    if (editItemId) {
      const real = bookmarks.find((b) => b.id === editItemId)
      if (real) openEdit(real)
    } else {
      openAdd()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editItemId])

  const setUrl = useCallback(
    (url: string) => {
      patchDraft({ url })
    },
    [patchDraft],
  )

  const handleSaveClick = useCallback(async () => {
    await handleSave()
    const after = useBookmarkFormStore.getState()
    if (!after.showAdd) pendingJumpRef.current = after.draftLocations[0] ?? null
  }, [handleSave])
  const handleDeleteClick = useCallback(() => requestDelete(), [requestDelete])
  const handleCancel = useCallback(() => set({ showAdd: false }), [set])

  // Cmd/Ctrl + Enter 保存；普通 Enter 在输入框里保留原生编辑行为，避免刚粘贴 URL 就误保存。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (!(e.metaKey || e.ctrlKey) && (tag === 'INPUT' || tag === 'TEXTAREA')) return
      if (!isSaving && draftLocations.length > 0) {
        e.preventDefault()
        void handleSaveClick()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isSaving, draftLocations.length, handleSaveClick])

  return (
    <div className={`gm-wiz${isEdit ? ' is-edit' : ' is-new'} no-rail`}>
      <div className="gm-wiz-main">
        <div className="gm-wiz-topbar">
          <button className="gm-rail-back gm-wiz-back" onClick={handleCancel} disabled={isSaving}>
            <Ico name="arrow-left" />
            返回列表
          </button>
        </div>
        <div className="gm-wiz-body">
          <ConfirmStep
            draft={draft}
            draftLocations={draftLocations}
            previewIconUrl={previewIconUrl}
            previewIcon={previewIcon}
            iconLoading={iconLoading}
            iconFetchPhase={iconFetchPhase}
            titleFetching={titleFetching}
            descFetching={descFetching}
            isGenerating={isGenerating}
            categorySuggestion={categorySuggestion}
            patchDraft={patchDraft}
            onTitleInput={onTitleInput}
            onDescInput={onDescInput}
            titleSuggestion={titleSuggestion}
            applyTitleSuggestion={applyTitleSuggestion}
            takeOverTitle={takeOverTitle}
            takeOverDesc={takeOverDesc}
            setLocations={(v: BookmarkLocation[]) => set({ draftLocations: v })}
            applyCategorySuggestion={applyCategorySuggestion}
            dismissCategorySuggestion={dismissCategorySuggestion}
            setUrl={setUrl}
            allowUniversal={draft.allowUniversal}
            isDraftTemplate={isDraftTemplate}
            editingId={editingId}
            originalUrl={originalUrl}
            lastFetchedUrl={lastFetchedUrl}
            runUrlFetch={runUrlFetch}
            isNewEntry={isNewEntry}
            canUseAi={canUseAi}
            aiFormAutoPolish={aiFormAutoPolish}
            onAiFormAutoPolishChange={setAiFormAutoPolish}
          />

          {formError && (
            <div className="gm-wiz-error">
              <Ico name="alert-circle" />
              {formError}
            </div>
          )}
        </div>

        <footer className="gm-wiz-foot">
          {isEdit && (
            <button className="btn btn-ghost danger" onClick={handleDeleteClick} disabled={isSaving}>
              <Ico name="trash-2" />
              删除
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={handleCancel} disabled={isSaving}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSaveClick}
            disabled={isSaving || draftLocations.length === 0}
          >
            {isSaving ? <Ico name="loader" className="spin" /> : <Ico name="check" />}
            {isEdit ? '保存修改' : '保存书签'}
          </button>
        </footer>
      </div>
    </div>
  )
}

/** 把 URL 中的 {占位符} 标蓝，供镜像层渲染（任意 {q}/{关键词}/… 均匹配） */
function highlightTemplateTokens(url: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return escape(url).replace(/\{[^}]+\}/g, (token) => `<span class="gm-url-token">${token}</span>`)
}

function ConfirmStep({
  draft,
  draftLocations,
  previewIconUrl,
  previewIcon,
  iconLoading,
  iconFetchPhase,
  titleFetching,
  descFetching,
  isGenerating,
  categorySuggestion,
  patchDraft,
  onTitleInput,
  onDescInput,
  titleSuggestion,
  applyTitleSuggestion,
  takeOverTitle,
  takeOverDesc,
  setLocations,
  applyCategorySuggestion,
  dismissCategorySuggestion,
  setUrl,
  allowUniversal,
  isDraftTemplate,
  editingId,
  originalUrl,
  lastFetchedUrl,
  runUrlFetch,
  isNewEntry,
  canUseAi,
  aiFormAutoPolish,
  onAiFormAutoPolishChange,
}: {
  draft: { title: string; desc: string; url: string }
  draftLocations: BookmarkLocation[]
  previewIconUrl: string
  previewIcon: { bgColor?: string } | null
  iconLoading: boolean
  iconFetchPhase: 'idle' | 'loading' | 'success' | 'failed'
  titleFetching: boolean
  descFetching: boolean
  isGenerating: boolean
  categorySuggestion: {
    groupName: string
    subGroupName: string
    reason: string
    confidence: number
  } | null
  patchDraft: (p: Partial<{ title: string; desc: string; url: string; allowUniversal: boolean }>) => void
  onTitleInput: () => void
  onDescInput: (v: string) => void
  titleSuggestion: string | null
  applyTitleSuggestion: () => void
  takeOverTitle: () => void
  takeOverDesc: () => void
  setLocations: (v: BookmarkLocation[]) => void
  applyCategorySuggestion: () => void
  dismissCategorySuggestion: () => void
  setUrl: (v: string) => void
  allowUniversal: boolean
  isDraftTemplate: boolean
  editingId: string
  originalUrl: string
  lastFetchedUrl: string
  runUrlFetch: (debounceMs?: number) => void
  isNewEntry: boolean
  canUseAi: boolean
  aiFormAutoPolish: boolean
  onAiFormAutoPolishChange: (value: boolean) => void
}) {
  // 读取触发策略：打字不触发；粘贴后短防抖自动读；失焦时若链接有效且有未读取变更则自动读。
  const pasteArmedRef = useRef(false)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!pasteArmedRef.current) return
    pasteArmedRef.current = false
    const val = draft.url
    if (!val.trim()) return
    if (!isValidUrlInput(val)) return
    if (editingId && val === originalUrl) return
    runUrlFetch(URL_FETCH_PASTE_DEBOUNCE_MS)
  }, [draft.url, editingId, originalUrl, runUrlFetch])

  const isEdit = !!editingId

  // 仅新建：挂载后把焦点放到网址输入框（编辑不抢焦点；用入口 isNewEntry 避免首帧误判）
  useEffect(() => {
    if (!isNewEntry) return
    const focusUrl = () => urlInputRef.current?.focus()
    const raf = requestAnimationFrame(() => {
      focusUrl()
      // 再兜一次，避免首帧被其它布局/副作用抢焦
      window.setTimeout(focusUrl, 0)
    })
    return () => cancelAnimationFrame(raf)
  }, [isNewEntry])

  const previewText = ((draft.title || draft.url) || 'ICON').trim().slice(0, 2).toUpperCase()
  const hasUrl = !!draft.url.trim()
  const hasTemplateToken = /\{[^}]+\}/.test(draft.url)
  const showAiPolish = canUseAi && isNewEntry

  // 链接有效、与上次读取时不一致、且不是编辑模式下未改动的原始链接 → 有「待读取」变更
  const urlOutdated =
    !!draft.url.trim() &&
    isValidUrlInput(draft.url) &&
    draft.url !== lastFetchedUrl &&
    !(editingId && draft.url === originalUrl)

  const metadataStatus = useMemo(() => {
    if (!draft.url.trim()) return isEdit ? '粘贴或输入新链接后自动读取网页信息' : '粘贴或输入链接后自动读取标题、简介和图标'
    if (!isValidUrlInput(draft.url)) return '链接格式待确认'
    if (iconLoading) return '正在读取网页信息'
    if (isGenerating) return 'AI 正在整理标题和简介'
    if (urlOutdated) return '链接已修改，失焦后自动更新网页信息'
    if (iconFetchPhase === 'success') return '已读取网页信息'
    if (iconFetchPhase === 'failed') return '未能读取网页信息，可手动填写'
    return '修改链接不会立即读取，失焦后自动更新'
  }, [draft.url, iconFetchPhase, iconLoading, isGenerating, isEdit, urlOutdated])

  // 失焦时链接有效且有未读取变更 → 自动读一次；打字过程中绝不触发
  const handleUrlBlur = useCallback(() => {
    if (!urlOutdated || iconLoading) return
    runUrlFetch()
  }, [urlOutdated, iconLoading, runUrlFetch])

  const handleUrlScroll = useCallback((e: UIEvent<HTMLInputElement>) => {
    if (mirrorRef.current) mirrorRef.current.scrollLeft = e.currentTarget.scrollLeft
  }, [])

  return (
    <div className="gm-confirm">
      <div className="gm-confirm-head">
        <h2>{isEdit ? '编辑书签' : '新增书签'}</h2>
      </div>

      <section className="gm-confirm-url">
        <div className="gm-url-big">
          <Ico name="link" className="gm-url-icon" />
          <div className={`gm-url-field-wrap${hasUrl ? ' has-value' : ''}${hasTemplateToken ? ' has-token' : ''}`}>
            {/* 空值：伪占位，{q} 标蓝 */}
            {!hasUrl && (
              <div className="gm-url-ph" aria-hidden="true">
                https://… 或含 <span className="gm-url-ph-token">{'{q}'}</span> 的搜索模板
              </div>
            )}
            {/* 有值：镜像层高亮任意 {占位符}，输入层透明描光标 */}
            {hasUrl && (
              <div
                ref={mirrorRef}
                className="gm-url-mirror"
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: highlightTemplateTokens(draft.url) }}
              />
            )}
            <input
              ref={urlInputRef}
              className={`gm-url-field${hasUrl ? ' is-overlay' : ''}`}
              value={draft.url}
              onChange={(e) => setUrl(e.target.value)}
              onPaste={() => {
                pasteArmedRef.current = true
              }}
              onBlur={handleUrlBlur}
              onScroll={handleUrlScroll}
              placeholder=""
              spellCheck={false}
              autoFocus={isNewEntry}
              aria-label="链接或含 {q} 的搜索模板"
            />
          </div>
        </div>
        <div className="gm-url-meta">
          <span className={`gm-url-state${iconFetchPhase === 'failed' && !urlOutdated ? ' warn' : urlOutdated && !iconLoading ? ' attention' : ''}`}>
            <Ico
              name={iconLoading || isGenerating ? 'loader' : urlOutdated ? 'refresh-cw' : iconFetchPhase === 'failed' ? 'alert-circle' : 'check-circle'}
              className={iconLoading || isGenerating ? 'spin' : ''}
            />
            {metadataStatus}
          </span>
        </div>
        {showAiPolish && (
          <div className={`gm-tpl-tip${aiFormAutoPolish ? ' on' : ''}`}>
            <div className="gm-tpl-tip-body">
              <div className="gm-tpl-tip-title">
                <Ico name="sparkles" />
                AI 清洗润色
              </div>
              <div className="gm-tpl-tip-desc">
                读取网页信息后，自动清洗标题/简介并中文润色；必要时联网补全
              </div>
            </div>
            <div className="gm-tpl-tip-switch">
              <span className="gm-tpl-tip-switch-lbl">自动</span>
              <div
                className={`g-switch${aiFormAutoPolish ? ' on' : ''}`}
                role="switch"
                aria-checked={aiFormAutoPolish}
                aria-label="AI 清洗润色"
                onClick={() => onAiFormAutoPolishChange(!aiFormAutoPolish)}
              />
            </div>
          </div>
        )}
        {isDraftTemplate && (
          <div className={`gm-tpl-tip${allowUniversal ? ' on' : ''}`}>
            <div className="gm-tpl-tip-body">
              <div className="gm-tpl-tip-title">
                <Ico name="sparkles" />
                已识别搜索模板
              </div>
              <div className="gm-tpl-tip-desc">
                支持 <span className="gm-url-ph-token">{'{q}'}</span>、<span className="gm-url-ph-token">{'{关键词}'}</span> 等任意 {'{占位符}'}。
                {allowUniversal
                  ? ' 已开启全局搜索：uTools 主输入框任意键入即可匹配，面板内无书签命中时也会列出。'
                  : ' 开启全局搜索后，uTools 主输入框任意键入即可匹配，面板内无书签命中时也会列出。'}
              </div>
            </div>
            <div className="gm-tpl-tip-switch">
              <span className="gm-tpl-tip-switch-lbl">全局搜索</span>
              <div
                className={`g-switch${allowUniversal ? ' on' : ''}`}
                role="switch"
                aria-checked={allowUniversal}
                aria-label="显示到 uTools 全局搜索"
                onClick={() => patchDraft({ allowUniversal: !allowUniversal })}
              />
            </div>
          </div>
        )}
      </section>

      <div className="gm-id-card">
        <div className="gm-id-top">
          <div
            className={`gm-id-fav${iconFetchPhase === 'success' ? ' fetch-success' : iconFetchPhase === 'failed' ? ' fetch-failed' : ''}`}
            style={{ background: previewIcon?.bgColor || 'var(--surface-hover)' }}
          >
            {iconLoading ? (
              <span className="icon-countdown">
                <svg viewBox="0 0 60 60" className="icon-countdown-ring" preserveAspectRatio="none">
                  <rect className="icon-countdown-track" x="1.25" y="1.25" width="57.5" height="57.5" rx="13.75" pathLength={100} />
                  <rect className="icon-countdown-fill" x="1.25" y="1.25" width="57.5" height="57.5" rx="13.75" pathLength={100} />
                </svg>
              </span>
            ) : previewIconUrl ? (
              <Image bare src={previewIconUrl} alt="" />
            ) : (
              <span className="gm-id-fav-text">{previewText}</span>
            )}
          </div>
          <div className="gm-id-fields">
            <div className="gm-id-label">标题</div>
            <input
              className={`gm-id-input${titleFetching ? ' input-shimmer' : ''}`}
              value={draft.title}
              placeholder={titleFetching ? '正在获取标题…' : '网站标题'}
              readOnly={titleFetching}
              onPointerDown={() => {
                if (titleFetching) takeOverTitle()
              }}
              onKeyDown={(e) => {
                if (titleFetching && (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete')) takeOverTitle()
              }}
              onChange={(e) => {
                patchDraft({ title: e.target.value })
                onTitleInput()
              }}
            />
            {titleSuggestion && titleSuggestion !== draft.title.trim() && (
              <button
                type="button"
                className="gm-id-suggest"
                onClick={applyTitleSuggestion}
                title="点击替换为匹配到的标题"
              >
                <Ico name="sparkles" />
                <span className="gm-id-suggest-label">匹配到</span>
                <span className="gm-id-suggest-text">{titleSuggestion}</span>
              </button>
            )}
          </div>
        </div>
        <div className="gm-id-desc-block">
          <div className="gm-id-label">简介 / 笔记</div>
          <textarea
            className={`gm-id-textarea${descFetching ? ' input-shimmer' : ''}`}
            value={draft.desc}
            placeholder={descFetching ? '正在获取描述…' : '一句话描述这个网站，或写点笔记…'}
            readOnly={descFetching}
            onPointerDown={() => {
              if (descFetching) takeOverDesc()
            }}
            onKeyDown={(e) => {
              if (descFetching && (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete')) takeOverDesc()
            }}
            onChange={(e) => onDescInput(e.target.value)}
          />
        </div>
      </div>

      <div className="gm-cat-head">
        <Ico name="folder" />
        <span className="gm-cat-title">放到哪里</span>
        <span className="gm-cat-sub">可同时放进多个分组</span>
      </div>

      {categorySuggestion && (
        <div className="gm-ai-suggest">
          <Ico name="sparkles" />
          <div className="gm-ai-suggest-meta">
            <div className="gm-ai-suggest-name">
              {categorySuggestion.groupName} / {categorySuggestion.subGroupName}
            </div>
            <div className="gm-ai-suggest-reason">{categorySuggestion.reason}</div>
          </div>
          <span className="gm-conf">{Math.round(categorySuggestion.confidence * 100)}%</span>
          <button className="btn btn-ai sm" onClick={() => applyCategorySuggestion()}>
            <Ico name="check" />
            采纳
          </button>
          <button className="gm-ai-suggest-x" onClick={dismissCategorySuggestion} title="忽略">
            <Ico name="x" />
          </button>
        </div>
      )}

      <div className="gm-cat-select form-category-select">
        <CategoryMultiSelect inline value={draftLocations} onChange={setLocations} />
      </div>
    </div>
  )
}
