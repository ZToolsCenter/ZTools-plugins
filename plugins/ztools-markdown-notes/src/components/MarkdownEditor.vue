<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Vditor from 'vditor'
import 'vditor/dist/index.css'
import { clearMarkdownImageWidth, getMarkdownImages, IMAGE_WIDTH_MAX, removeMarkdownImage, setMarkdownImageWidth } from '../imageSizeMetadata'

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
  operationError: [message: string, autoDismiss?: boolean]
}>()

const host = ref<HTMLElement | null>(null)
const shell = ref<HTMLElement | null>(null)
const isFullscreen = ref(false)
let editor: Vditor | null = null
const darkThemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
let applyingExternalValue = false
const editorReady = ref(false)
let selectedImageNode: HTMLElement | null = null
let selectedTableNode: HTMLElement | null = null
let fullscreenObserver: MutationObserver | null = null
let imageMarkerObserver: MutationObserver | null = null
const activeCodeBlockIndex = ref(-1)
const activeCodeLanguage = ref('')
const codeToolsStyle = ref<Record<string, string>>({})
const codeCopyLabel = ref('复制')
const isCodeLanguageListOpen = ref(false)
const imageMenu = ref<{ x: number; y: number; index: number; naturalWidth: number } | null>(null)
const imageSizeDialog = ref<{ index: number; width: number; naturalWidth: number } | null>(null)
const highlightMenu = ref<{ x: number; y: number } | null>(null)
let selectedHighlightNode: HTMLElement | null = null
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
    setSelectedImageNode(null)
    return
  }
  if (handleHighlightBoundaryDelete(event)) return

  let imageNode = selectedImageNode?.isConnected ? selectedImageNode : null

  const selection = window.getSelection()
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null

  const selectionElement = selection?.anchorNode instanceof HTMLElement
    ? selection.anchorNode
    : selection?.anchorNode?.parentElement
  const selectionNode = selectionElement?.closest<HTMLElement>('.vditor-ir__node')
  if (!imageNode && selectionNode?.querySelector('img')) imageNode = selectionNode
  if (!imageNode && selectionNode?.dataset.type === 'html-inline' && selectionNode.textContent?.includes('znotes:image-width')) {
    const previous = selectionNode.previousElementSibling
    if (previous instanceof HTMLElement && previous.querySelector('img')) imageNode = previous
  }
  if (!imageNode && range && range.startContainer === range.endContainer && range.endOffset === range.startOffset + 1) {
    const selectedNode = range.startContainer.childNodes[range.startOffset]
    if (selectedNode instanceof HTMLElement && selectedNode.classList.contains('vditor-ir__marker--link')) {
      imageNode = selectedNode.closest<HTMLElement>('.vditor-ir__node')
    }
  }
  if (!imageNode?.querySelector('img')) return

  event.preventDefault()
  event.stopPropagation()
  const rendered = Array.from(getEditorContent()?.querySelectorAll<HTMLImageElement>('img') ?? [])
  const imageIndex = rendered.indexOf(imageNode.querySelector('img') as HTMLImageElement)
  setSelectedImageNode(null)
  if (imageIndex < 0) return
  try {
    updateImageMarkdown(removeMarkdownImage(editor.getValue(), imageIndex), imageIndex)
  } catch (error) {
    emit('operationError', error instanceof Error ? error.message : '删除图片失败')
  }
}

function handleHighlightBoundaryDelete(event: KeyboardEvent) {
  if (!editor) return false
  const selection = window.getSelection()
  if (!selection?.isCollapsed || !selection.anchorNode) return false
  const anchorElement = selection.anchorNode instanceof HTMLElement
    ? selection.anchorNode
    : selection.anchorNode.parentElement
  const marker = anchorElement?.closest<HTMLElement>('.vditor-ir__marker')
  let markNode = marker?.closest<HTMLElement>('[data-type="mark"]') ?? null
  let removeLast = false
  let removeFirst = false
  if (!markNode) {
    const anchor = selection.anchorNode
    let adjacent: Node | null = null
    if (anchor instanceof HTMLElement) {
      adjacent = event.key === 'Backspace'
        ? anchor.childNodes[selection.anchorOffset - 1] ?? null
        : anchor.childNodes[selection.anchorOffset] ?? null
    } else if (anchor instanceof Text) {
      if (event.key === 'Backspace' && selection.anchorOffset === 0) adjacent = anchor.previousSibling
      if (event.key === 'Delete' && selection.anchorOffset === anchor.data.length) adjacent = anchor.nextSibling
    }
    if (adjacent instanceof HTMLElement && adjacent.dataset.type === 'mark') {
      markNode = adjacent
      removeLast = event.key === 'Backspace'
      removeFirst = event.key === 'Delete'
    }
  }
  if (!markNode) return false
  const markers = Array.from(markNode.children).filter((child): child is HTMLElement => (
    child instanceof HTMLElement && child.classList.contains('vditor-ir__marker')
  ))
  removeLast ||= event.key === 'Backspace' && marker === markers.at(-1)
  removeFirst ||= event.key === 'Delete' && marker === markers[0]
  if (!removeLast && !removeFirst) return false

  event.preventDefault()
  event.stopPropagation()
  const text = markNode.querySelector('mark')?.textContent ?? ''
  const remaining = removeLast ? text.slice(0, -1) : text.slice(1)
  const range = document.createRange()
  range.selectNode(markNode)
  selection.removeAllRanges()
  selection.addRange(range)
  editor.updateValue(remaining ? `==${remaining}==` : '')
  return true
}

function handleEditorClick(event: MouseEvent) {
  imageMenu.value = null
  highlightMenu.value = null
  selectedHighlightNode = null
  const target = event.target instanceof HTMLElement ? event.target : null
  if (!target?.closest('[data-type="code-block"]')) activeCodeBlockIndex.value = -1
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

  const imageNode = target?.closest<HTMLElement>('.vditor-ir__node')
  const image = target instanceof HTMLImageElement ? target : imageNode?.querySelector<HTMLImageElement>('img')
  if (props.mode !== 'ir' || !image || !imageNode) {
    setSelectedImageNode(null)
    scheduleImageWidths()
    return
  }

  event.preventDefault()
  event.stopPropagation()
  if (event.detail >= 2) {
    setSelectedImageNode(null)
    emit('previewImage', { src: image.currentSrc || image.src, alt: image.alt })
    return
  }

  setSelectedImageNode(imageNode)
}

function setSelectedImageNode(node: HTMLElement | null) {
  selectedImageNode?.classList.remove('znotes-image-selected')
  selectedImageNode = node
  selectedImageNode?.classList.add('znotes-image-selected')
}

function handleEditorMouseDown(event: MouseEvent) {
  if (props.mode !== 'ir' || !(event.target instanceof HTMLElement)) return
  const imageNode = event.target.closest<HTMLElement>('.vditor-ir__node')
  if (!imageNode?.querySelector('img')) return
  event.preventDefault()
  event.stopPropagation()
}

function applyImageWidths() {
  if (props.mode !== 'ir' || !editor) return
  const images = getMarkdownImages(editor.getValue())
  const rendered = getEditorContent()?.querySelectorAll<HTMLImageElement>('img') ?? []
  rendered.forEach((image, index) => {
    const width = images[index]?.width
    if (width) image.style.width = `${width}px`
    else image.style.removeProperty('width')
  })
  collapseImageMarkers()
}

function collapseImageMarkers() {
  const content = getEditorContent()
  if (!content || props.mode !== 'ir') return
  content.querySelectorAll<HTMLElement>('[data-type="img"].vditor-ir__node--expand').forEach((node) => {
    node.classList.remove('vditor-ir__node--expand')
  })
  content.querySelectorAll<HTMLElement>('[data-type="html-inline"].vditor-ir__node--expand').forEach((node) => {
    if (node.textContent?.includes('znotes:image-width')) node.classList.remove('vditor-ir__node--expand')
  })
}

function scheduleImageWidths() {
  nextTick(() => {
    window.setTimeout(applyImageWidths)
    window.setTimeout(applyImageWidths, 100)
  })
}

function handleEditorContextMenu(event: MouseEvent) {
  if (props.mode !== 'ir' || props.disabled || !(event.target instanceof HTMLElement)) return
  const markNode = event.target.closest<HTMLElement>('[data-type="mark"]')
  if (markNode) {
    event.preventDefault()
    event.stopPropagation()
    imageMenu.value = null
    selectedHighlightNode = markNode
    highlightMenu.value = {
      x: Math.min(event.clientX, window.innerWidth - 150),
      y: Math.min(event.clientY, window.innerHeight - 50),
    }
    return
  }
  const imageNode = event.target.closest<HTMLElement>('.vditor-ir__node')
  const image = event.target instanceof HTMLImageElement ? event.target : imageNode?.querySelector<HTMLImageElement>('img')
  if (!image) return
  highlightMenu.value = null
  selectedHighlightNode = null
  const rendered = Array.from(getEditorContent()?.querySelectorAll<HTMLImageElement>('img') ?? [])
  const index = rendered.indexOf(image)
  if (index < 0 || !getMarkdownImages(editor?.getValue() ?? '')[index]) return
  event.preventDefault()
  event.stopPropagation()
  imageMenu.value = {
    x: Math.min(event.clientX, window.innerWidth - 150),
    y: Math.min(event.clientY, window.innerHeight - 90),
    index,
    naturalWidth: image.naturalWidth,
  }
}

function openImageSizeDialog() {
  if (!editor || !imageMenu.value) return
  const selected = getMarkdownImages(editor.getValue())[imageMenu.value.index]
  if (!selected) return
  imageSizeDialog.value = {
    index: imageMenu.value.index,
    width: selected.width ?? imageMenu.value.naturalWidth,
    naturalWidth: imageMenu.value.naturalWidth,
  }
  imageMenu.value = null
}

function getImageBlockIndex(imageIndex: number) {
  const content = getEditorContent()
  const image = content?.querySelectorAll<HTMLImageElement>('img')[imageIndex]
  if (!content || !image) return null
  let block: HTMLElement | null = image
  while (block?.parentElement && block.parentElement !== content) block = block.parentElement
  return block?.parentElement === content ? Array.from(content.children).indexOf(block) : null
}

function restoreCaretNearBlock(blockIndex: number) {
  const content = getEditorContent()
  if (!content || content.children.length === 0) return
  const hasFollowingBlock = blockIndex < content.children.length
  const target = content.children[Math.min(blockIndex, content.children.length - 1)]
  if (!(target instanceof HTMLElement)) return
  const codeEditor = !hasFollowingBlock && target.dataset.type === 'code-block'
    ? target.querySelector<HTMLElement>('.vditor-ir__marker--pre code')
    : null
  if (codeEditor) target.classList.add('vditor-ir__node--expand')
  const range = document.createRange()
  range.selectNodeContents(codeEditor ?? target)
  range.collapse(codeEditor ? false : hasFollowingBlock)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  content.focus()
}

function updateImageMarkdown(nextValue: string, imageIndex?: number) {
  if (!editor) return
  const blockIndex = imageIndex === undefined ? null : getImageBlockIndex(imageIndex)
  editor.setValue(nextValue)
  emit('update:modelValue', nextValue)
  scheduleImageWidths()
  if (blockIndex !== null) nextTick(() => window.setTimeout(() => restoreCaretNearBlock(blockIndex)))
}

function saveImageSize() {
  if (!editor || !imageSizeDialog.value) return
  try {
    updateImageMarkdown(setMarkdownImageWidth(editor.getValue(), imageSizeDialog.value.index, imageSizeDialog.value.width), imageSizeDialog.value.index)
    imageSizeDialog.value = null
  } catch (error) {
    emit('operationError', error instanceof Error ? error.message : '图片尺寸设置失败')
  }
}

function setImageScale(percent: number) {
  if (!imageSizeDialog.value || !imageSizeDialog.value.naturalWidth) return
  imageSizeDialog.value.width = Math.min(IMAGE_WIDTH_MAX, Math.max(1, Math.round(imageSizeDialog.value.naturalWidth * percent / 100)))
}

function restoreImageAutoSize() {
  if (!editor || !imageMenu.value) return
  try {
    updateImageMarkdown(clearMarkdownImageWidth(editor.getValue(), imageMenu.value.index), imageMenu.value.index)
  } catch (error) {
    emit('operationError', error instanceof Error ? error.message : '恢复图片尺寸失败')
  } finally {
    imageMenu.value = null
  }
}

function deleteImageFromMenu() {
  if (!editor || !imageMenu.value) return
  try {
    updateImageMarkdown(removeMarkdownImage(editor.getValue(), imageMenu.value.index), imageMenu.value.index)
  } catch (error) {
    emit('operationError', error instanceof Error ? error.message : '删除图片失败')
  } finally {
    imageMenu.value = null
    setSelectedImageNode(null)
  }
}

function removeSelectedHighlight() {
  if (!editor || !selectedHighlightNode?.isConnected) return
  const selection = window.getSelection()
  const range = document.createRange()
  range.selectNode(selectedHighlightNode)
  selection?.removeAllRanges()
  selection?.addRange(range)
  editor.updateValue(selectedHighlightNode.querySelector('mark')?.textContent ?? '')
  highlightMenu.value = null
  selectedHighlightNode = null
}

const codeLanguages = [
  { value: '', label: '纯文本', aliases: ['text', 'plain', 'txt'] },
  { value: 'javascript', label: 'JavaScript', aliases: ['js', 'node'] },
  { value: 'typescript', label: 'TypeScript', aliases: ['ts'] },
  { value: 'html', label: 'HTML', aliases: ['htm'] },
  { value: 'css', label: 'CSS', aliases: [] },
  { value: 'vue', label: 'Vue', aliases: [] },
  { value: 'jsx', label: 'JSX', aliases: ['react'] },
  { value: 'tsx', label: 'TSX', aliases: ['react'] },
  { value: 'json', label: 'JSON', aliases: [] },
  { value: 'markdown', label: 'Markdown', aliases: ['md'] },
  { value: 'bash', label: 'Bash', aliases: ['sh', 'shell', 'zsh'] },
  { value: 'python', label: 'Python', aliases: ['py'] },
  { value: 'java', label: 'Java', aliases: [] },
  { value: 'c', label: 'C', aliases: [] },
  { value: 'cpp', label: 'C++', aliases: ['c++'] },
  { value: 'csharp', label: 'C#', aliases: ['cs', 'c#'] },
  { value: 'go', label: 'Go', aliases: ['golang'] },
  { value: 'rust', label: 'Rust', aliases: ['rs'] },
  { value: 'kotlin', label: 'Kotlin', aliases: ['kt'] },
  { value: 'swift', label: 'Swift', aliases: [] },
  { value: 'php', label: 'PHP', aliases: [] },
  { value: 'ruby', label: 'Ruby', aliases: ['rb'] },
  { value: 'sql', label: 'SQL', aliases: [] },
  { value: 'yaml', label: 'YAML', aliases: ['yml'] },
  { value: 'xml', label: 'XML', aliases: [] },
  { value: 'toml', label: 'TOML', aliases: [] },
  { value: 'diff', label: 'Diff', aliases: ['patch'] },
]

const filteredCodeLanguages = computed(() => {
  const query = activeCodeLanguage.value.trim().toLocaleLowerCase('en-US')
  if (!query) return codeLanguages
  return codeLanguages.filter((language) => (
    language.value.includes(query) ||
    language.label.toLocaleLowerCase('en-US').includes(query) ||
    language.aliases.some((alias) => alias.includes(query))
  ))
})

function chooseCodeLanguage(language: string) {
  activeCodeLanguage.value = language
  isCodeLanguageListOpen.value = false
  changeCodeLanguage()
}

function finishCodeLanguageEditing() {
  changeCodeLanguage()
  window.setTimeout(() => {
    isCodeLanguageListOpen.value = false
  }, 120)
}

function codeBlockRanges(markdown: string) {
  const lines = markdown.match(/.*(?:\r?\n|$)/g) ?? []
  const ranges: Array<{ infoStart: number; infoEnd: number; language: string }> = []
  let offset = 0
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const opening = line.match(/^(\s*)(`{3,}|~{3,})([^\r\n]*)/)
    if (!opening) {
      offset += line.length
      continue
    }
    const fence = opening[2]
    const infoStart = offset + opening[1].length + fence.length
    const infoEnd = offset + line.replace(/\r?\n$/, '').length
    ranges.push({ infoStart, infoEnd, language: opening[3].trim() })
    offset += line.length
    const closingPattern = new RegExp(`^\\s*${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*(?:\\r?\\n)?$`)
    while (index + 1 < lines.length) {
      index += 1
      const candidate = lines[index]
      offset += candidate.length
      if (closingPattern.test(candidate)) break
    }
  }
  return ranges
}

function updateCodeTools(block: HTMLElement) {
  const content = getEditorContent()
  const editorShell = shell.value
  if (!content || !editorShell) return
  const blocks = Array.from(content.querySelectorAll<HTMLElement>('[data-type="code-block"]'))
  const index = blocks.indexOf(block)
  if (index < 0) return
  const blockRect = block.getBoundingClientRect()
  const shellRect = editorShell.getBoundingClientRect()
  activeCodeBlockIndex.value = index
  if (!(document.activeElement instanceof HTMLElement && document.activeElement.classList.contains('code-language-input'))) {
    activeCodeLanguage.value = codeBlockRanges(editor?.getValue() ?? '')[index]?.language ?? ''
  }
  codeToolsStyle.value = {
    top: `${blockRect.top - shellRect.top + 6}px`,
    right: `${Math.max(8, shellRect.right - blockRect.right + 8)}px`,
  }
  codeCopyLabel.value = '复制'
}

function handleEditorPointerOver(event: PointerEvent) {
  if (props.mode !== 'ir') return
  const target = event.target instanceof HTMLElement ? event.target : null
  const block = target?.closest<HTMLElement>('[data-type="code-block"]')
  if (block) updateCodeTools(block)
}

function changeCodeLanguage() {
  if (!editor || activeCodeBlockIndex.value < 0) return
  const markdown = editor.getValue()
  const range = codeBlockRanges(markdown)[activeCodeBlockIndex.value]
  if (!range) return
  const language = activeCodeLanguage.value.trim().replace(/\s+/g, '')
  const nextValue = `${markdown.slice(0, range.infoStart)}${language}${markdown.slice(range.infoEnd)}`
  editor.setValue(nextValue)
  emit('update:modelValue', nextValue)
  nextTick(() => {
    const block = getEditorContent()?.querySelectorAll<HTMLElement>('[data-type="code-block"]')[activeCodeBlockIndex.value]
    if (block) updateCodeTools(block)
  })
}

async function copyActiveCode() {
  const block = getEditorContent()?.querySelectorAll<HTMLElement>('[data-type="code-block"]')[activeCodeBlockIndex.value]
  const code = block?.querySelector<HTMLElement>('.vditor-ir__preview code, .vditor-ir__marker--pre code')?.innerText
  if (code === undefined) return
  try {
    await navigator.clipboard.writeText(code.replace(/\n$/, ''))
    codeCopyLabel.value = '已复制'
  } catch {
    emit('operationError', '复制代码失败')
  }
}

function insertHighlight() {
  if (!editor || props.disabled) return
  const selected = editor.getSelection()
  if (!selected) {
    emit('operationError', '请先选择要高亮的文本', true)
    return
  }
  if (selected.startsWith('==') && selected.endsWith('==') && selected.length > 4) {
    editor.updateValue(selected.slice(2, -2))
    return
  }
  const selection = window.getSelection()
  const startElement = selection?.anchorNode instanceof HTMLElement ? selection.anchorNode : selection?.anchorNode?.parentElement
  const endElement = selection?.focusNode instanceof HTMLElement ? selection.focusNode : selection?.focusNode?.parentElement
  const startMark = startElement?.closest<HTMLElement>('[data-type="mark"]')
  if (startMark && startMark === endElement?.closest('[data-type="mark"]')) {
    const range = document.createRange()
    range.selectNode(startMark)
    selection?.removeAllRanges()
    selection?.addRange(range)
    editor.updateValue(startMark.querySelector('mark')?.textContent ?? selected)
    return
  }
  editor.updateValue(`==${selected}==`)
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
        mark: true,
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
      'headings', 'bold', 'italic', 'strike',
      {
        name: 'highlight',
        tip: '高亮选中文本',
        icon: '<svg viewBox="0 0 24 24"><path d="M5 19h14M8 15l7-7 3 3-7 7H8v-3zM14 6l2-2 4 4-2 2z"/></svg>',
        click: insertHighlight,
      }, '|',
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
      if (editorReady.value && !applyingExternalValue) {
        emit('update:modelValue', value)
        scheduleImageWidths()
      }
    },
    after() {
      editorReady.value = true
      scheduleImageWidths()
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
      imageMarkerObserver?.disconnect()
      const irContent = editor?.vditor.ir.element
      if (irContent) {
        imageMarkerObserver = new MutationObserver(collapseImageMarkers)
        imageMarkerObserver.observe(irContent, { attributes: true, attributeFilter: ['class'], subtree: true })
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
  scheduleImageWidths()
})

watch(() => props.disabled, (disabled) => {
  if (disabled) editor?.disabled()
  else editor?.enable()
})

watch([() => props.mode, () => props.baseUrl], async () => {
  setSelectedImageNode(null)
  fullscreenObserver?.disconnect()
  fullscreenObserver = null
  imageMarkerObserver?.disconnect()
  imageMarkerObserver = null
  isFullscreen.value = false
  editorReady.value = false
  editor?.destroy()
  editor = null
  await nextTick()
  createEditor()
})

onBeforeUnmount(() => {
  clearFindHighlight()
  window.removeEventListener('keydown', handleFullscreenShortcut, true)
  darkThemeQuery.removeEventListener('change', updateEditorTheme)
  fullscreenObserver?.disconnect()
  imageMarkerObserver?.disconnect()
  editor?.destroy()
})
</script>

<template>
  <div ref="shell" class="markdown-editor-shell">
    <div v-if="!editorReady" class="editor-loading" role="status">
      <span class="editor-loading-spinner" aria-hidden="true" />
      <span>编辑器正在加载…</span>
    </div>
    <div
      ref="host"
      class="markdown-editor"
      @click.capture="handleEditorClick"
      @contextmenu.capture="handleEditorContextMenu"
      @keydown.capture="handleEditorKeydown"
      @mousedown.capture="handleEditorMouseDown"
      @pointerover.capture="handleEditorPointerOver"
    />
    <div v-if="activeCodeBlockIndex >= 0 && editorReady && mode === 'ir'" class="code-block-tools" :style="codeToolsStyle">
      <input
        class="code-language-input"
        v-model="activeCodeLanguage"
        aria-label="代码语言"
        title="代码语言"
        placeholder="纯文本"
        autocomplete="off"
        @focus="isCodeLanguageListOpen = true"
        @input="isCodeLanguageListOpen = true"
        @blur="finishCodeLanguageEditing"
        @keydown.enter.prevent="changeCodeLanguage(); isCodeLanguageListOpen = false"
        @keydown.escape.prevent="isCodeLanguageListOpen = false"
      />
      <div v-if="isCodeLanguageListOpen" class="code-language-options">
        <button
          v-for="language in filteredCodeLanguages"
          :key="language.value"
          type="button"
          @mousedown.prevent="chooseCodeLanguage(language.value)"
        >
          <span>{{ language.label }}</span>
          <small v-if="language.aliases.length">{{ language.aliases.join(' · ') }}</small>
        </button>
        <p v-if="filteredCodeLanguages.length === 0">按当前输入作为语言标记</p>
      </div>
      <button type="button" @click="copyActiveCode">{{ codeCopyLabel }}</button>
    </div>
    <Teleport to="body">
      <div v-if="imageMenu" class="image-context-menu" :style="{ left: `${imageMenu.x}px`, top: `${imageMenu.y}px` }" @click.stop>
        <button type="button" @click="openImageSizeDialog">调整大小…</button>
        <button type="button" @click="restoreImageAutoSize">恢复自动大小</button>
        <button type="button" class="danger-menu-item" @click="deleteImageFromMenu">删除图片</button>
      </div>
      <div v-if="highlightMenu" class="image-context-menu" :style="{ left: `${highlightMenu.x}px`, top: `${highlightMenu.y}px` }" @click.stop>
        <button type="button" @click="removeSelectedHighlight">取消高亮</button>
      </div>
      <div v-if="imageSizeDialog" class="modal-backdrop" @click.self="imageSizeDialog = null">
        <section class="image-size-dialog" role="dialog" aria-modal="true" aria-labelledby="image-size-title">
          <h2 id="image-size-title">调整图片大小</h2>
          <p>只设置宽度，高度会按原始比例自动调整。</p>
          <label>
            宽度
            <span><input v-model.number="imageSizeDialog.width" type="number" min="1" :max="IMAGE_WIDTH_MAX" step="1" autofocus /> px</span>
          </label>
          <div class="image-size-presets" aria-label="常用图片比例">
            <span>常用比例</span>
            <button v-for="percent in [50, 70, 100, 120, 150]" :key="percent" type="button" @click="setImageScale(percent)">{{ percent }}%</button>
          </div>
          <small v-if="imageSizeDialog.naturalWidth">原始宽度：{{ imageSizeDialog.naturalWidth }} px</small>
          <footer>
            <button type="button" class="secondary" @click="imageSizeDialog = null">取消</button>
            <button type="button" :disabled="!Number.isInteger(imageSizeDialog.width) || imageSizeDialog.width < 1 || imageSizeDialog.width > IMAGE_WIDTH_MAX" @click="saveImageSize">确定</button>
          </footer>
        </section>
      </div>
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
