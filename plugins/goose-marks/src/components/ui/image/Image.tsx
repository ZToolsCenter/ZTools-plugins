import { useState, type CSSProperties } from 'react'
import type React from 'react'
import { ImageOff } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Image —— Vue 自定义图片组件 → React 等价重写。
 * --------------------------------------------------------------------------
 * 行为等价：加载中显示骨架屏，失败时依 fallback 显示破图图标或留空。
 * - i-ph-image-broken-thin（UnoCSS presetIcons）→ lucide-react <ImageOff />。
 * - Vue emits error/load → React onError/onLoad 回调。
 */
export interface ImageProps {
  src?: string
  alt?: string
  width?: string | number
  height?: string | number
  className?: string
  /** 失败兜底：'icon' 显示破图图标（默认），'none' 留空。 */
  fallback?: 'icon' | 'none'
  /**
   * bare=true：只渲染 <img>，不包外层 div。
   * 适用于外层容器已管理尺寸/圆角/背景的场景（如 .fav）。
   * 失败时渲染 null（等价 fallback='none'）。
   */
  bare?: boolean
  onError?: () => void
  onLoad?: () => void
  onContextMenu?: React.MouseEventHandler<HTMLImageElement>
}

const toLength = (v?: string | number): string | undefined =>
  typeof v === 'number' ? `${v}px` : v

export function Image({
  src,
  alt,
  width,
  height,
  className,
  fallback = 'icon',
  bare = false,
  onError,
  onLoad,
  onContextMenu,
}: ImageProps) {
  const [hasError, setHasError] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)

  const showSkeleton = !hasError && !hasLoaded && !!src

  const style: CSSProperties = {
    width: toLength(width),
    height: toLength(height),
  }

  const handleError = () => {
    setHasError(true)
    onError?.()
  }

  const handleLoad = () => {
    setHasLoaded(true)
    onLoad?.()
  }

  if (bare) {
    return (!hasError && src)
      ? (
        <img
          src={src}
          alt={alt}
          className={cn('w-full h-full object-cover', className)}
          style={style}
          // 图标多为已缓存的 base64：同步解码 + 立即加载，让图标随首帧一起绘制，
          // 消除切换分组时 <img> 重新挂载后「先空白再出现」的闪烁。
          decoding="sync"
          loading="eager"
          // 缓存命中时 complete 可能已是 true：直接补一帧可见，避免空白
          ref={(node) => {
            if (!node) return
            if (node.complete && node.naturalWidth > 0) {
              node.style.visibility = 'visible'
            }
          }}
          onError={handleError}
          onLoad={handleLoad}
          onContextMenu={onContextMenu}
        />
      )
      : null
  }

  return (
    <div
      className={cn('relative overflow-hidden rounded-md bg-secondary', className)}
      style={style}
    >
      {showSkeleton && <div className="absolute inset-0 bg-muted animate-pulse" />}
      {!hasError && src ? (
        <img
          src={src}
          alt={alt}
          className="h-full w-full object-cover transition-all hover:scale-105"
          onError={handleError}
          onLoad={handleLoad}
        />
      ) : fallback !== 'none' ? (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          <ImageOff className="size-5" />
        </div>
      ) : null}
    </div>
  )
}
