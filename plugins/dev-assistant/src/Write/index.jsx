import { useEffect } from 'react'
import { getHost } from '../host.js'

export default function Write ({ enterAction }) {
  useEffect(() => {
    const host = getHost()
    let outputPath
    try {
      if (enterAction.type === 'over') {
        outputPath = window.services.writeTextFile(enterAction.payload)
      } else if (enterAction.type === 'img') {
        outputPath = window.services.writeImageFile(enterAction.payload)
      }
    } catch {
      // 写入错误弹出通知
      host?.showNotification?.('文件保存出错了！')
    }
    if (outputPath) {
      // 在资源管理器中显示
      host?.shellShowItemInFolder?.(outputPath)
    }
    // 退出插件应用
    host?.outPlugin?.()
  }, [enterAction])
}
