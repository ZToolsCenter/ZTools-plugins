/**
 * useFileEnterAction — 处理 ZTools files 类型拖拽触发
 * 当用户从搜索框拖拽 .sql 文件触发功能时，自动填入 FileInput 状态
 */
import { useEffect } from 'react'

const LARGE = 10 * 1024 * 1024

interface FileInputState {
  setSql: (v: string) => void
  setFilePath: (p: string | null) => void
  setIsLarge: (l: boolean) => void
}

export function useFileEnterAction(enterAction: any, state: FileInputState) {
  const { setSql, setFilePath, setIsLarge } = state

  useEffect(() => {
    if (enterAction?.type !== 'files') return
    const payload = enterAction.payload
    if (!payload?.length) return

    const file: File = payload[0]
    const path = window.ztools.getPathForFile(file)

    if (file.size > LARGE) {
      setSql('')
      setFilePath(path)
      setIsLarge(true)
    } else {
      const reader = new FileReader()
      reader.onload = (e) => {
        setSql(e.target?.result as string ?? '')
        setFilePath(path)
        setIsLarge(false)
      }
      reader.readAsText(file, 'utf-8')
    }
  }, [enterAction])
}
