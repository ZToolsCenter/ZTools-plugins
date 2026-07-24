import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
// Vite 以 url 加载 worker（构建后为独立 asset）
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export function PdfView(props: {
  data: ArrayBuffer
  page: number
  scale: number
  onPageReady: (totalPages: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const buf = props.data
      const loadingTask = pdfjsLib.getDocument({ data: buf })
      const pdf = await loadingTask.promise
      if (cancelled) return
      if (!total) { setTotal(pdf.numPages); props.onPageReady(pdf.numPages) }
      const num = Math.max(1, Math.min(props.page, pdf.numPages))
      const page = await pdf.getPage(num)
      const viewport = page.getViewport({ scale: props.scale || 1.2 })
      const canvas = canvasRef.current
      if (!canvas) { if (cancelled) return; return }
      const ctx = canvas.getContext('2d')!
      const dpr = window.devicePixelRatio || 1
      canvas.width = viewport.width * dpr
      canvas.height = viewport.height * dpr
      canvas.style.width = viewport.width + 'px'
      canvas.style.height = viewport.height + 'px'
      await page.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined } as any).promise
    })().catch((e) => console.error('pdf render', e))
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.data, props.page, props.scale])

  return (
    <div className="flex h-full w-full items-start justify-center overflow-auto bg-white">
      <canvas ref={canvasRef} />
      {total > 0 && <span className="sr-no-drag fixed bottom-1 left-1 text-[10px] text-black/60">{props.page}/{total}</span>}
    </div>
  )
}