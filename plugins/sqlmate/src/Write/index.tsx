import { useEffect } from 'react'

interface WriteProps {
  enterAction: any
}

export default function Write({ enterAction }: WriteProps) {
  useEffect(() => {
    let outputPath
    try {
      if (enterAction.type === 'over') {
        const p = window.ztools.showSaveDialog({ defaultPath: `${Date.now()}.txt` })
        if (p) { window.services.writeFile(p, enterAction.payload); outputPath = p }
      } else if (enterAction.type === 'img') {
        // 图片暂不支持，忽略
        outputPath = undefined
      }
    } catch {
      // 写入错误弹出通知
      window.ztools.showNotification('文件保存出错了！')
    }
    if (outputPath) {
      // 在资源管理器中显示
      window.ztools.shellShowItemInFolder(outputPath)
    }
    // 退出插件应用
    window.ztools.outPlugin()
  }, [enterAction])

  return null
}
