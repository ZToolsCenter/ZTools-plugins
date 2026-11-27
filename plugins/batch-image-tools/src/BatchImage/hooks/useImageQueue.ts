import { useCallback, useState } from 'react'
import type { EnterAction, ImageItem, ProcessResult } from '../types'
import { pathBasename, resolveEnterPaths } from '../utils'

export function useImageQueue(enterAction: EnterAction) {
  const [images, setImages] = useState<ImageItem[]>([])
  const [recursive, setRecursive] = useState(true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const loadImages = useCallback(
    async (paths: string[]) => {
      setError('')
      setLoading(true)
      try {
        if (!window.services?.collectImages) {
          throw new Error('图片服务未就绪，请重新导入插件或重启 ZTools')
        }

        const collected = window.services.collectImages(paths, recursive)
        if (collected.length === 0) {
          setImages([])
          setError('未找到可处理的图片文件')
          return
        }

        const items: ImageItem[] = []
        for (const filePath of collected) {
          const info = await window.services.getImageInfo(filePath)
          const thumb = await window.services.getThumbnail(filePath)
          items.push({ ...info, thumb })
        }
        setImages(items)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
      } finally {
        setLoading(false)
      }
    },
    [recursive]
  )

  const removeImage = useCallback((path: string) => {
    setImages((prev) => prev.filter((item) => item.path !== path))
  }, [])

  const clearImages = useCallback(() => {
    setImages([])
  }, [])

  const applyPathUpdates = useCallback((results: ProcessResult[]) => {
    const map = new Map<string, string>()
    for (const item of results) {
      if (item.success && item.inputPath && item.outputPath && item.inputPath !== item.outputPath) {
        map.set(item.inputPath, item.outputPath)
      }
    }
    if (map.size === 0) return

    setImages((prev) =>
      prev.map((image) => {
        const nextPath = map.get(image.path)
        if (!nextPath) return image
        return {
          ...image,
          path: nextPath,
          name: pathBasename(nextPath)
        }
      })
    )
  }, [])

  const reset = useCallback(() => {
    setImages([])
    setRecursive(true)
    setError('')
    setLoading(false)
  }, [])

  const handleEnterAction = useCallback(() => {
    const paths = resolveEnterPaths(enterAction)
    if (paths.length > 0) {
      loadImages(paths)
    }
  }, [enterAction, loadImages])

  return {
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
    reset,
    handleEnterAction
  }
}
