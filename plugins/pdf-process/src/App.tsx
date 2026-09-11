import { useEffect, useState, type ComponentType } from 'react'
import Sidebar from './components/Sidebar'
import Settings from './components/Settings'
import PluginEnterBridge from './components/PluginEnterBridge'
import { SharedFilesProvider } from './context/SharedFilesContext'
import Compress from './Compress'
import Merge from './Merge'
import Split from './Split'
import Watermark from './Watermark'
import PdfToImage from './PdfToImage'
import PdfToWord from './PdfToWord'
import PdfToPpt from './PdfToPpt'
import PdfToExcel from './PdfToExcel'

const routes: Record<string, ComponentType<any>> = {
  compress: Compress,
  merge: Merge,
  split: Split,
  watermark: Watermark,
  pdfToImage: PdfToImage,
  pdfToWord: PdfToWord,
  pdfToPpt: PdfToPpt,
  pdfToExcel: PdfToExcel,
  // alias used by plugin.json feature code
  extractImages: PdfToImage,
}

export default function App() {
  const [route, setRoute] = useState('compress')
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    window.ztools.onPluginOut(() => {
      setShowSettings(false)
    })
  }, [])

  const handleSelect = (code: string) => {
    if (code === 'settings') {
      setShowSettings(true)
    } else if (routes[code]) {
      setRoute(code)
      setShowSettings(false)
    } else {
      setRoute(code)
    }
  }

  const handleBack = () => {
    window.ztools.outPlugin()
  }

  const handleOpenSettings = () => {
    setShowSettings(true)
  }

  const RouteComponent = routes[route] || routes.compress

  return (
    <SharedFilesProvider>
      <PluginEnterBridge
        onRoute={(code) => {
          if (routes[code]) {
            setRoute(code)
            setShowSettings(false)
          }
        }}
        onOpenSettings={handleOpenSettings}
      />
      <div style={{ display: 'flex', height: '100vh', background: '#1a1a2e' }}>
        <Sidebar activeCode={showSettings ? 'settings' : route} onSelect={handleSelect} />
        <div style={{ flex: 1, padding: '20px', overflow: 'auto' }}>
          <RouteComponent onBack={handleBack} onOpenSettings={handleOpenSettings} />
        </div>
        {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      </div>
    </SharedFilesProvider>
  )
}
