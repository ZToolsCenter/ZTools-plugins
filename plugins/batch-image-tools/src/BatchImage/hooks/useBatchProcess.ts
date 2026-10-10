import { useCallback, useState } from 'react'
import type { ProcessResult, ToolOptions } from '../types'
import { getToolDefinition } from '../config/tools'
import { formatBytes } from '../utils'

export function useBatchProcess() {
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState<ProcessResult[]>([])

  const reset = useCallback(() => {
    setProcessing(false)
    setProgress(0)
    setResults([])
  }, [])

  const runProcess = useCallback(async (imagePaths: string[], options: ToolOptions) => {
    const tool = getToolDefinition(options.tool)

    if (imagePaths.length < tool.minImages) {
      return { ok: false, message: `当前功能至少需要 ${tool.minImages} 张图片` }
    }

    if (options.tool !== 'rename' && options.outputMode === 'output-dir' && !options.outputDir) {
      return { ok: false, message: '请选择输出目录' }
    }

    if (options.tool === 'watermark' && options.watermarkType === 'image' && !options.watermarkImagePath) {
      return { ok: false, message: '请选择水印图片' }
    }

    if (options.tool === 'rename' && options.renameMode === 'replace' && !options.findText) {
      return { ok: false, message: '请填写查找内容' }
    }

    setProcessing(true)
    setProgress(0)
    setResults([])

    try {
      if (tool.batchMode === 'merge') {
        const result = await window.services.processMerge(imagePaths, options)
        setResults([result])
        setProgress(100)
        if (result.success) {
          window.ztools.showNotification('合并完成')
        }
        return { ok: result.success, message: result.error }
      }

      const batchResults: ProcessResult[] = []
      for (let i = 0; i < imagePaths.length; i++) {
        const result =
          options.tool === 'rename'
            ? await window.services.renameOne(imagePaths[i], options, i)
            : await window.services.processOne(imagePaths[i], options)
        batchResults.push(result)
        setProgress(Math.round(((i + 1) / imagePaths.length) * 100))
      }

      setResults(batchResults)
      const successCount = batchResults.filter((item) => item.success).length
      const totalSaved = batchResults.reduce((sum, item) => {
        if (!item.success || !item.inputSize || !item.outputSize) return sum
        return sum + (item.inputSize - item.outputSize)
      }, 0)

      const notify =
        options.tool === 'rename'
          ? `重命名完成：${successCount}/${batchResults.length} 张成功`
          : `处理完成：${successCount}/${batchResults.length} 张成功` +
            (totalSaved > 0 ? `，节省 ${formatBytes(totalSaved)}` : '')

      window.ztools.showNotification(notify)
      return { ok: successCount > 0, results: batchResults }
    } finally {
      setProcessing(false)
    }
  }, [])

  return {
    processing,
    progress,
    results,
    setResults,
    reset,
    runProcess
  }
}
