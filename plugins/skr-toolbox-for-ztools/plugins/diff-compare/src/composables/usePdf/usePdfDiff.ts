import { ref, shallowRef, computed, onUnmounted, nextTick } from 'vue'
import { toRaw, markRaw } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import type { IOcrEngine, OcrConfig } from '@/core/ocr'
import { createOcrEngine } from '@/core/ocr'
import { TextItem } from '@/core/diff/pdf/pdf.ts'
import { readFileAsArrayBuffer } from '@/utils/file'
import { getNextIndex, getPrevIndex } from '@/utils/diffNavigation'

import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

interface DiffBlock {
    type: 'equal' | 'delete' | 'insert' | 'modify'
    sourceText: string
    targetText: string
    sourcePage?: number
    targetPage?: number
    sourceIndex?: number
    targetIndex?: number
}

interface DiffHighlight {
    text: string
    type: 'delete' | 'insert' | 'modify'
    pageNum: number
    bbox: { x: number; y: number; width: number; height: number }
    index: number
}

function groupByLine(items: any[], tolerance = 2) {
    const lines: { y: number; items: TextItem[] }[] = []

    for (const item of items) {
        const y = item.transform[5]
        let line = lines.find(l => Math.abs(l.y - y) < tolerance)

        if (!line) {
            line = { y, items: [] }
            lines.push(line)
        }
        line.items.push(item)
    }

    return lines.map(line => {
        line.items.sort((a, b) => a.transform[4] - b.transform[4])
        return line.items
    })
}

function mergeLineTokens(items: any[]) {
    const noSpaceBefore = new Set(['|', ',', '.', ':', ';', ')', ']'])
    const noSpaceAfter = new Set(['(', '['])

    let text = ''

    for (let i = 0; i < items.length; i++) {
        const current = items[i]
        const prev = items[i - 1]
        const str = current.str

        if (!prev) {
            text += str
            continue
        }

        const prevStr = prev.str
        const gap = current.transform[4] - (prev.transform[4] + prev.width)

        if (noSpaceBefore.has(str)) {
            text += str
        } else if (noSpaceAfter.has(prevStr)) {
            text += str
        } else if (gap > 2) {
            text += ' ' + str
        } else {
            text += str
        }
    }

    return text.trim()
}

export function usePdfDiff() {
    const sourceFileName = ref('')
    const targetFileName = ref('')
    const loading = ref(false)
    const loadError = ref('')
    const ocrStatus = ref('')
    const ocrEngine = ref<'pdfjs' | 'tesseract'>('pdfjs')
    const zoom = ref(1.2)

    const sourcePdfDoc = shallowRef<any>(null)
    const targetPdfDoc = shallowRef<any>(null)
    const sourceTextItems = shallowRef<TextItem[]>([])
    const targetTextItems = shallowRef<TextItem[]>([])

    const bothLoaded = computed(() => {
        return !!sourcePdfDoc.value && !!targetPdfDoc.value
    })

    const diffBlocks = shallowRef<DiffBlock[]>([])
    const diffHighlights = shallowRef<{ source: DiffHighlight[]; target: DiffHighlight[] }>({ source: [], target: [] })
    const isDiffing = ref(false)
    const activeBlockIdx = ref(-1)

    let ocrEngineInstance: IOcrEngine | null = null
    let diffWorker: Worker | null = null
    let currentRequestId = 0

    const diffCount = computed(() => {
        return diffBlocks.value.filter(b => b.type !== 'equal').length
    })

    const initOcrEngine = async (): Promise<IOcrEngine> => {
        if (ocrEngineInstance && ocrEngineInstance.name === ocrEngine.value) {
            return ocrEngineInstance
        }

        const config: OcrConfig = {
            engine: ocrEngine.value,
            language: 'chi_sim+eng',
        }

        ocrEngineInstance = createOcrEngine(config)

        if (ocrEngineInstance.init) {
            ocrStatus.value = 'Initializing OCR engine...'
            await ocrEngineInstance.init()
        }

        return ocrEngineInstance
    }

    const extractTextItemsFromPdf = async (pdf: pdfjsLib.PDFDocumentProxy): Promise<TextItem[]> => {
        const items: TextItem[] = []
        const numPages = pdf.numPages
        let globalIndex = 0

        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
            const page = await pdf.getPage(pageNum)
            const textContent = await page.getTextContent({ disableNormalization: false })
            const lines = groupByLine(textContent.items)

            for (const line of lines) {
                const mergedText = mergeLineTokens(line)
                if (mergedText.trim()) {
                    const firstItem = line[0]
                    const lastItem = line[line.length - 1]
                    const transform = firstItem.transform
                    const [scaleX, skewY, skewX, scaleY, translateX, translateY] = transform || [12, 0, 0, 12, 0, 0]

                    const bboxX = translateX || 0
                    const bboxY = translateY || 0
                    const bboxWidth = lastItem.transform[4] + (lastItem as any).width - bboxX
                    const bboxHeight = Math.abs(scaleY || 12)

                    items.push({
                        str: mergedText,
                        transform,
                        pageNum,
                        index: globalIndex++,
                        bbox: { x: bboxX, y: bboxY, width: bboxWidth, height: bboxHeight },
                    })
                }
            }
        }
        return items
    }

    const extractTextItemsWithOcr = async (pdf: pdfjsLib.PDFDocumentProxy, scale = 1.5): Promise<TextItem[]> => {
        const items: TextItem[] = []
        const numPages = pdf.numPages
        let globalIndex = 0

        const engine = await initOcrEngine()

        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
            ocrStatus.value = `Processing PDF ${pageNum}/${numPages}...`

            const page = await pdf.getPage(pageNum)
            const viewport = page.getViewport({ scale })

            const canvas = document.createElement('canvas')
            canvas.width = viewport.width
            canvas.height = viewport.height
            const ctx = canvas.getContext('2d')!

            ctx.fillStyle = 'white'
            ctx.fillRect(0, 0, canvas.width, canvas.height)

            await page.render({ canvasContext: ctx, canvas, viewport }).promise

            const imageUrl = canvas.toDataURL('image/png')
            const ocrResults = await engine.recognize(imageUrl)

            for (const ocrItem of ocrResults) {
                if (ocrItem.text.trim()) {
                    items.push({
                        str: ocrItem.text,
                        transform: [ocrItem.bbox.height, 0, 0, ocrItem.bbox.height, ocrItem.bbox.x, ocrItem.bbox.y],
                        pageNum,
                        index: globalIndex++,
                        bbox: ocrItem.bbox,
                        confidence: ocrItem.confidence,
                    })
                }
            }
        }
        return items
    }

    const extractTextItems = (pdf: pdfjsLib.PDFDocumentProxy): Promise<TextItem[]> => {
        if (ocrEngine.value === 'tesseract') return extractTextItemsWithOcr(pdf)
        return extractTextItemsFromPdf(pdf)
    }

    const renderPage = async (pdf: pdfjsLib.PDFDocumentProxy, pageNum: number, container: HTMLElement, highlights: DiffHighlight[] = []): Promise<void> => {
        const page = await pdf.getPage(pageNum)
        const scale = zoom.value
        const viewport = page.getViewport({ scale })

        const pageWrapper = document.createElement('div')
        pageWrapper.className = 'pdf-page-wrapper'
        pageWrapper.id = `page-${pageNum}`
        pageWrapper.dataset.pageNum = String(pageNum)

        const canvasContainer = document.createElement('div')
        canvasContainer.className = 'pdf-canvas-container'

        const canvas = document.createElement('canvas')
        canvas.className = 'pdf-canvas'
        const ctx = canvas.getContext('2d')!

        canvas.width = viewport.width
        canvas.height = viewport.height

        await page.render({ canvasContext: ctx, canvas, viewport }).promise
        canvasContainer.appendChild(canvas)

        const pageHighlights = highlights.filter(h => h.pageNum === pageNum)
        if (pageHighlights.length > 0) {
            const ctx = canvas.getContext('2d')
            if (ctx) {
                for (const highlight of pageHighlights) {
                    const { x, y, width, height } = highlight.bbox
                    const canvasY = viewport.height - (y + height) * scale
                    const canvasX = x * scale
                    const canvasW = width * scale
                    const canvasH = height * scale

                    if (canvasW > 0 && canvasH > 0) {
                        if (highlight.type === 'delete') ctx.fillStyle = 'rgba(255, 0, 0, 0.3)'
                        else if (highlight.type === 'insert') ctx.fillStyle = 'rgba(0, 200, 0, 0.3)'
                        else if (highlight.type === 'modify') ctx.fillStyle = 'rgba(255, 165, 0, 0.3)'
                        ctx.fillRect(canvasX, canvasY, canvasW, canvasH)

                        if (highlight.type === 'delete') ctx.fillStyle = '#ff0000'
                        else if (highlight.type === 'insert') ctx.fillStyle = '#00c800'
                        else if (highlight.type === 'modify') ctx.fillStyle = '#ffa500'
                        ctx.fillRect(canvasX, canvasY + canvasH - 2, canvasW, 2)
                    }
                }
            }
        }

        pageWrapper.appendChild(canvasContainer)
        container.appendChild(pageWrapper)
    }

    const renderPdf = async (pdf: pdfjsLib.PDFDocumentProxy, container: HTMLElement, highlights: DiffHighlight[] = [], preserveScroll = true): Promise<void> => {
        const scrollTop = preserveScroll ? container.parentElement?.scrollTop || 0 : 0
        container.innerHTML = ''
        const numPages = pdf.numPages
        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
            await renderPage(pdf, pageNum, container, highlights)
        }
        if (preserveScroll && container.parentElement) {
            container.parentElement.scrollTop = scrollTop
        }
    }

    const setZoom = async (newZoom: number, sourceViewerRef: HTMLElement | null, targetViewerRef: HTMLElement | null) => {
        zoom.value = Math.max(0.3, Math.min(newZoom, 5))
        if (sourcePdfDoc.value && sourceViewerRef) {
            await renderPdf(sourcePdfDoc.value, sourceViewerRef, diffHighlights.value.source, true)
        }
        if (targetPdfDoc.value && targetViewerRef) {
            await renderPdf(targetPdfDoc.value, targetViewerRef, diffHighlights.value.target, true)
        }
    }

    const zoomIn = (sourceViewerRef: HTMLElement | null, targetViewerRef: HTMLElement | null) => {
        setZoom(zoom.value + 0.2, sourceViewerRef, targetViewerRef)
    }

    const zoomOut = (sourceViewerRef: HTMLElement | null, targetViewerRef: HTMLElement | null) => {
        setZoom(zoom.value - 0.2, sourceViewerRef, targetViewerRef)
    }

    const zoomReset = (sourceViewerRef: HTMLElement | null, targetViewerRef: HTMLElement | null) => {
        setZoom(1.2, sourceViewerRef, targetViewerRef)
    }

    const computeDiff = async (srcItems: TextItem[], tgtItems: TextItem[], sourceViewerRef: HTMLElement | null, targetViewerRef: HTMLElement | null): Promise<void> => {
        if (srcItems.length === 0 || tgtItems.length === 0) {
            diffBlocks.value = markRaw([])
            return
        }

        isDiffing.value = true

        if (!diffWorker) {
            diffWorker = new Worker(new URL('@/core/diff/diff.worker.ts', import.meta.url), { type: 'module' })
        }

        const requestId = ++currentRequestId

        try {
            const workerResult = await new Promise<unknown>((resolve, reject) => {
                const handler = (e: MessageEvent) => {
                    const { requestId: resId, result, error } = e.data
                    if (resId === requestId) {
                        diffWorker!.removeEventListener('message', handler)
                        if (error) reject(error)
                        else resolve(result)
                    }
                }
                diffWorker!.addEventListener('message', handler)
                diffWorker!.postMessage({ type: 'pdf', source: toRaw(srcItems), target: toRaw(tgtItems), requestId })
            }) as Array<{ type: string; source?: TextItem; target?: TextItem }>

            const blocks: DiffBlock[] = []
            const sourceHighlights: DiffHighlight[] = []
            const targetHighlights: DiffHighlight[] = []

            let srcIdx = 0
            let tgtIdx = 0

            for (const diff of workerResult) {
                const sourceItem = diff.source
                const targetItem = diff.target
                if (diff.type === 'equal') {
                    blocks.push({ type: 'equal', sourceText: sourceItem?.str || '', targetText: targetItem?.str || '', sourcePage: sourceItem?.pageNum, targetPage: targetItem?.pageNum, sourceIndex: srcIdx, targetIndex: tgtIdx })
                    srcIdx++
                    tgtIdx++
                } else if (diff.type === 'delete') {
                    blocks.push({ type: 'delete', sourceText: sourceItem?.str || '', targetText: '', sourcePage: sourceItem?.pageNum, targetPage: tgtItems[tgtIdx]?.pageNum, sourceIndex: srcIdx, targetIndex: tgtIdx })
                    if (sourceItem) sourceHighlights.push({ text: sourceItem.str || '', type: 'delete', pageNum: sourceItem.pageNum, bbox: sourceItem.bbox || { x: 0, y: 0, width: 100, height: 20 }, index: srcIdx })
                    srcIdx++
                } else if (diff.type === 'insert') {
                    blocks.push({ type: 'insert', sourceText: '', targetText: targetItem?.str || '', sourcePage: srcItems[srcIdx]?.pageNum, targetPage: targetItem?.pageNum, sourceIndex: srcIdx, targetIndex: tgtIdx })
                    if (targetItem) targetHighlights.push({ text: targetItem.str || '', type: 'insert', pageNum: targetItem.pageNum, bbox: targetItem.bbox || { x: 0, y: 0, width: 100, height: 20 }, index: tgtIdx })
                    tgtIdx++
                } else if (diff.type === 'modify') {
                    blocks.push({ type: 'modify', sourceText: sourceItem?.str || '', targetText: targetItem?.str || '', sourcePage: sourceItem?.pageNum, targetPage: targetItem?.pageNum, sourceIndex: srcIdx, targetIndex: tgtIdx })
                    if (sourceItem) sourceHighlights.push({ text: sourceItem.str || '', type: 'modify', pageNum: sourceItem.pageNum, bbox: sourceItem.bbox || { x: 0, y: 0, width: 100, height: 20 }, index: srcIdx })
                    if (targetItem) targetHighlights.push({ text: targetItem.str || '', type: 'modify', pageNum: targetItem.pageNum, bbox: targetItem.bbox || { x: 0, y: 0, width: 100, height: 20 }, index: tgtIdx })
                    srcIdx++
                    tgtIdx++
                }
            }

            diffBlocks.value = markRaw(blocks)
            diffHighlights.value = markRaw({ source: sourceHighlights, target: targetHighlights })

            await nextTick()
            await renderHighlights(sourceViewerRef, targetViewerRef)
        } catch (e) {
            console.error('PDF diff calculation failed:', e)
            loadError.value = String(e)
        } finally {
            if (requestId === currentRequestId) {
                isDiffing.value = false
                ocrStatus.value = ''
            }
        }
    }

    const renderHighlights = async (sourceViewerRef: HTMLElement | null, targetViewerRef: HTMLElement | null) => {
        if (!sourceViewerRef || !targetViewerRef) return
        if (!sourcePdfDoc.value || !targetPdfDoc.value) return

        await renderPdf(sourcePdfDoc.value, sourceViewerRef, diffHighlights.value.source)
        await renderPdf(targetPdfDoc.value, targetViewerRef, diffHighlights.value.target)
    }

    const processAfterFileLoad = async (sourceViewerRef: HTMLElement | null, targetViewerRef: HTMLElement | null) => {
        if (ocrEngine.value === 'tesseract') {
            if (sourcePdfDoc.value && targetPdfDoc.value) {
                const [items1, items2] = await Promise.all([extractTextItems(sourcePdfDoc.value), extractTextItems(targetPdfDoc.value)])
                sourceTextItems.value = markRaw(items1)
                targetTextItems.value = markRaw(items2)

                await nextTick()
                await Promise.all([
                    sourceViewerRef ? renderPdf(sourcePdfDoc.value, sourceViewerRef) : Promise.resolve(),
                    targetViewerRef ? renderPdf(targetPdfDoc.value, targetViewerRef) : Promise.resolve(),
                ])

                await computeDiff(items1, items2, sourceViewerRef, targetViewerRef)
            }
        } else {
            if (sourcePdfDoc.value && sourceTextItems.value.length === 0) {
                const items = await extractTextItemsFromPdf(sourcePdfDoc.value)
                sourceTextItems.value = markRaw(items)
                if (sourceViewerRef) {
                    await renderPdf(sourcePdfDoc.value, sourceViewerRef)
                }
            }
            if (targetPdfDoc.value && targetTextItems.value.length === 0) {
                const items = await extractTextItemsFromPdf(targetPdfDoc.value)
                targetTextItems.value = markRaw(items)
                if (targetViewerRef) await renderPdf(targetPdfDoc.value, targetViewerRef)
            }
            if (sourceTextItems.value.length > 0 && targetTextItems.value.length > 0) {
                await computeDiff(sourceTextItems.value, targetTextItems.value, sourceViewerRef, targetViewerRef)
            }
        }
    }

    const processFile = async (e: Event, side: 'source' | 'target', getSourceViewerRef: () => HTMLElement | null, getTargetViewerRef: () => HTMLElement | null) => {
        const input = e.target as HTMLInputElement
        const files = input.files
        if (!files || files.length === 0) return

        loading.value = true
        loadError.value = ''

        try {
            if (files.length >= 2) {
                const [buf1, buf2] = await Promise.all([readFileAsArrayBuffer(files[0]), readFileAsArrayBuffer(files[1])])
                const [pdf1, pdf2] = await Promise.all([pdfjsLib.getDocument({ data: buf1 }).promise, pdfjsLib.getDocument({ data: buf2 }).promise])
                sourcePdfDoc.value = markRaw(pdf1)
                targetPdfDoc.value = markRaw(pdf2)
                sourceFileName.value = files[0].name
                targetFileName.value = files[1].name
                await nextTick()
                await processAfterFileLoad(getSourceViewerRef(), getTargetViewerRef())
            } else {
                const buf = await readFileAsArrayBuffer(files[0])
                const pdf = await pdfjsLib.getDocument({ data: buf }).promise
                if (side === 'source') {
                    sourcePdfDoc.value = markRaw(pdf)
                    sourceFileName.value = files[0].name
                } else {
                    targetPdfDoc.value = markRaw(pdf)
                    targetFileName.value = files[0].name
                }
                await nextTick()
                await processAfterFileLoad(getSourceViewerRef(), getTargetViewerRef())
            }
        } catch (err) {
            loadError.value = (err as Error).message || 'Failed to load PDF'
        } finally {
            loading.value = false
            input.value = ''
        }
    }

    const clearItems = (sourceViewerRef: HTMLElement | null, targetViewerRef: HTMLElement | null) => {
        sourcePdfDoc.value = null
        targetPdfDoc.value = null
        sourceFileName.value = ''
        targetFileName.value = ''
        loadError.value = ''
        sourceTextItems.value = markRaw([])
        targetTextItems.value = markRaw([])
        diffBlocks.value = markRaw([])
        diffHighlights.value = markRaw({ source: [], target: [] })
        activeBlockIdx.value = -1
        ocrStatus.value = ''
        if (sourceViewerRef) sourceViewerRef.innerHTML = ''
        if (targetViewerRef) targetViewerRef.innerHTML = ''
    }

    const processPaste = async (e: ClipboardEvent, getSourceViewerRef: () => HTMLElement | null, getTargetViewerRef: () => HTMLElement | null) => {
        const extractFiles = (await import('@/utils/clipboard')).extractFilesFromClipboard
        const files = extractFiles(e, (file: File) => /\.pdf$/i.test(file.name))
        if (files.length === 0) return

        loading.value = true
        loadError.value = ''
        try {
            if (files.length >= 2) {
                const [buf1, buf2] = await Promise.all([readFileAsArrayBuffer(files[0]), readFileAsArrayBuffer(files[1])])
                const [pdf1, pdf2] = await Promise.all([pdfjsLib.getDocument({ data: buf1 }).promise, pdfjsLib.getDocument({ data: buf2 }).promise])
                sourcePdfDoc.value = markRaw(pdf1)
                targetPdfDoc.value = markRaw(pdf2)
                sourceFileName.value = files[0].name
                targetFileName.value = files[1].name
                await nextTick()
                await processAfterFileLoad(getSourceViewerRef(), getTargetViewerRef())
            } else {
                const buf = await readFileAsArrayBuffer(files[0])
                const pdf = await pdfjsLib.getDocument({ data: buf }).promise
                if (!sourcePdfDoc.value) {
                    sourcePdfDoc.value = markRaw(pdf)
                    sourceFileName.value = files[0].name
                } else {
                    targetPdfDoc.value = markRaw(pdf)
                    targetFileName.value = files[0].name
                }
                await nextTick()
                await processAfterFileLoad(getSourceViewerRef(), getTargetViewerRef())
            }
        } catch (err) {
            loadError.value = (err as Error).message || 'Failed to load PDF'
        } finally {
            loading.value = false
        }
    }

    const scrollToBlock = (idx: number, sourceViewerRef: HTMLElement | null, targetViewerRef: HTMLElement | null) => {
        activeBlockIdx.value = idx
        const block = diffBlocks.value[idx]
        if (!block) return

        sourceViewerRef?.querySelectorAll('.pdf-highlight-active').forEach(el => el.classList.remove('pdf-highlight-active'))
        targetViewerRef?.querySelectorAll('.pdf-highlight-active').forEach(el => el.classList.remove('pdf-highlight-active'))

        if (block.sourcePage) {
            const sourcePage = sourceViewerRef?.querySelector(`#page-${block.sourcePage}`)
            sourcePage?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            if (block.sourceIndex !== undefined) {
                const highlightEl = sourceViewerRef?.querySelector(`[data-index="${block.sourceIndex}"]`)
                highlightEl?.classList.add('pdf-highlight-active')
            }
        }
        if (block.targetPage) {
            const targetPage = targetViewerRef?.querySelector(`#page-${block.targetPage}`)
            targetPage?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            if (block.targetIndex !== undefined) {
                const highlightEl = targetViewerRef?.querySelector(`[data-index="${block.targetIndex}"]`)
                highlightEl?.classList.add('pdf-highlight-active')
            }
        }
    }

    const goToNextDiff = () => {
        const indices = diffBlocks.value.map((b, i) => b.type !== 'equal' ? i : -1).filter(i => i >= 0)
        const next = getNextIndex(indices, activeBlockIdx.value)
        if (next === -1) return
        return next
    }

    const goToPrevDiff = () => {
        const indices = diffBlocks.value.map((b, i) => b.type !== 'equal' ? i : -1).filter(i => i >= 0)
        const prev = getPrevIndex(indices, activeBlockIdx.value)
        if (prev === -1) return
        return prev
    }

    onUnmounted(() => {
        if (diffWorker) {
            diffWorker.terminate()
            diffWorker = null
        }
    })

    const handleFile = processFile

    return {
        sourceFileName,
        targetFileName,
        loading,
        loadError,
        ocrStatus,
        ocrEngine,
        zoom,
        sourcePdfDoc,
        targetPdfDoc,
        bothLoaded,
        diffBlocks,
        diffHighlights,
        isDiffing,
        activeBlockIdx,
        diffCount,
        handleFile,
        processFile,
        clearItems,
        processPaste,
        scrollToBlock,
        goToNextDiff,
        goToPrevDiff,
        setZoom,
        zoomIn,
        zoomOut,
        zoomReset
    }
}