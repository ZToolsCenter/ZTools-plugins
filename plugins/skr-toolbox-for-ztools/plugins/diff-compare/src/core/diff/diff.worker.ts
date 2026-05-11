/**
 * @fileoverview 差异比较 Worker 入口
 * @module core/diff/diff.worker
 * @description 在 Web Worker 中运行差异比较任务，避免阻塞主线程
 */

import { TextDiffStrategy } from './text/text'
import { ExcelDiffStrategy } from './excel/excel'
import { WordDiffStrategy } from './word/word'
import { ImageDiffStrategy } from './image/image'
import { PdfDiffStrategy } from './pdf/pdf'
import { DiffType, IDiffStrategy } from './types'

/**
 * 差异比较策略映射表
 * @type {Record<DiffType, IDiffStrategy>}
 * @description 每种文件类型对应的差异比较策略实例
 */
const strategies: Record<DiffType, IDiffStrategy> = {
    text: new TextDiffStrategy(),
    excel: new ExcelDiffStrategy(),
    word: new WordDiffStrategy(),
    image: new ImageDiffStrategy(),
    pdf: new PdfDiffStrategy()
}

/**
 * 处理差异比较请求
 * @event MessageEvent
 * @description 监听来自主线程的消息，执行差异比较并返回结果
 * 
 * @param e.data.type - 差异比较类型
 * @param e.data.source - 源数据
 * @param e.data.target - 目标数据
 * @param e.data.requestId - 请求唯一标识
 */
self.onmessage = (e: MessageEvent) => {
    const { type, source, target, requestId } = e.data as {
        type: DiffType
        source: any
        target: any
        requestId: number
    }

    try {
        const strategy = strategies[type] || strategies.text
        const result = strategy.diff(source, target)
        self.postMessage({ requestId, result })
    } catch (error) {
        self.postMessage({ requestId, error: String(error) })
    }
}
