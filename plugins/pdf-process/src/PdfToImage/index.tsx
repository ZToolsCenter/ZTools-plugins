import { useState } from 'react'
import WorkspaceFiles from '../components/WorkspaceFiles'
import OperationResult from '../components/OperationResult'
import FeatureLayout from '../components/FeatureLayout'
import { useOperation } from '../hooks/useOperation'
import { useSharedFiles, type SharedFile } from '../context/SharedFilesContext'
import {
  generateTaskId,
  buildTaskOutputDir,
  buildPageImageFilename,
} from '../hooks/useTaskFolder'
import { ensureBrowserFile } from '../utils/fileFromShared'
import './index.css'

interface PdfToImageProps { onBack?: () => void }

async function renderPdfToImages(
  file: File,
  format: string,
  outputDir: string,
  sourceName: string,
): Promise<string[]> {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.min.mjs'
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise
  const outputFiles: string[] = []
  const ext = format === 'jpg' ? 'jpg' : 'png'
  const sep = outputDir.includes('\\') ? '\\' : '/'

  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const viewport = page.getViewport({ scale: 2 })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport }).promise
      const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png'
      const quality = format === 'jpg' ? 0.92 : undefined
      const dataUrl = canvas.toDataURL(mimeType, quality)
      const filename = buildPageImageFilename(sourceName, i, ext)
      const outputPath = outputDir.replace(/[\\/]+$/, '') + sep + filename
      const saved = window.services.writeImageFile(dataUrl, outputPath)
      if (saved) outputFiles.push(saved)
      canvas.width = 0
      canvas.height = 0
    }
  } finally {
    try {
      await pdf.destroy()
    } catch {
      // ignore
    }
  }
  return outputFiles
}

export default function PdfToImage(_props: PdfToImageProps) {
  const [format, setFormat] = useState('png')
  const { files, selectedFiles, clear } = useSharedFiles()
  const { processing, result, error, execute, cancel } = useOperation<string[]>()
  // Prefer selection; if empty selection, process all files
  const targets = selectedFiles.length > 0 ? selectedFiles : files

  const handleConvert = () => {
    if (targets.length === 0) {
      window.ztools.showNotification('请先添加 PDF 文件')
      return
    }
    execute(async () => {
      const allOut: string[] = []
      let ok = 0
      for (const file of targets) {
        const browserFile = await ensureBrowserFile(file)
        const taskId = generateTaskId(file.name || file.path)
        const outputDir = buildTaskOutputDir(window.ztools.getPath('downloads'), 'image', taskId)
        const out = await renderPdfToImages(
          browserFile,
          format,
          outputDir,
          file.name || file.path,
        )
        allOut.push(...out)
        ok += 1
      }
      window.ztools.showNotification(`转换完成（${ok} 个任务）`)
      return allOut
    })
  }

  const formatControl = (
    <div className="pdf-to-image-format">
      <label htmlFor="pdf-to-image-format">输出格式</label>
      <select
        id="pdf-to-image-format"
        value={format}
        onChange={(e) => setFormat(e.target.value)}
      >
        <option value="png">PNG</option>
        <option value="jpg">JPG</option>
      </select>
    </div>
  )

  return (
    <FeatureLayout
      title="PDF 转图片"
      subtitle="可多选多个 PDF，按任务批量转图"
      action={
        files.length > 0 ? (
          <div className="convert-options">
            {!processing ? (
              <button className="action-btn" onClick={handleConvert} disabled={targets.length === 0}>
                开始转换（{targets.length}）
              </button>
            ) : (
              <button className="action-btn" onClick={cancel} style={{ background: '#e74c3c' }}>停止</button>
            )}
            {error && <p className="error-text">转换失败：{error}</p>}
          </div>
        ) : null
      }
      result={<OperationResult result={result} onReset={clear} />}
    >
      {formatControl}
      <WorkspaceFiles
        title="PDF 转图片"
        subtitle="将 PDF 每页转为图片（可多选，可继续拖入）"
        multiple
        layout="list"
        selectable
        multiSelect
      />
    </FeatureLayout>
  )
}
