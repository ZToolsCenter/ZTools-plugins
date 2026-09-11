import WorkspaceFiles from '../components/WorkspaceFiles'
import OperationResult from '../components/OperationResult'
import FeatureLayout from '../components/FeatureLayout'
import ConvertWebRecommend from '../components/ConvertWebRecommend'
import { useOperation } from '../hooks/useOperation'
import { useSharedFiles, type SharedFile } from '../context/SharedFilesContext'
import { ensureBrowserFile, withInputPath } from '../utils/fileFromShared'
import {
  generateTaskId,
  buildTaskOutputPath,
  buildConvertedFilename,
} from '../hooks/useTaskFolder'
import type { ConvertWebFormat } from '../config/webConvertLinks'
import './PdfConvertPage.css'

export type ConvertFormat = 'word' | 'ppt' | 'excel'

const FORMAT_META: Record<
  ConvertFormat,
  { title: string; feature: string; ext: string; recommend: ConvertWebFormat }
> = {
  word: { title: 'PDF 转 Word', feature: 'word', ext: '.docx', recommend: 'word' },
  ppt: { title: 'PDF 转 PPT', feature: 'ppt', ext: '.pptx', recommend: 'ppt' },
  excel: { title: 'PDF 转 Excel', feature: 'excel', ext: '.xlsx', recommend: 'excel' },
}

interface PdfConvertPageProps {
  format: ConvertFormat
  onBack?: () => void
  onOpenSettings?: () => void
}

function dirnameOf(filePath: string) {
  const normalized = filePath.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index > 0 ? filePath.slice(0, index) : filePath
}

async function renderPdfPages(file: SharedFile, outputPath: string) {
  const source = await ensureBrowserFile(file)
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = './pdf.worker.min.mjs'
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(await source.arrayBuffer()),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise
  const taskDir = dirnameOf(outputPath)
  const separator = taskDir.includes('\\') ? '\\' : '/'
  const pages: Array<{ path: string; width: number; height: number }> = []

  try {
    const count = Math.min(pdf.numPages, 50)
    for (let pageNumber = 1; pageNumber <= count; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1.5 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('Canvas 2D 不可用')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: context, viewport }).promise
      const imagePath = taskDir + separator + `scan-page-${pageNumber}.png`
      const saved = window.services.writeImageFile(canvas.toDataURL('image/png'), imagePath)
      if (!saved) throw new Error(`写入第 ${pageNumber} 页图像失败`)
      pages.push({ path: saved, width: canvas.width, height: canvas.height })
      canvas.width = 0
      canvas.height = 0
    }
  } finally {
    await pdf.destroy().catch(() => {})
  }
  return pages
}

async function convertWithScanFallback(file: SharedFile, outputPath: string, format: ConvertFormat) {
  try {
    return await withInputPath(file, (inputPath) =>
      window.services.convertPdf(inputPath, outputPath, format),
    )
  } catch (error) {
    if ((error as { code?: string })?.code !== 'SCAN_RENDER_REQUIRED') throw error
    const pages = await renderPdfPages(file, outputPath)
    try {
      if (!window.services.convertPdfImages) throw new Error('页面图像转换服务不可用')
      return await window.services.convertPdfImages(pages, outputPath, format as 'word' | 'ppt')
    } finally {
      for (const page of pages) window.services.deleteFile?.(page.path)
    }
  }
}

/** One Convert feature module parameterized by format (Word / PPT / Excel). */
export default function PdfConvertPage({ format, onOpenSettings }: PdfConvertPageProps) {
  const meta = FORMAT_META[format]
  const { files, selectedFiles, clear } = useSharedFiles()
  const { processing, result, error, execute, cancel } = useOperation<string[]>()
  const targets = selectedFiles.length > 0 ? selectedFiles : files

  const handleConvert = () => {
    if (targets.length === 0) return
    execute(
      async () => {
        const outputs: string[] = []
        for (const file of targets) {
          const taskId = generateTaskId(file.name || file.path)
          const outputPath = buildTaskOutputPath(
            window.ztools.getPath('downloads'),
            meta.feature,
            buildConvertedFilename(file.name || file.path, meta.ext),
            taskId,
          )
          await convertWithScanFallback(file, outputPath, format)
          outputs.push(outputPath)
        }
        return outputs
      },
      () => {
        window.ztools.showNotification('转换完成（' + targets.length + ' 个）')
      },
    )
  }

  return (
    <FeatureLayout
      title={meta.title}
      subtitle="可多选多个 PDF，按任务批量转换"
      action={
        files.length > 0 ? (
          <div className="convert-options">
            {onOpenSettings && (
              <button type="button" className="settings-link-btn" onClick={onOpenSettings}>
                打开设置
              </button>
            )}
            {!processing && (
              <button className="action-btn" onClick={handleConvert} disabled={targets.length === 0}>
                开始转换（{targets.length}）
              </button>
            )}
            {processing && (
              <button className="action-btn" onClick={cancel} style={{ background: '#e74c3c' }}>
                停止
              </button>
            )}
            {error && <p className="error-text">转换失败：{error}</p>}
          </div>
        ) : null
      }
      result={<OperationResult result={result} onReset={clear} />}
    >
      <ConvertWebRecommend format={meta.recommend} onOpenSettings={onOpenSettings} />
      <WorkspaceFiles
        title={meta.title}
        subtitle="将 PDF 转换为目标格式（可多选）"
        multiple
        layout="list"
        selectable
        multiSelect
      />
    </FeatureLayout>
  )
}
