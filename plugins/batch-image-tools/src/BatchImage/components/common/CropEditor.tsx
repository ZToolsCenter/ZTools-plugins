import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

export interface CropRect {
  left: number
  top: number
  width: number
  height: number
}

type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

interface CropEditorProps {
  imagePath?: string
  imageWidth?: number
  imageHeight?: number
  value: CropRect
  aspectRatio?: number | null
  disabled?: boolean
  onChange: (value: CropRect) => void
}

const MIN_SIZE = 0.05

function clampRect(rect: CropRect, aspectRatio?: number | null): CropRect {
  let { left, top, width, height } = rect

  width = Math.max(MIN_SIZE, Math.min(1, width))
  height = Math.max(MIN_SIZE, Math.min(1, height))

  if (aspectRatio && aspectRatio > 0) {
    if (width / height > aspectRatio) {
      width = height * aspectRatio
    } else {
      height = width / aspectRatio
    }
    width = Math.min(width, 1)
    height = Math.min(height, 1)
  }

  left = Math.max(0, Math.min(left, 1 - width))
  top = Math.max(0, Math.min(top, 1 - height))

  return {
    left: Number(left.toFixed(4)),
    top: Number(top.toFixed(4)),
    width: Number(width.toFixed(4)),
    height: Number(height.toFixed(4))
  }
}

export default function CropEditor({
  imagePath,
  imageWidth,
  imageHeight,
  value,
  aspectRatio,
  disabled,
  onChange
}: CropEditorProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    handle: Handle
    startX: number
    startY: number
    origin: CropRect
  } | null>(null)

  const [preview, setPreview] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!imagePath || !window.services?.getThumbnail) {
      setPreview('')
      return
    }

    setLoading(true)
    window.services
      .getThumbnail(imagePath, 720)
      .then((data) => {
        if (!cancelled) setPreview(data)
      })
      .catch(() => {
        if (!cancelled) setPreview('')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [imagePath])

  const updateFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const drag = dragRef.current
      const stage = stageRef.current
      if (!drag || !stage) return

      const rect = stage.getBoundingClientRect()
      const dx = (clientX - drag.startX) / rect.width
      const dy = (clientY - drag.startY) / rect.height
      const o = drag.origin

      let next: CropRect = { ...o }

      if (drag.handle === 'move') {
        next = {
          left: o.left + dx,
          top: o.top + dy,
          width: o.width,
          height: o.height
        }
      } else {
        let left = o.left
        let top = o.top
        let right = o.left + o.width
        let bottom = o.top + o.height

        if (drag.handle.includes('w')) left = o.left + dx
        if (drag.handle.includes('e')) right = o.left + o.width + dx
        if (drag.handle.includes('n')) top = o.top + dy
        if (drag.handle.includes('s')) bottom = o.top + o.height + dy

        if (right - left < MIN_SIZE) {
          if (drag.handle.includes('w')) left = right - MIN_SIZE
          else right = left + MIN_SIZE
        }
        if (bottom - top < MIN_SIZE) {
          if (drag.handle.includes('n')) top = bottom - MIN_SIZE
          else bottom = top + MIN_SIZE
        }

        next = {
          left,
          top,
          width: right - left,
          height: bottom - top
        }
      }

      onChange(clampRect(next, aspectRatio))
    },
    [aspectRatio, onChange]
  )

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!dragRef.current) return
      updateFromPointer(event.clientX, event.clientY)
    }
    const onUp = () => {
      dragRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [updateFromPointer])

  const startDrag = (handle: Handle, event: ReactPointerEvent) => {
    if (disabled) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = {
      handle,
      startX: event.clientX,
      startY: event.clientY,
      origin: { ...value }
    }
  }

  if (!imagePath) {
    return (
      <div className="crop-editor crop-editor--empty">
        请先添加图片，然后拖拽裁剪框调整范围
      </div>
    )
  }

  const pixelW = imageWidth ? Math.round(value.width * imageWidth) : 0
  const pixelH = imageHeight ? Math.round(value.height * imageHeight) : 0

  const stageStyle =
    imageWidth && imageHeight
      ? { aspectRatio: `${imageWidth} / ${imageHeight}` }
      : undefined

  return (
    <div className="crop-editor">
      <div className="crop-editor__stage" ref={stageRef} style={stageStyle}>
        {loading && <div className="crop-editor__loading">预览加载中...</div>}
        {preview && <img src={preview} alt="" draggable={false} />}
        <div
          className="crop-editor__box"
          style={{
            left: `${value.left * 100}%`,
            top: `${value.top * 100}%`,
            width: `${value.width * 100}%`,
            height: `${value.height * 100}%`
          }}
          onPointerDown={(e) => startDrag('move', e)}
        >
          <span className="crop-editor__grid" />
          {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as Handle[]).map((handle) => (
            <i
              key={handle}
              className={`crop-editor__handle crop-editor__handle--${handle}`}
              onPointerDown={(e) => startDrag(handle, e)}
            />
          ))}
        </div>
      </div>
      <div className="crop-editor__meta">
        裁剪区域 {Math.round(value.width * 100)}% × {Math.round(value.height * 100)}%
        {imageWidth && imageHeight ? ` · 约 ${pixelW}×${pixelH}px` : ''}
        <span>批量时按相对比例应用到每张图</span>
      </div>
    </div>
  )
}
