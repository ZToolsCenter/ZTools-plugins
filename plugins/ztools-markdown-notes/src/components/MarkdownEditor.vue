<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Vditor from 'vditor'
import 'vditor/dist/index.css'

const props = defineProps<{
  modelValue: string
  mode: 'ir' | 'sv'
  disabled: boolean
  workspacePath: string
  notePath: string
  baseUrl: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  previewImage: [image: { src: string; alt: string }]
  fullscreenChange: [fullscreen: boolean]
  toggleOutline: []
  openLink: [href: string]
  requestTable: []
  operationError: [message: string]
}>()

const host = ref<HTMLElement | null>(null)
const isFullscreen = ref(false)
let editor: Vditor | null = null
const darkThemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
let applyingExternalValue = false
const editorReady = ref(false)
let selectedImageNode: HTMLElement | null = null
let selectedTableNode: HTMLElement | null = null
let imageClickTimer: number | undefined
let fullscreenObserver: MutationObserver | null = null
let findQuery = ''
let findRanges: Range[] = []
let findIndex = -1

const findHighlightName = 'note-find-current'

function clearFindHighlight() {
  const highlights = (CSS as unknown as { highlights?: { delete: (name: string) => void } }).highlights
  highlights?.delete(findHighlightName)
}

function showFindHighlight(range: Range) {
  clearFindHighlight()
  const highlights = (CSS as unknown as { highlights?: { set: (name: string, highlight: unknown) => void } }).highlights
  const HighlightConstructor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
  if (highlights && HighlightConstructor) highlights.set(findHighlightName, new HighlightConstructor(range))
}

function escapeLabel(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]')
}

async function importFiles(files: File[]) {
  if (!editor || props.disabled) return '当前笔记不可编辑'
  if (typeof window.znotes.importAttachment !== 'function') return '插件后台代码已更新，请完全退出并重新打开此插件后再导入附件'

  try {
    const markdown: string[] = []
    for (const file of files) {
      const relativePath = await window.znotes.importAttachment(
        props.workspacePath,
        props.notePath,
        file.name,
        new Uint8Array(await file.arrayBuffer()),
      )
      const label = escapeLabel(file.name || '附件')
      markdown.push(file.type.startsWith('image/') ? `![${label}](${relativePath})` : `[${label}](${relativePath})`)
    }
    editor.insertMD(markdown.join('\n'))
    return null
  } catch (error) {
    return error instanceof Error ? error.message : '附件导入失败'
  }
}

function handleEditorKeydown(event: KeyboardEvent) {
  if (props.mode !== 'ir' || (event.key !== 'Delete' && event.key !== 'Backspace') || !editor) {
    selectedImageNode = null
    return
  }

  let imageNode = selectedImageNode?.isConnected ? selectedImageNode : null

  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return
  const range = selection.getRangeAt(0)

  if (!imageNode && range.startContainer === range.endContainer && range.endOffset === range.startOffset + 1) {
    const selectedNode = range.startContainer.childNodes[range.startOffset]
    if (selectedNode instanceof HTMLElement && selectedNode.classList.contains('vditor-ir__marker--link')) {
      imageNode = selectedNode.closest<HTMLElement>('.vditor-ir__node')
    }
  }
  if (!imageNode?.querySelector('img')) return

  event.preventDefault()
  event.stopPropagation()
  selectedImageNode = null
  range.selectNode(imageNode)
  selection.removeAllRanges()
  selection.addRange(range)
  editor.deleteValue()
}

function handleEditorClick(event: MouseEvent) {
  const target = event.target instanceof HTMLElement ? event.target : null
  const link = target instanceof HTMLImageElement
    ? null
    : target?.closest<HTMLElement>('[data-type="a"]') || target?.closest<HTMLAnchorElement>('a')
  const sourceMarkerHref = link?.querySelector<HTMLElement>('.vditor-ir__marker--link')?.textContent?.trim()
  const renderedHref = link?.dataset.href || link?.getAttribute('href')
  const linkLabel = link?.querySelector<HTMLElement>('.vditor-ir__link')?.textContent || link?.textContent || ''
  const href = sourceMarkerHref || (link && renderedHref ? findSourceLinkHref(linkLabel) || renderedHref : null)
  if (link && href) {
    if (link instanceof HTMLAnchorElement) event.preventDefault()
    if (event.ctrlKey) {
      event.preventDefault()
      event.stopPropagation()
      emit('openLink', href)
    }
    return
  }

  selectedTableNode = target?.closest<HTMLElement>('[data-type="table"], table') ?? null

  if (props.mode !== 'ir' || !(target instanceof HTMLImageElement)) {
    window.clearTimeout(imageClickTimer)
    imageClickTimer = undefined
    selectedImageNode = null
    return
  }

  event.preventDefault()
  event.stopPropagation()
  const image = target
  const imageNode = image.closest<HTMLElement>('.vditor-ir__node')
  if (!imageNode) return

  window.clearTimeout(imageClickTimer)
  imageClickTimer = undefined
  if (event.detail >= 2) {
    selectedImageNode = null
    emit('previewImage', { src: image.currentSrc || image.src, alt: image.alt })
    return
  }

  imageClickTimer = window.setTimeout(() => {
    imageClickTimer = undefined
    if (!imageNode.isConnected) return
    selectedImageNode = imageNode
    const linkMarker = imageNode.querySelector<HTMLElement>('.vditor-ir__marker--link')
    if (!linkMarker) return
    const range = document.createRange()
    range.selectNode(linkMarker)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    imageNode.classList.add('vditor-ir__node--expand')
  }, 500)
}

function findSourceLinkHref(label: string) {
  const normalizedLabel = label.trim()
  const matches: string[] = []
  const linkPattern = /(^|[^!])\[((?:\\.|[^\]\\])*)\]\(\s*(?:<([^>]+)>|((?:\\.|[^)\s])+))/gm
  for (const match of props.modelValue.matchAll(linkPattern)) {
    const sourceLabel = match[2].replace(/\\([\\\[\]])/g, '$1').trim()
    if (sourceLabel === normalizedLabel) matches.push(match[3] || match[4])
  }
  return matches.length === 1 ? matches[0] : null
}

function createEditor() {
  if (!host.value) return
  editorReady.value = false
  editor = new Vditor(host.value, {
    value: props.modelValue,
    mode: props.mode,
    cdn: './vditor',
    height: '100%',
    minHeight: 240,
    lang: 'zh_CN',
    theme: darkThemeQuery.matches ? 'dark' : 'classic',
    cache: { enable: false },
    preview: {
      mode: 'editor',
      maxWidth: 100000,
      theme: {
        current: darkThemeQuery.matches ? 'dark' : 'light',
      },
      markdown: {
        codeBlockPreview: true,
        mathBlockPreview: true,
        linkBase: props.baseUrl,
      },
    },
    image: {
      isPreview: false,
    },
    toolbarConfig: { pin: true },
    upload: {
      multiple: true,
      handler: importFiles,
    },
    toolbar: [
      'headings', 'bold', 'italic', 'strike', '|',
      'list', 'ordered-list', 'check', '|',
      'quote', 'line', 'code', 'inline-code', '|',
      'link', 'upload',
      {
        name: 'table-picker',
        tip: '插入表格',
        icon: '<svg><use xlink:href="#vditor-icon-table"></use></svg>',
        click: () => emit('requestTable'),
      },
      {
        name: 'table-delete',
        tip: '删除当前表格',
        icon: '<svg viewBox="0 0 24 24"><path d="M4 5h16v14H4zM4 10h16M9 5v14M14 5v14M18 2l4 4M22 2l-4 4"/></svg>',
        click: () => {
          if (!deleteCurrentTable()) emit('operationError', '请先把光标放到要删除的表格中')
        },
      },
      '|', 'undo', 'redo', 'fullscreen',
    ],
    input(value) {
      if (editorReady.value && !applyingExternalValue) emit('update:modelValue', value)
    },
    after() {
      editorReady.value = true
      if (props.disabled) editor?.disabled()
      const editorElement = host.value
      if (editorElement) {
        fullscreenObserver?.disconnect()
        const updateFullscreen = () => {
          const fullscreen = editorElement.classList.contains('vditor--fullscreen')
          if (isFullscreen.value === fullscreen) return
          isFullscreen.value = fullscreen
          emit('fullscreenChange', fullscreen)
        }
        fullscreenObserver = new MutationObserver(updateFullscreen)
        fullscreenObserver.observe(editorElement, { attributes: true, attributeFilter: ['class'] })
        updateFullscreen()
      }
    },
  })
}

function scrollToHeading(headingIndex: number) {
  const content = props.mode === 'ir' ? editor?.vditor.ir.element : editor?.vditor.sv.element
  if (!content) return false
  const headings = Array.from(content.children).filter((element): element is HTMLElement => {
    if (!(element instanceof HTMLElement)) return false
    return /^H[1-6]$/.test(element.tagName) || Boolean(element.querySelector('[data-type="heading-marker"]'))
  })
  const heading = headings[headingIndex]
  if (!heading) return false
  content.scrollTop = Math.max(0, heading.offsetTop - 16)
  return true
}

function exitFullscreen() {
  if (!isFullscreen.value) return false
  const trigger = editor?.vditor.toolbar.elements.fullscreen?.firstElementChild as HTMLElement | undefined
  trigger?.click()
  return Boolean(trigger)
}

function insertNoteLink(label: string, href: string) {
  if (!editor || props.disabled) return false
  const safeHref = href.replaceAll(' ', '%20').replaceAll('(', '%28').replaceAll(')', '%29')
  editor.insertMD(`[${escapeLabel(label)}](${safeHref})`)
  return true
}

function insertTable(rows: number, columns: number) {
  if (!editor || props.disabled || rows < 2 || columns < 1) return false
  const header = `| ${Array.from({ length: columns }, (_, index) => `标题 ${index + 1}`).join(' | ')} |`
  const divider = `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`
  const body = Array.from({ length: rows - 1 }, () => `| ${Array.from({ length: columns }, () => ' ').join(' | ')} |`)
  editor.insertMD(`\n${[header, divider, ...body].join('\n')}\n\n`)
  return true
}

function deleteCurrentTable() {
  if (!editor || props.mode !== 'ir') return false
  const selection = window.getSelection()
  const selectionElement = selection?.anchorNode instanceof HTMLElement
    ? selection.anchorNode
    : selection?.anchorNode?.parentElement
  const tableNode = selectionElement?.closest<HTMLElement>('[data-type="table"], table')
    || (selectedTableNode?.isConnected ? selectedTableNode : null)
  if (!tableNode) return false
  const node = tableNode.matches('[data-type="table"]') ? tableNode : tableNode.closest<HTMLElement>('[data-type="table"]') || tableNode
  const range = document.createRange()
  range.selectNode(node)
  selection?.removeAllRanges()
  selection?.addRange(range)
  selectedTableNode = null
  editor.deleteValue()
  return true
}

function getEditorContent() {
  return props.mode === 'ir' ? editor?.vditor.ir.element : editor?.vditor.sv.element
}

function buildFindRanges(query: string) {
  const content = getEditorContent()
  if (!content || !query) return []

  const segments: Array<{ node: Text; start: number; end: number }> = []
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
  let text = ''
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (!node.data || (props.mode === 'ir' && node.parentElement?.closest('.vditor-ir__marker'))) continue
    const start = text.length
    text += node.data
    segments.push({ node, start, end: text.length })
  }

  const source = text.toLocaleLowerCase('zh-CN')
  const needle = query.toLocaleLowerCase('zh-CN')
  const ranges: Range[] = []
  let offset = 0
  while ((offset = source.indexOf(needle, offset)) !== -1) {
    const end = offset + needle.length
    const startSegment = segments.find((segment) => offset >= segment.start && offset < segment.end)
    const endSegment = segments.find((segment) => end > segment.start && end <= segment.end)
    if (startSegment && endSegment) {
      const range = document.createRange()
      range.setStart(startSegment.node, offset - startSegment.start)
      range.setEnd(endSegment.node, end - endSegment.start)
      ranges.push(range)
    }
    offset = end
  }
  return ranges
}

function findInNote(query: string, direction: -1 | 0 | 1 = 0) {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) {
    clearFind()
    return { total: 0, current: 0 }
  }

  if (normalizedQuery !== findQuery || direction === 0) {
    findQuery = normalizedQuery
    findRanges = buildFindRanges(normalizedQuery)
    findIndex = findRanges.length ? 0 : -1
  } else if (findRanges.length) {
    findIndex = (findIndex + direction + findRanges.length) % findRanges.length
  }

  const range = findRanges[findIndex]
  const content = getEditorContent()
  if (range && content) {
    showFindHighlight(range)
    const rangeRect = range.getBoundingClientRect()
    const contentRect = content.getBoundingClientRect()
    content.scrollTop += rangeRect.top - contentRect.top - content.clientHeight / 2
  } else {
    clearFindHighlight()
  }
  return { total: findRanges.length, current: findIndex + 1 }
}

function clearFind() {
  findQuery = ''
  findRanges = []
  findIndex = -1
  clearFindHighlight()
}

function getHtml() {
  return editor?.getHTML() ?? ''
}

function handleFullscreenShortcut(event: KeyboardEvent) {
  if (!isFullscreen.value) return
  const isExitShortcut = event.key === 'Escape' || (event.ctrlKey && event.key === '`')
  if (!isExitShortcut) return
  event.preventDefault()
  event.stopImmediatePropagation()
  exitFullscreen()
}

defineExpose({ scrollToHeading, exitFullscreen, insertNoteLink, insertTable, findInNote, clearFind, getHtml })

onMounted(() => {
  window.addEventListener('keydown', handleFullscreenShortcut, true)
  darkThemeQuery.addEventListener('change', updateEditorTheme)
  createEditor()
})

function updateEditorTheme(event: MediaQueryListEvent) {
  editor?.setTheme(event.matches ? 'dark' : 'classic', event.matches ? 'dark' : 'light')
}

watch(() => props.modelValue, (value) => {
  if (!editor || editor.getValue() === value) return
  applyingExternalValue = true
  editor.setValue(value, true)
  applyingExternalValue = false
})

watch(() => props.disabled, (disabled) => {
  if (disabled) editor?.disabled()
  else editor?.enable()
})

watch([() => props.mode, () => props.baseUrl], async () => {
  window.clearTimeout(imageClickTimer)
  imageClickTimer = undefined
  selectedImageNode = null
  fullscreenObserver?.disconnect()
  fullscreenObserver = null
  isFullscreen.value = false
  editorReady.value = false
  editor?.destroy()
  editor = null
  await nextTick()
  createEditor()
})

onBeforeUnmount(() => {
  window.clearTimeout(imageClickTimer)
  clearFindHighlight()
  window.removeEventListener('keydown', handleFullscreenShortcut, true)
  darkThemeQuery.removeEventListener('change', updateEditorTheme)
  fullscreenObserver?.disconnect()
  editor?.destroy()
})
</script>

<template>
  <div class="markdown-editor-shell">
    <div v-if="!editorReady" class="editor-loading" role="status">
      <span class="editor-loading-spinner" aria-hidden="true" />
      <span>编辑器正在加载…</span>
    </div>
    <div
      ref="host"
      class="markdown-editor"
      @click.capture="handleEditorClick"
      @keydown.capture="handleEditorKeydown"
    />
    <Teleport to="body">
      <header v-if="isFullscreen" class="fullscreen-header">
        <strong>{{ notePath }}</strong>
        <div>
          <button type="button" class="fullscreen-outline-button" aria-label="打开大纲" title="大纲" @click="emit('toggleOutline')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h2M4 12h2M4 18h2M10 6h10M10 12h10M10 18h10" /></svg>
          </button>
          <button type="button" @click="exitFullscreen">退出全屏</button>
        </div>
      </header>
    </Teleport>
  </div>
</template>
