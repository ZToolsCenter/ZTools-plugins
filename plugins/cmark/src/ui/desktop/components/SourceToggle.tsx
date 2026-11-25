/**
 * 源码模式开关：在所见即所得与 Markdown 原文之间切换
 *
 * 这是用户规避序列化风险的后门——发现问题时可以立刻看原文、直接改原文。
 */
import { useNotes } from '../../../service/store/notes'

export function SourceToggle() {
  const sourceMode = useNotes((s) => s.sourceMode)
  const toggleSourceMode = useNotes((s) => s.toggleSourceMode)
  const currentRel = useNotes((s) => s.currentRel)

  if (!currentRel) return null

  return (
    <button
      className={'iconbtn' + (sourceMode ? ' on' : '')}
      type="button"
      title={sourceMode ? '关闭源码模式' : '源码模式（直接编辑 Markdown）'}
      onClick={toggleSourceMode}
    >
      <svg
        viewBox="0 0 16 16"
        width="15"
        height="15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5.6 4.2L2.2 8l3.4 3.8M10.4 4.2L13.8 8l-3.4 3.8" />
      </svg>
    </button>
  )
}