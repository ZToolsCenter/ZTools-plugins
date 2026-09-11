import { useEffect, useRef } from 'react'
import { useSharedFiles } from '../context/SharedFilesContext'

const FEATURE_ROUTES = new Set([
  'compress',
  'merge',
  'split',
  'watermark',
  'pdfToImage',
  'pdfToWord',
  'pdfToPpt',
  'pdfToExcel',
  'extractImages',
])

/** Super-panel / files feature codes that should land on a default tool. */
const FILES_ENTRY_DEFAULT_ROUTE: Record<string, string> = {
  pdf_open: 'compress',
  extractImages: 'pdfToImage',
}

export type PluginEnterAction = {
  code?: string
  type?: string
  payload?: unknown
  option?: unknown
  from?: string
}

/** Pull local file path strings out of ZTools enter payload (files / panel). */
export function extractPathsFromPayload(payload: unknown): string[] {
  if (payload == null) return []

  if (typeof payload === 'string') {
    const s = payload.trim()
    return s ? [s] : []
  }

  if (Array.isArray(payload)) {
    const out: string[] = []
    for (const item of payload) {
      if (typeof item === 'string' && item.trim()) {
        out.push(item.trim())
      } else if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>
        const p =
          (typeof o.path === 'string' && o.path) ||
          (typeof o.filePath === 'string' && o.filePath) ||
          (typeof o.filepath === 'string' && o.filepath) ||
          (typeof o.url === 'string' && o.url) ||
          ''
        if (p.trim()) out.push(p.trim())
      }
    }
    return out
  }

  if (typeof payload === 'object') {
    const o = payload as Record<string, unknown>
    if (Array.isArray(o.files)) return extractPathsFromPayload(o.files)
    if (Array.isArray(o.filePaths)) return extractPathsFromPayload(o.filePaths)
    if (Array.isArray(o.paths)) return extractPathsFromPayload(o.paths)
    if (typeof o.path === 'string') return extractPathsFromPayload(o.path)
    if (typeof o.data === 'string' || Array.isArray(o.data)) {
      return extractPathsFromPayload(o.data)
    }
  }

  return []
}

export function resolveEnterRoute(action: PluginEnterAction): string | null {
  const code = action.code || ''
  if (code === 'settings') return null
  if (FEATURE_ROUTES.has(code)) {
    // extractImages feature historically maps to pdfToImage UI
    if (code === 'extractImages') return 'pdfToImage'
    return code
  }
  if (FILES_ENTRY_DEFAULT_ROUTE[code]) return FILES_ENTRY_DEFAULT_ROUTE[code]
  // Super panel file open without a tool code
  if (action.type === 'files' || action.from === 'panel') return 'compress'
  return null
}

interface PluginEnterBridgeProps {
  onRoute: (code: string) => void
  onOpenSettings: () => void
}

/**
 * Must render under SharedFilesProvider.
 * Wires ZTools super-panel / feature enter → route + file list.
 */
export default function PluginEnterBridge({
  onRoute,
  onOpenSettings,
}: PluginEnterBridgeProps) {
  const { addPaths } = useSharedFiles()
  const addPathsRef = useRef(addPaths)
  addPathsRef.current = addPaths
  const onRouteRef = useRef(onRoute)
  onRouteRef.current = onRoute
  const onOpenSettingsRef = useRef(onOpenSettings)
  onOpenSettingsRef.current = onOpenSettings

  useEffect(() => {
    const handleEnter = (action: PluginEnterAction) => {
      try {
        if (action?.code === 'settings') {
          onOpenSettingsRef.current()
          return
        }

        const route = resolveEnterRoute(action || {})
        if (route) onRouteRef.current(route)

        // Files from super panel / files cmd: payload is path or path[]
        const isFiles =
          action?.type === 'files' ||
          action?.code === 'pdf_open' ||
          action?.from === 'panel'
        if (isFiles || action?.payload != null) {
          const paths = extractPathsFromPayload(action?.payload)
          // Only import when it looks like filesystem paths (avoid stuffing search text)
          const filePaths = paths.filter((p) => {
            if (/\.pdf$/i.test(p)) return true
            // Windows / Unix absolute paths
            if (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.startsWith('/')) {
              return true
            }
            return false
          })
          if (filePaths.length) {
            addPathsRef.current(filePaths)
          }
        }
      } catch (e) {
        console.warn('[PluginEnterBridge] handleEnter failed', e)
      }
    }

    window.ztools.onPluginEnter(handleEnter)

    // Some hosts keep a pending enter if handler registered late
    try {
      const pending = (window as any).__ztoolsPendingEnter
      if (pending) {
        handleEnter(pending)
        delete (window as any).__ztoolsPendingEnter
      }
    } catch {
      // ignore
    }
  }, [])

  return null
}
