import { useEffect, useState } from 'react'
import './index.css'

interface ReadProps {
  enterAction: any
}

export default function Read({ enterAction }: ReadProps) {
  const [filePath, setFilePath] = useState('')
  const [fileContent, setFileContent] = useState('')
  const [error, setError] = useState('')

  const handleOpenDialog = () => {
    // 通过 ZTools 的 api 打开文件选择窗口
    const files = window.ztools.showOpenDialog({
      title: '选择文件',
      properties: ['openFile']
    })
    if (!files) return
    const filePath = files[0]
    setFilePath(filePath)
    try {
      const content = window.services.readFile(filePath)
      setFileContent(content)
    } catch (err: any) {
      setError(err.message)
      setFileContent('')
    }
  }

  useEffect(() => {
    if (enterAction.type === 'files') {
      // 匹配文件进入，直接读取文件
      const filePath = enterAction.payload[0].path
      setFilePath(filePath)
      try {
        const content = window.services.readFile(filePath)
        setFileContent(content)
      } catch (err: any) {
        setError(err.message)
        setFileContent('')
      }
    }
  }, [enterAction])

  return (
    <div className="read">
      <button onClick={handleOpenDialog}>选择文件</button>
      <div className="read-file">{filePath}</div>
      {fileContent && <pre>{fileContent}</pre>}
      {error && <div className="read-error">{error}</div>}
    </div>
  )
}
