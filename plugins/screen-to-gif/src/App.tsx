// 开发者：HL
import { useEffect, useState } from 'react'
import GifRecorder from './GifRecorder'

// 开发环境且未运行在 ZTools 中时，注入最小 mock，方便浏览器直接预览界面
if (import.meta.env.DEV && !window.ztools) {
  const display = {
    id: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 960 },
    workAreaSize: { width: 1920, height: 960 },
    size: { width: 1920, height: 1080 },
    scaleFactor: 2,
    rotation: 0,
    internal: false,
    monochrome: false
  }
  window.ztools = {
    onPluginEnter: (callback) =>
      callback({ code: 'gif', type: 'feature', payload: '', option: {} }),
    onPluginOut: () => {},
    getAllDisplays: () => [display],
    getPrimaryDisplay: () => display,
    getPath: () => '/tmp/ztools-mock',
    desktopCaptureSources: () =>
      Promise.resolve([
        { id: 'screen:1:0', name: '屏幕 1', display_id: '1' },
        { id: 'window:1:2', name: '窗口预览' }
      ]),
    createBrowserWindow: () => ({ close: () => {}, isDestroyed: () => false }),
    hideMainWindow: () => {},
    showMainWindow: () => {},
    runFFmpeg: () => Promise.resolve(),
    copyImage: () => {},
    showNotification: () => {},
    shellShowItemInFolder: () => {},
    showSaveDialog: () => '/tmp/ztools-mock.gif'
  } as any
  window.services = {
    createTempFile: (ext: string) => `/tmp/ztools-mock-${Date.now()}.${ext}`,
    appendFile: () => {},
    removeFile: () => {},
    readFileAsDataUrl: () => 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=',
    saveGifTo: () => '/tmp/ztools-mock.gif',
    onChildMessage: () => {},
    openRegionWindow: () => ({ close: () => {}, isDestroyed: () => false }),
    openControlsWindow: () => ({ close: () => {}, isDestroyed: () => false }),
    closeWindow: () => {}
  } as any
}

export default function App() {
  const [route, setRoute] = useState('')

  // ZTools 进入插件时按功能 code 切换页面
  useEffect(() => {
    window.ztools.onPluginEnter((action) => {
      setRoute(action.code)
    })
    window.ztools.onPluginOut(() => {
      setRoute('')
    })
  }, [])

  if (route === 'gif') return <GifRecorder />
  return null
}
