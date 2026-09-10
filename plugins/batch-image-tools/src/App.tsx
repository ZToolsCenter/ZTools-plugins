import { useEffect, useState } from 'react'
import BatchImage, { type EnterAction } from './BatchImage'

const DEV_ENTER_ACTION: EnterAction = { code: 'batch' }

function isOutsideZTools() {
  return import.meta.env.DEV && typeof window.ztools?.isDev !== 'function'
}

export default function App() {
  const [enterAction, setEnterAction] = useState<EnterAction>(
    () => (import.meta.env.DEV ? DEV_ENTER_ACTION : {})
  )

  useEffect(() => {
    const ztools = window.ztools
    if (!ztools) return

    ztools.onPluginEnter((action) => {
      setEnterAction(action as EnterAction)
      ztools.setExpendHeight(720)
    })
    ztools.onPluginOut(() => {
      setEnterAction(import.meta.env.DEV ? DEV_ENTER_ACTION : {})
    })
  }, [])

  if (enterAction.code !== 'batch') {
    return null
  }

  return (
    <>
      {isOutsideZTools() && (
        <div className="dev-hint">
          开发预览模式：请在 ZTools 中搜索「批量图片」打开插件以使用完整功能
        </div>
      )}
      <BatchImage enterAction={enterAction} />
    </>
  )
}
