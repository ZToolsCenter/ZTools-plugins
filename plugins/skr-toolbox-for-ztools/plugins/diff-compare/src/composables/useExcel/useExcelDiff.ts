/**
 * Excel差异比较Composable
 * 提供Excel文件的差异比较功能，支持多工作表对比
 */

import { ref, shallowRef, computed, onMounted, onUnmounted } from 'vue'
import * as XLSX from 'xlsx'
import { readFileAsArrayBuffer } from '@/utils/file'

/**
 * 单元格差异数据
 */
interface CellDiff {
    /** 行索引（从0开始） */
    row: number
    /** 列索引（从0开始） */
    col: number
    /** 单元格地址（如'A1'） */
    address: string
    /** 源值 */
    source: unknown
    /** 目标值 */
    target: unknown
}

/**
 * 工作表差异数据
 */
interface SheetDiff {
    /** 工作表名称 */
    name: string
    /** 单元格差异列表 */
    diffs: CellDiff[]
    /** 源数据（二维数组） */
    sourceData: string[][]
    /** 目标数据（二维数组） */
    targetData: string[][]
    /** 行数 */
    rowCount: number
    /** 列数 */
    colCount: number
}

/**
 * Excel差异比较Composable
 */
export function useExcelDiff() {
    /** 源工作簿 */
    const sourceWorkbook = shallowRef<XLSX.WorkBook | null>(null)
    /** 目标工作簿 */
    const targetWorkbook = shallowRef<XLSX.WorkBook | null>(null)
    /** 当前选中的工作表名称 */
    const selectedSheetName = ref('')
    /** 差异比较结果 */
    const diffResult = ref<SheetDiff[]>([])
    /** 是否正在加载 */
    const loading = ref(false)
    /** 当前激活的单元格 */
    const activeCell = ref<{ row: number; col: number } | null>(null)
    /** 是否显示差异面板 */
    const showDiffPanel = ref(false)

    /** Web Worker实例 */
    let diffWorker: Worker | null = null
    /** 当前请求ID */
    let currentRequestId = 0

    /** 两份工作簿是否都已加载 */
    const bothLoaded = computed(() => !!sourceWorkbook.value && !!targetWorkbook.value)

    /** 工作表选项列表 */
    const sheetOptions = computed(() => {
        return diffResult.value.map(s => ({ label: s.name, value: s.name }))
    })

    /** 当前选中的工作表差异数据 */
    const currentSheetDiff = computed(() => {
        return diffResult.value.find(s => s.name === selectedSheetName.value) || null
    })

    /**
     * 读取Excel工作簿文件
     * @param file - Excel文件
     * @returns Promise<WorkBook> 工作簿对象
     */
    const readWorkbook = async (file: File): Promise<XLSX.WorkBook> => {
        const buffer = await readFileAsArrayBuffer(file)
        const data = new Uint8Array(buffer)
        return XLSX.read(data, { type: 'array' })
    }

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
        try {
            if (files.length >= 2) {
                sourceWorkbook.value = await readWorkbook(files[0])
                targetWorkbook.value = await readWorkbook(files[1])
            } else {
                const wb = await readWorkbook(files[0])
                if (side === 'source') sourceWorkbook.value = wb
                else targetWorkbook.value = wb
            }
            await compareWorkbooks()
        } finally {
            loading.value = false
            input.value = ''
        }
    }

    /**
     * 比较两个工作簿的差异
     * 遍历所有工作表，使用Web Worker进行差异计算
     */
    const compareWorkbooks = async () => {
        if (!sourceWorkbook.value || !targetWorkbook.value) return

        loading.value = true
        const results: SheetDiff[] = []
        const sourceSheets = sourceWorkbook.value.SheetNames
        const targetSheets = targetWorkbook.value.SheetNames

        const allSheetNames = Array.from(new Set([...sourceSheets, ...targetSheets]))

        if (!diffWorker) {
            diffWorker = new Worker(new URL('@/core/diff/diff.worker.ts', import.meta.url), { type: 'module' })
        }

        for (const name of allSheetNames) {
            const sourceSheet = sourceWorkbook.value!.Sheets[name]
            const targetSheet = targetWorkbook.value!.Sheets[name]

            if (!sourceSheet && !targetSheet) continue

            const sourceJSON = sourceSheet ? XLSX.utils.sheet_to_json(sourceSheet, { header: 1, raw: false, defval: '' }) as string[][] : []
            const targetJSON = targetSheet ? XLSX.utils.sheet_to_json(targetSheet, { header: 1, raw: false, defval: '' }) as string[][] : []

            const requestId = ++currentRequestId

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
                diffWorker!.postMessage({
                    type: 'excel',
                    source: sourceJSON,
                    target: targetJSON,
                    requestId
                })
            }) as { diffs: CellDiff[], maxRows: number, maxCols: number }

            results.push({
                name,
                diffs: workerResult.diffs.map(d => ({
                    ...d,
                    address: XLSX.utils.encode_cell({ r: d.row, c: d.col })
                })),
                sourceData: sourceJSON,
                targetData: targetJSON,
                rowCount: workerResult.maxRows,
                colCount: workerResult.maxCols
            })
        }

        diffResult.value = results
        if (results.length > 0 && !selectedSheetName.value) {
            selectedSheetName.value = results[0].name
        }
        loading.value = false
    }

    onUnmounted(() => {
        if (diffWorker) {
            diffWorker.terminate()
            diffWorker = null
        }
    })

    /**
     * 清除所有数据
     */
    const clearItems = () => {
        sourceWorkbook.value = null
        targetWorkbook.value = null
        diffResult.value = []
        selectedSheetName.value = ''
    }

    /**
     * 处理粘贴事件
     * 从剪贴板中提取Excel文件
     * @param e - 剪贴板事件
     */
    const handlePaste = async (e: ClipboardEvent) => {
        const files = (await import('@/utils/clipboard')).extractFilesFromClipboard(e, (file) =>
            file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.csv')
        )

        if (files.length === 0) return
        loading.value = true
        try {
            if (files.length >= 2) {
                sourceWorkbook.value = await readWorkbook(files[0])
                targetWorkbook.value = await readWorkbook(files[1])
            } else {
                const wb = await readWorkbook(files[0])
                if (sourceWorkbook.value) targetWorkbook.value = wb
                else sourceWorkbook.value = wb
            }
            await compareWorkbooks()
        } finally {
            loading.value = false
        }
    }

    /**
     * 获取单元格的CSS类名
     * @param row - 行索引
     * @param col - 列索引
     * @param side - 视图侧：source-源，target-目标，unified-统一
     * @returns CSS类名字符串
     */
    const getCellClass = (row: number, col: number, side: 'source' | 'target' | 'unified' = 'unified') => {
        if (!currentSheetDiff.value) return ''

        let baseClass = ''
        const diff = currentSheetDiff.value.diffs.find(d => d.row === row && d.col === col)
        if (diff) {
            const sValue = currentSheetDiff.value.sourceData[row]?.[col]
            const tValue = currentSheetDiff.value.targetData[row]?.[col]

            if (sValue === undefined || sValue === null || sValue === '') {
                if (side !== 'source') baseClass = 'cell-added'
            }
            else if (tValue === undefined || tValue === null || tValue === '') {
                if (side !== 'target') baseClass = 'cell-removed'
            }
            else {
                baseClass = 'cell-modified'
            }
        }

        if (activeCell.value?.row === row && activeCell.value?.col === col) {
            baseClass += ' cell--active'
        }

        return baseClass
    }

    /**
     * 获取列名（从0开始转换为Excel列标）
     * @param col - 列索引
     * @returns 列名（如0返回'A'，1返回'B'）
     */
    const getColumnName = (col: number) => XLSX.utils.encode_col(col)

    /**
     * 获取工作表的差异数量
     * @param name - 工作表名称
     * @returns 差异单元格数量
     */
    const getSheetDiffCount = (name: string) => {
        const sheet = diffResult.value.find(s => s.name === name)
        return sheet?.diffs.length || 0
    }

    /**
     * 获取指定行的差异信息
     * @param row - 行索引
     * @returns 差异信息对象或null
     */
    const getRowDiff = (row: number) => {
        if (!currentSheetDiff.value) return null
        const rowDiffs = currentSheetDiff.value.diffs.filter(d => d.row === row)
        if (rowDiffs.length === 0) return null

        const modified = rowDiffs.find(d => getCellClass(d.row, d.col).includes('cell-modified'))
        if (modified) return { type: 'modified', ...modified }

        const added = rowDiffs.find(d => getCellClass(d.row, d.col).includes('cell-added'))
        if (added) return { type: 'added', ...added }

        const removed = rowDiffs.find(d => getCellClass(d.row, d.col).includes('cell-removed'))
        if (removed) return { type: 'removed', ...removed }

        return { type: 'modified', ...rowDiffs[0] }
    }

    onMounted(() => {
        window.addEventListener('paste', handlePaste)
    })

    onUnmounted(() => {
        window.removeEventListener('paste', handlePaste)
    })

    return {
        sourceWorkbook,
        targetWorkbook,
        selectedSheetName,
        diffResult,
        loading,
        activeCell,
        showDiffPanel,
        bothLoaded,
        sheetOptions,
        currentSheetDiff,
        handleFile,
        clearItems,
        getCellClass,
        getColumnName,
        getSheetDiffCount,
        getRowDiff,
    }
}