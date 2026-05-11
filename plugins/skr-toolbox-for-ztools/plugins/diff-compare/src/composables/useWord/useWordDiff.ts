/**
 * Word文档差异比较Composable
 * 提供Word文档的差异比较功能，支持段落级别对比
 */

import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import mammoth from 'mammoth'
import { readFileAsArrayBuffer } from '@/utils/file'
import { getNextIndex, getPrevIndex } from '@/utils/diffNavigation'
import { DiffResult } from '@/core/diff/types'

/**
 * 段落块数据类型
 */
interface ParagraphBlock {
    /** 差异类型 */
    type: 'equal' | 'delete' | 'insert' | 'modify'
    /** 源文本 */
    sourceText: string
    /** 目标文本 */
    targetText: string
    /** 源HTML（可选） */
    sourceHtml?: string
    /** 目标HTML（可选） */
    targetHtml?: string
}

/**
 * 解析后的段落数据
 */
interface ParsedParagraph {
    /** 纯文本内容 */
    text: string
    /** HTML内容 */
    html: string
}

/**
 * 从HTML中提取段落
 * 提取p、h1-h6、li等块级元素的文本
 * @param html - HTML字符串
 * @returns 解析后的段落数组
 */
function extractParagraphs(html: string): ParsedParagraph[] {
    if (!html.trim()) return []
    const div = document.createElement('div')
    div.innerHTML = html
    const blocks = div.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li')
    const paragraphs: ParsedParagraph[] = []
    blocks.forEach(el => {
        const text = (el.textContent || '').trim()
        if (text) {
            paragraphs.push({
                text: text,
                html: el.outerHTML
            })
        }
    })
    if (paragraphs.length === 0 && html.trim()) {
        paragraphs.push({
            text: div.textContent?.trim() || '',
            html: html
        })
    }
    return paragraphs
}

/**
 * Word文档差异比较Composable
 */
export function useWordDiff() {
    /** 源文档HTML内容 */
    const sourceHtml = ref('')
    /** 目标文档HTML内容 */
    const targetHtml = ref('')
    /** 源文件名 */
    const sourceFileName = ref('')
    /** 目标文件名 */
    const targetFileName = ref('')
    /** 是否正在加载 */
    const loading = ref(false)
    /** 加载错误信息 */
    const loadError = ref('')

    /** 两份文档是否都已加载 */
    const bothLoaded = computed(() => !!sourceHtml.value && !!targetHtml.value)
    /** 段落块列表 */
    const paragraphBlocks = ref<ParagraphBlock[]>([])
    /** 是否正在计算差异 */
    const isDiffing = ref(false)
    /** 当前激活的段落块索引 */
    const activeBlockIdx = ref(-1)

    /** Web Worker实例 */
    let diffWorker: Worker | null = null
    /** 当前请求ID */
    let currentRequestId = 0

    /** 差异数量统计 */
    const diffCount = computed(() => paragraphBlocks.value.filter(b => b.type !== 'equal').length)

    /**
     * 计算文档差异
     * @param srcHtml - 源HTML
     * @param tgtHtml - 目标HTML
     */
    const computeDiff = async (srcHtml: string, tgtHtml: string) => {
        if (!srcHtml || !tgtHtml) {
            paragraphBlocks.value = []
            return
        }

        isDiffing.value = true
        const src = extractParagraphs(srcHtml)
        const tgt = extractParagraphs(tgtHtml)

        if (!diffWorker) {
            diffWorker = new Worker(new URL('@/core/diff/diff.worker.ts', import.meta.url), { type: 'module' })
        }

        const requestId = ++currentRequestId
        try {
            const workerResult: DiffResult<string>[] = await new Promise<DiffResult<string>[]>((resolve, reject) => {
                const handler = (e: MessageEvent) => {
                    const { requestId: resId, result, error } = e.data
                    if (resId === requestId) {
                        diffWorker!.removeEventListener('message', handler)
                        if (error) reject(error)
                        else resolve(result)
                    }
                }
                diffWorker!.addEventListener('message', handler)
                diffWorker!.postMessage({ type: 'word', source: src.map(p => p.text), target: tgt.map(p => p.text), requestId })
            })

            const srcMap = new Map(src.map((p, i) => [p.text, p.html]))
            const tgtMap = new Map(tgt.map((p, i) => [p.text, p.html]))

            const blocks: ParagraphBlock[] = []
            for (const result of workerResult) {
                if (result.type === 'equal') {
                    blocks.push({
                        type: 'equal',
                        sourceText: result.source as string || '',
                        targetText: result.target as string || '',
                        sourceHtml: srcMap.get(result.source as string) || result.source as string,
                        targetHtml: tgtMap.get(result.target as string) || result.target as string,
                    })
                } else if (result.type === 'delete') {
                    blocks.push({
                        type: 'delete',
                        sourceText: result.source as string || '',
                        targetText: '',
                        sourceHtml: srcMap.get(result.source as string) || result.source as string,
                        targetHtml: '',
                    })
                } else if (result.type === 'insert') {
                    blocks.push({
                        type: 'insert',
                        sourceText: '',
                        targetText: result.target as string || '',
                        sourceHtml: '',
                        targetHtml: tgtMap.get(result.target as string) || result.target as string,
                    })
                } else if (result.type === 'modify') {
                    blocks.push({
                        type: 'modify',
                        sourceText: result.source as string || '',
                        targetText: result.target as string || '',
                        sourceHtml: srcMap.get(result.source as string) || result.source as string,
                        targetHtml: tgtMap.get(result.target as string) || result.target as string,
                    })
                }
            }
            paragraphBlocks.value = blocks
        } catch (e) {
            console.error('Word diff calculation failed:', e)
        } finally {
            if (requestId === currentRequestId) {
                isDiffing.value = false
            }
        }
    }

    watch([sourceHtml, targetHtml], ([src, tgt]) => computeDiff(src, tgt), { immediate: true })

    /**
     * 处理文件输入
     * @param e - 输入事件
     * @param side - 文件放置位置：source-源文件，target-目标文件
     */
    const handleFile = async (e: Event, side: 'source' | 'target') => {
        const input = e.target as HTMLInputElement
        const files = input.files
        if (!files || files.length === 0) return

        loading.value = true
        loadError.value = ''
        try {
            if (files.length >= 2) {
                const [buf1, buf2] = await Promise.all([readFileAsArrayBuffer(files[0]), readFileAsArrayBuffer(files[1])])
                const [r1, r2] = await Promise.all([mammoth.convertToHtml({ arrayBuffer: buf1 }), mammoth.convertToHtml({ arrayBuffer: buf2 })])
                sourceHtml.value = r1.value
                targetHtml.value = r2.value
                sourceFileName.value = files[0].name
                targetFileName.value = files[1].name
            } else {
                const buf = await readFileAsArrayBuffer(files[0])
                const result = await mammoth.convertToHtml({ arrayBuffer: buf })
                if (side === 'source') {
                    sourceHtml.value = result.value
                    sourceFileName.value = files[0].name
                } else {
                    targetHtml.value = result.value
                    targetFileName.value = files[0].name
                }
            }
        } catch (err) {
            loadError.value = (err as Error).message || 'Failed to load Word document'
        } finally {
            loading.value = false
            input.value = ''
        }
    }

    /**
     * 清除所有数据
     */
    const clearItems = () => {
        sourceHtml.value = ''
        targetHtml.value = ''
        sourceFileName.value = ''
        targetFileName.value = ''
        loadError.value = ''
    }

    /**
     * 处理粘贴事件
     * 从剪贴板中提取Word文档
     * @param e - 剪贴板事件
     */
    const handlePaste = async (e: ClipboardEvent) => {
        const extractFiles = (await import('@/utils/clipboard')).extractFilesFromClipboard
        const files = extractFiles(e, (file: File) => /\.docx?$/i.test(file.name))
        if (files.length === 0) return
        loading.value = true
        loadError.value = ''
        try {
            if (files.length >= 2) {
                const [buf1, buf2] = await Promise.all([readFileAsArrayBuffer(files[0]), readFileAsArrayBuffer(files[1])])
                const [r1, r2] = await Promise.all([mammoth.convertToHtml({ arrayBuffer: buf1 }), mammoth.convertToHtml({ arrayBuffer: buf2 })])
                sourceHtml.value = r1.value
                targetHtml.value = r2.value
                sourceFileName.value = files[0].name
                targetFileName.value = files[1].name
            } else {
                const buf = await readFileAsArrayBuffer(files[0])
                const result = await mammoth.convertToHtml({ arrayBuffer: buf })
                if (sourceHtml.value) {
                    targetHtml.value = result.value
                    targetFileName.value = files[0].name
                } else {
                    sourceHtml.value = result.value
                    sourceFileName.value = files[0].name
                }
            }
        } catch (err) {
            loadError.value = (err as Error).message || 'Failed to load Word document'
        } finally {
            loading.value = false
        }
    }

    /**
     * 滚动到指定段落块
     * @param idx - 段落块索引
     * @param leftPanelRef - 左侧面板引用
     * @param rightPanelRef - 右侧面板引用
     * @param diffBarRef - 差异条引用
     */
    const scrollToBlock = (idx: number, leftPanelRef: HTMLElement | null, rightPanelRef: HTMLElement | null, diffBarRef: HTMLElement | null) => {
        activeBlockIdx.value = idx
        if (!leftPanelRef || !rightPanelRef || !diffBarRef) return

        const sourceEl = leftPanelRef.querySelector(`#source-${idx}`)
        const targetEl = rightPanelRef.querySelector(`#target-${idx}`)
        const barEl = (diffBarRef as any)?.scrollContainer?.querySelector(`#diff-bar-item-${idx}`)

        requestAnimationFrame(() => {
            sourceEl?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            targetEl?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            barEl?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        })
    }

    /**
     * 跳转到下一个差异段落
     * @returns 下一个差异的索引，未找到则返回undefined
     */
    const goToNextDiff = (): number | undefined => {
        const indices = paragraphBlocks.value.map((b, i) => b.type !== 'equal' ? i : -1).filter(i => i >= 0)
        const next = getNextIndex(indices, activeBlockIdx.value)
        if (next === -1) return
        return next
    }

    /**
     * 跳转到上一个差异段落
     * @returns 上一个差异的索引，未找到则返回undefined
     */
    const goToPrevDiff = (): number | undefined => {
        const indices = paragraphBlocks.value.map((b, i) => b.type !== 'equal' ? i : -1).filter(i => i >= 0)
        const prev = getPrevIndex(indices, activeBlockIdx.value)
        if (prev === -1) return
        return prev
    }

    onMounted(() => window.addEventListener('paste', handlePaste))
    onUnmounted(() => {
        window.removeEventListener('paste', handlePaste)
        if (diffWorker) {
            diffWorker.terminate()
            diffWorker = null
        }
    })

    return {
        sourceHtml,
        targetHtml,
        sourceFileName,
        targetFileName,
        loading,
        loadError,
        bothLoaded,
        paragraphBlocks,
        isDiffing,
        activeBlockIdx,
        diffCount,
        handleFile,
        clearItems,
        handlePaste,
        scrollToBlock,
        goToNextDiff,
        goToPrevDiff,
    }
}