import { useCallback, useEffect, useMemo, useState } from 'react'
import { createDefaultOptionsMap, getToolDefinition } from './config/tools'
import ActionBar from './components/layout/ActionBar'
import ErrorBanner from './components/layout/ErrorBanner'
import FileTable from './components/layout/FileTable'
import ResultBanner from './components/layout/ResultBanner'
import Sidebar from './components/layout/Sidebar'
import ToolPanel from './components/panels/ToolPanel'
import { useBatchProcess } from './hooks/useBatchProcess'
import { useImageQueue } from './hooks/useImageQueue'
import type { EnterAction, ToolId, ToolOptions } from './types'
import { formatBytes } from './utils'
import { pickDirectory, pickImageFiles, pickImageFolder, pickWatermarkImage } from './utils/filePicker'
import './index.css'

export type { EnterAction } from './types'

export default function BatchImage({ enterAction }: { enterAction: EnterAction }) {
  const [activeTool, setActiveTool] = useState<ToolId>('compress')
  const [optionsMap, setOptionsMap] = useState<Record<ToolId, ToolOptions>>(createDefaultOptionsMap)

  const {
    images,
    recursive,
    setRecursive,
    error,
    setError,
    loading,
    loadImages,
    removeImage,
    clearImages,
    applyPathUpdates,
    reset: resetQueue,
    handleEnterAction
  } = useImageQueue(enterAction)

  const { processing, progress, results, setResults, reset: resetProcess, runProcess } = useBatchProcess()
  const activeOptions = optionsMap[activeTool]
  const toolDef = getToolDefinition(activeTool)

  useEffect(() => {
    handleEnterAction()
  }, [handleEnterAction])

  const updateOptions = useCallback((next: ToolOptions) => {
    setOptionsMap((prev) => ({ ...prev, [next.tool]: next }))
  }, [])

  const handleReset = useCallback(() => {
    resetQueue()
    resetProcess()
    setOptionsMap(createDefaultOptionsMap())
    setActiveTool('compress')
  }, [resetProcess, resetQueue])

  const pickOutputDir = useCallback(async () => {
    const dir = await pickDirectory('选择输出目录')
    if (!dir) return
    updateOptions({ ...activeOptions, outputDir: dir })
  }, [activeOptions, updateOptions])

  const handlePickWatermarkImage = useCallback(async () => {
    const filePath = await pickWatermarkImage()
    if (!filePath) return
    if (activeOptions.tool === 'watermark') {
      updateOptions({ ...activeOptions, watermarkImagePath: filePath })
    }
  }, [activeOptions, updateOptions])

  const handlePickFiles = async () => {
    const files = await pickImageFiles()
    if (!files) return
    loadImages(files)
  }

  const handlePickFolder = async () => {
    const paths = await pickImageFolder()
    if (!paths) return
    loadImages(paths)
  }

  const handleProcess = async () => {
    setError('')
    const result = await runProcess(
      images.map((item) => item.path),
      activeOptions
    )
    if (result && 'message' in result && result.message) {
      setError(result.message)
    }
    if (activeOptions.tool === 'rename' && result && 'results' in result && Array.isArray(result.results)) {
      applyPathUpdates(result.results)
    }
  }

  const handleOpenLastOutput = () => {
    const last = results.find((item) => item.success && item.outputPath)
    if (last?.outputPath) {
      window.ztools.shellShowItemInFolder(last.outputPath)
    }
  }

  const totalInputSize = useMemo(
    () => images.reduce((sum, item) => sum + item.size, 0),
    [images]
  )

  return (
    <div className="batch-app">
      <header className="batch-app__header">
        <div className="batch-app__brand">
          <div className="batch-app__logo">图</div>
          <div>
            <h1>批量图片处理</h1>
            <p>{toolDef.description}</p>
          </div>
        </div>
        <div className="batch-app__header-actions">
          {images.length > 0 && (
            <div className="batch-app__stat">
              <span className="batch-app__stat-count">{images.length}</span>
              <span className="batch-app__stat-label">张 · {formatBytes(totalInputSize)}</span>
            </div>
          )}
          <button
            type="button"
            className="btn btn--ghost batch-app__reset"
            onClick={handleReset}
            disabled={processing || loading}
            title="清空队列、结果与参数，恢复初始状态"
          >
            重置
          </button>
        </div>
      </header>

      <div className="batch-app__body">
        <Sidebar activeTool={activeTool} disabled={processing} onChange={setActiveTool} />

        <main className="batch-app__main">
          <section className="settings-card">
            <div className="card-head">
              <div className="card-head__title">{toolDef.label}</div>
              <span className="card-head__badge">参数设置</span>
            </div>
            <ToolPanel
              activeTool={activeTool}
              options={activeOptions}
              previewImage={images[0] || null}
              disabled={processing}
              onChange={updateOptions}
              onPickOutputDir={pickOutputDir}
              onPickWatermarkImage={handlePickWatermarkImage}
            />
          </section>

          <section className="list-card">
            <div className="card-head">
              <div className="card-head__title">文件队列</div>
              {images.length > 0 && <span className="card-head__badge">{images.length} 项</span>}
            </div>
            {loading ? <div className="list-card__loading"><span className="spinner" /> 加载中...</div> : null}
            <FileTable
              images={images}
              disabled={processing}
              onRemove={removeImage}
              onClear={clearImages}
            />
          </section>

          <ResultBanner
            results={results}
            mode={activeTool === 'rename' ? 'rename' : 'process'}
            onOpenInFolder={handleOpenLastOutput}
            onDismiss={() => setResults([])}
          />

          <ErrorBanner message={error} onDismiss={() => setError('')} />
        </main>
      </div>

      <ActionBar
        imageCount={images.length}
        recursive={recursive}
        processing={processing}
        progress={progress}
        disabled={loading}
        onPickFiles={handlePickFiles}
        onPickFolder={handlePickFolder}
        onRecursiveChange={setRecursive}
        onProcess={handleProcess}
      />
    </div>
  )
}
