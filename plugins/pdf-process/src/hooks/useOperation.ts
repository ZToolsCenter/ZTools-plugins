import { useState, useCallback, useRef } from 'react'

export interface OperationState<T> {
  processing: boolean
  result: T | null
  error: string | null
}

export function useOperation<T>() {
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef(false)

  const reset = useCallback(() => {
    setProcessing(false)
    setResult(null)
    setError(null)
    abortRef.current = false
  }, [])

  const cancel = useCallback(() => {
    window.services.cancelCurrent()
    abortRef.current = true
    setProcessing(false)
    window.ztools.showNotification('已取消，可重新选择文件')
  }, [])

  const execute = useCallback(
    async (fn: () => Promise<T>, onSuccess?: (value: T) => void) => {
      setProcessing(true)
      setResult(null)
      setError(null)
      abortRef.current = false
      try {
        const value = await fn()
        if (!abortRef.current) {
          setResult(value)
          setProcessing(false)
          onSuccess?.(value)
        }
      } catch (err: any) {
        if (!abortRef.current) {
          setError(err.message || '操作失败')
          setProcessing(false)
        }
      }
    },
    []
  )

  return { processing, result, error, execute, cancel, reset }
}
