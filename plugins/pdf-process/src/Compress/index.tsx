import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import FileUpload from '../components/FileUpload'
import OperationResult from '../components/OperationResult'
import { useOperation } from '../hooks/useOperation'
import { useSharedFiles, type SharedFile } from '../context/SharedFilesContext'
import { formatFileSize } from '../utils/formatSize'
import {
  generateTaskId,
  buildTaskOutputPath,
  buildConvertedFilename,
} from '../hooks/useTaskFolder'
import {
  mapQualityToRaster,
  computeRasterPixelSize,
  applyLongEdgeCap,
  type PageSizePt,
} from '../utils/strongCompress'
import { pickPdfFiles } from '../utils/pickFiles'
import { ensureBrowserFile, withInputPath } from '../utils/fileFromShared'
import './index.css'

interface CompressProps {
  onBack?: () => void
}

/** Re-export for tests. */
export { mapQualityToRaster } from '../utils/strongCompress'

function resolvePath(file: SharedFile) {
  return file.rawFile ? window.ztools.getPathForFile(file.rawFile) : file.path
}

function dirnameOf(filePath: string) {
  const bs = String.fromCharCode(92)
  const normalized = filePath.replace(new RegExp(bs + bs, 'g'), '/')
  const idx = Math.max(normalized.lastIndexOf('/'), filePath.lastIndexOf(bs))
  if (idx <= 0) return filePath
  return filePath.slice(0, idx)
}

/**
 * Strong-compress in the RENDERER with DOM canvas + browser pdfjs.
 * Thumbs/PdfToImage already prove this path works in ZTools.
 */
async function strongCompressInRenderer(
  source: File,
  quality: number,
  taskDir: string,
  outputPath: string,
): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.min.mjs'

  const { dpi, jpegQuality, grayscale } = mapQualityToRaster(quality)
  const data = new Uint8Array(await source.arrayBuffer())
  const pdf = await pdfjsLib
    .getDocument({
      data,
      useSystemFonts: true,
      isEvalSupported: false,
      disableFontFace: false,
    })
    .promise

  const bs = String.fromCharCode(92)
  const sep = taskDir.includes(bs) ? bs : '/'
  const base = taskDir.replace(new RegExp('[' + bs + '/]+$'), '')

  const imagePaths: string[] = []
  const pageSizes: PageSizePt[] = []

  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const unscaled = page.getViewport({ scale: 1 })
      const widthPt = unscaled.width
      const heightPt = unscaled.height
      pageSizes.push({ widthPt, heightPt })

      let pix = computeRasterPixelSize({ widthPt, heightPt }, dpi)
      pix = applyLongEdgeCap(pix)

      const canvas = document.createElement('canvas')
      canvas.width = pix.widthPx
      canvas.height = pix.heightPx
      const ctx = canvas.getContext('2d', {
        alpha: false,
        willReadFrequently: grayscale,
      })
      if (!ctx) throw new Error('Canvas 2D 不可用')

      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, pix.widthPx, pix.heightPx)

      const renderScale = pix.widthPx / Math.max(widthPt, 1)
      const viewport = page.getViewport({ scale: renderScale })
      await page.render({
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise

      if (grayscale) {
        const img = ctx.getImageData(0, 0, pix.widthPx, pix.heightPx)
        const d = img.data
        for (let p = 0; p < d.length; p += 4) {
          const y = (d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114 + 0.5) | 0
          d[p] = y
          d[p + 1] = y
          d[p + 2] = y
        }
        ctx.putImageData(img, 0, 0)
      }

      const dataUrl = canvas.toDataURL('image/jpeg', jpegQuality)
      const imgPath = base + sep + 'page_' + i + '.jpg'
      const saved = window.services.writeImageFile(dataUrl, imgPath)
      if (!saved) throw new Error('写入页图失败：第 ' + i + ' 页')
      imagePaths.push(saved)

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

  if (!imagePaths.length) throw new Error('未能渲染任何页面')

  const out = await window.services.createPdfFromImages(imagePaths, outputPath, {
    pageSizes,
  })

  for (const img of imagePaths) {
    try {
      window.services.deleteFile?.(img)
    } catch {
      // ignore
    }
  }

  return out
}

export default function Compress(_props: CompressProps) {
  const [quality, setQuality] = useState(50)
  const [strongCompress, setStrongCompress] = useState(false)
  const {
    files,
    selectedFiles,
    selectedIds,
    addFiles,
    addPaths,
    removeFile,
    clear,
    selectFile,
    reorder,
  } = useSharedFiles()
  const { processing, result, error, execute, cancel } = useOperation<string[]>()
  const [dropping, setDropping] = useState(false)
  const dropDepth = useRef(0)

  const targets = selectedFiles.length > 0 ? selectedFiles : files

  const acceptPdfDrop = (list: FileList | File[]) => {
    const pdfs = Array.from(list).filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
    )
    if (pdfs.length) addFiles(pdfs)
  }

  const buildOutputPath = (name: string) => {
    const taskId = generateTaskId(name)
    const outName = buildConvertedFilename(name, '.pdf')
    return buildTaskOutputPath(window.ztools.getPath('downloads'), 'compress', outName, taskId)
  }

  const handleAddFiles = async () => {
    const selected = await pickPdfFiles({ multiple: true, title: '选择 PDF 文件' })
    if (selected.length) addPaths(selected)
  }

  const handleCompress = () => {
    if (targets.length === 0) return
    execute(async () => {
      const outputs: string[] = []
      for (const file of targets) {
        const outputPath = buildOutputPath(file.name || file.path)
        if (strongCompress) {
          // Renderer DOM canvas — do NOT call preload napi canvas path
          const browserFile = await ensureBrowserFile(file)
          const taskDir = dirnameOf(outputPath)
          const out = await strongCompressInRenderer(
            browserFile,
            quality,
            taskDir,
            outputPath,
          )
          outputs.push(out)
        } else {
          await withInputPath(file, (inputPath) =>
            window.services.compressPdf(inputPath, outputPath, { mode: 'optimize' }),
          )
          outputs.push(outputPath)
        }
      }
      window.ztools.showNotification('压缩完成（' + outputs.length + ' 个）')
      return outputs
    })
  }

  const openFolderFor = (file: SharedFile) => {
    try {
      window.ztools.shellShowItemInFolder(resolvePath(file))
    } catch {
      // ignore
    }
  }

  const params = mapQualityToRaster(quality)

  return (
    <div
      className={'compress-page' + (dropping ? ' is-dropping' : '')}
      onDragEnter={(e: DragEvent) => {
        e.preventDefault()
        dropDepth.current += 1
        setDropping(true)
      }}
      onDragLeave={(e: DragEvent) => {
        e.preventDefault()
        dropDepth.current = Math.max(0, dropDepth.current - 1)
        if (dropDepth.current === 0) setDropping(false)
      }}
      onDragOver={(e: DragEvent) => e.preventDefault()}
      onDrop={(e: DragEvent) => {
        e.preventDefault()
        dropDepth.current = 0
        setDropping(false)
        if (e.dataTransfer?.files?.length) acceptPdfDrop(e.dataTransfer.files)
      }}
    >
      <h1 className="feature-title compress-title">PDF 压缩</h1>

      <div className="compress-toolbar">
        <div className="compress-toolbar-left">
          <div className="compress-mode-group" role="tablist" aria-label="压缩模式">
            <button
              type="button"
              role="tab"
              className={'compress-mode-btn' + (!strongCompress ? ' active' : '')}
              aria-selected={!strongCompress}
              onClick={() => setStrongCompress(false)}
            >
              基本压缩
            </button>
            <button
              type="button"
              role="tab"
              className={'compress-mode-btn' + (strongCompress ? ' active' : '')}
              aria-selected={strongCompress}
              onClick={() => setStrongCompress(true)}
            >
              强压缩
              {strongCompress ? <span className="compress-mode-check">✓</span> : null}
            </button>
          </div>
          {strongCompress ? (
            <div className="compress-quality">
              <div className="compress-quality-meta" aria-live="polite">
                <span className="compress-quality-pct">
                  质量 <b>{quality}</b>%
                </span>
                <span className="compress-quality-detail">
                  {params.dpi}dpi{params.grayscale ? ' · 灰度' : ''}
                </span>
              </div>
              <input
                className="compress-quality-range"
                type="range"
                min="1"
                max="100"
                step="1"
                value={quality}
                aria-label="强压缩质量"
                onChange={(e) => setQuality(Number(e.target.value))}
              />
            </div>
          ) : null}
        </div>

        <div className="compress-toolbar-right">
          <button type="button" className="compress-tool-btn" onClick={handleAddFiles}>
            <span className="compress-tool-icon">+</span>
            添加文件
          </button>
          {files.length > 0 ? (
            <button type="button" className="compress-tool-btn" onClick={clear}>
              <span className="compress-tool-icon">×</span>
              清空列表
            </button>
          ) : null}
        </div>
      </div>

      <p className="compress-mode-hint">
        {strongCompress
          ? '强压缩：浏览器渲染整页为 JPEG（72–150 DPI），再按原页尺寸合成。文字不可选/搜索。低质量自动灰度。'
          : '基本压缩：优化 PDF 内部结构与图片，保留可选文字与链接。'}
      </p>

      <div className="compress-body">
        {files.length === 0 ? (
          <FileUpload
            title="PDF 压缩"
            subtitle="拖入或选择 PDF，可多选批量压缩"
            accept=".pdf"
            multiple
            onFilesSelected={addFiles}
          />
        ) : (
          <div className="compress-file-list">
            {files.map((f, index) => {
              const selected = selectedIds.includes(f.id)
              return (
                <div
                  key={f.id}
                  className={'compress-file-row' + (selected ? ' selected' : '')}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', String(index))
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    const from = Number(e.dataTransfer.getData('text/plain'))
                    if (!Number.isNaN(from)) reorder(from, index)
                  }}
                  onClick={() => selectFile(f.id, { toggle: true })}
                >
                  <label
                    className="compress-file-check"
                    onClick={(e) => e.stopPropagation()}
                    title="选择"
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => selectFile(f.id, { toggle: true })}
                    />
                  </label>

                  <div className="compress-file-icon" aria-hidden>
                    {f.thumbUrl ? (
                      <img src={f.thumbUrl} alt="" draggable={false} />
                    ) : (
                      <span className="compress-file-icon-fallback">PDF</span>
                    )}
                  </div>

                  <div className="compress-file-meta">
                    <div className="compress-file-name" title={f.name}>
                      {f.name}
                    </div>
                    <div className="compress-file-sub">
                      {formatFileSize(f.size)}
                      {f.pageCount != null ? ' · ' + f.pageCount + ' 页' : ''}
                    </div>
                  </div>

                  <div className="compress-file-status">
                    {processing && selected ? '压缩中…' : '待压缩'}
                  </div>

                  <button
                    type="button"
                    className="compress-row-btn"
                    title="打开文件位置"
                    onClick={(e) => {
                      e.stopPropagation()
                      openFolderFor(f)
                    }}
                  >
                    ◎
                  </button>
                  <button
                    type="button"
                    className="compress-row-btn danger"
                    title="移除"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeFile(f.id)
                    }}
                  >
                    ×
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {error && !processing ? <p className="error-text compress-error">压缩失败：{error}</p> : null}
        <OperationResult result={result} onReset={() => {}} />
      </div>

      {files.length > 0 ? (
        <div className="compress-footer">
          {!processing ? (
            <button
              type="button"
              className="compress-start-btn"
              onClick={handleCompress}
              disabled={targets.length === 0}
            >
              开始压缩({targets.length})
            </button>
          ) : (
            <button type="button" className="compress-start-btn stop" onClick={cancel}>
              停止
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}
