import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { renderPdfFirstPageThumb } from '../utils/pdfThumb'
import { fileFromBase64 } from '../utils/fileFromShared'

export type ThumbStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface SharedFile {
  id: string
  path: string
  name: string
  size: number
  rawFile?: File
  pageCount?: number
  thumbUrl?: string
  thumbStatus: ThumbStatus
}

interface SharedFilesContextValue {
  files: SharedFile[]
  selectedIds: string[]
  selectedFiles: SharedFile[]
  selectedId: string | null
  selectedFile: SharedFile | null
  singleFile: SharedFile | null
  addFiles: (files: File[]) => void
  addPaths: (paths: string[]) => void
  removeFile: (id: string) => void
  removeAt: (index: number) => void
  clear: () => void
  selectFile: (id: string, opts?: { toggle?: boolean; exclusive?: boolean }) => void
  setSelectedIds: (ids: string[]) => void
  selectAll: () => void
  clearSelection: () => void
  reorder: (fromIndex: number, toIndex: number) => void
}

const SharedFilesContext = createContext<SharedFilesContextValue | null>(null)

let idSeq = 0
function nextId() {
  idSeq += 1
  return `sf-${Date.now()}-${idSeq}`
}

function basename(p: string) {
  const normalized = p.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || p
}

function normalizeSelected(ids: string[], files: SharedFile[]): string[] {
  const set = new Set(files.map((f) => f.id))
  const next = ids.filter((id) => set.has(id))
  if (next.length > 0) return next
  return files[0] ? [files[0].id] : []
}

export function SharedFilesProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<SharedFile[]>([])
  const [selectedIds, setSelectedIdsState] = useState<string[]>([])
  const queueRef = useRef(0)
  const maxConcurrent = 2

  const runThumb = useCallback(async (id: string, file: File) => {
    while (queueRef.current >= maxConcurrent) {
      await new Promise((r) => setTimeout(r, 40))
    }
    queueRef.current += 1
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, thumbStatus: 'loading' as const } : f)),
    )
    try {
      const { thumbUrl, pageCount } = await renderPdfFirstPageThumb(file)
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id ? { ...f, thumbUrl, pageCount, thumbStatus: 'ready' as const } : f,
        ),
      )
    } catch {
      setFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, thumbStatus: 'error' as const } : f)),
      )
    } finally {
      queueRef.current -= 1
    }
  }, [])

  /** Path-only entries: stat size, hydrate File via preload, then thumb. */
  const hydratePathEntry = useCallback(
    async (id: string, filePath: string, name: string) => {
      let size = 0
      try {
        const st = window.services?.statFile?.(filePath)
        if (st && typeof st.size === 'number') size = st.size
      } catch {
        // ignore
      }

      let rawFile: File | undefined
      try {
        if (typeof window.services.readFileBase64 === 'function') {
          const b64 = window.services.readFileBase64(filePath)
          rawFile = fileFromBase64(b64, name || basename(filePath))
          if (!size && rawFile.size) size = rawFile.size
        }
      } catch {
        rawFile = undefined
      }

      setFiles((prev) =>
        prev.map((f) =>
          f.id === id
            ? {
                ...f,
                size: size || f.size,
                rawFile: rawFile || f.rawFile,
                thumbStatus: rawFile ? ('idle' as const) : ('error' as const),
              }
            : f,
        ),
      )

      if (rawFile) {
        void runThumb(id, rawFile)
      } else {
        // Still try page count for split UI
        try {
          if (typeof window.services.getPdfPageCount === 'function') {
            const n = await window.services.getPdfPageCount(filePath)
            if (n > 0) {
              setFiles((prev) =>
                prev.map((f) => (f.id === id ? { ...f, pageCount: n } : f)),
              )
            }
          }
        } catch {
          // ignore
        }
      }
    },
    [runThumb],
  )

  const addFiles = useCallback(
    (newFiles: File[]) => {
      const mapped: SharedFile[] = newFiles.map((f) => {
        let filePath = f.name
        try {
          filePath = window.ztools.getPathForFile(f) || f.name
        } catch {
          filePath = f.name
        }
        return {
          id: nextId(),
          path: filePath,
          name: f.name,
          size: f.size,
          rawFile: f,
          thumbStatus: 'idle' as const,
        }
      })

      let addedIds: string[] = []
      setFiles((prev) => {
        const seen = new Set(prev.map((p) => p.path))
        const added = mapped.filter((m) => {
          if (seen.has(m.path)) return false
          seen.add(m.path)
          return true
        })
        addedIds = added.map((a) => a.id)
        if (added.length === 0) return prev
        queueMicrotask(() => {
          for (const a of added) {
            if (a.rawFile) void runThumb(a.id, a.rawFile)
          }
        })
        return [...prev, ...added]
      })

      setSelectedIdsState((prev) => {
        if (addedIds.length === 0) return prev
        // Always select newly added files so convert/split act on them
        return Array.from(new Set([...prev, ...addedIds]))
      })
    },
    [runThumb],
  )

  const addPaths = useCallback(
    (paths: string[]) => {
      const newIds: string[] = []
      const toHydrate: Array<{ id: string; path: string; name: string }> = []
      const normalized = paths
        .map((p) => (typeof p === 'string' ? p.trim() : ''))
        .filter((p) => p.length > 0)

      setFiles((prev) => {
        const seen = new Set(prev.map((p) => p.path))
        const added: SharedFile[] = []
        for (const p of normalized) {
          if (seen.has(p)) continue
          seen.add(p)
          const id = nextId()
          const name = basename(p)
          newIds.push(id)
          toHydrate.push({ id, path: p, name })
          added.push({
            id,
            path: p,
            name,
            size: 0,
            thumbStatus: 'loading',
          })
        }
        if (added.length === 0) return prev
        queueMicrotask(() => {
          for (const item of toHydrate) {
            void hydratePathEntry(item.id, item.path, item.name)
          }
        })
        return [...prev, ...added]
      })
      setSelectedIdsState((prev) => {
        if (newIds.length === 0) return prev
        return Array.from(new Set([...prev, ...newIds]))
      })
    },
    [hydratePathEntry],
  )

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id))
    setSelectedIdsState((prev) => prev.filter((x) => x !== id))
  }, [])

  const removeAt = useCallback((index: number) => {
    setFiles((prev) => {
      const target = prev[index]
      if (!target) return prev
      setSelectedIdsState((sel) => sel.filter((x) => x !== target.id))
      return prev.filter((_, i) => i !== index)
    })
  }, [])

  const clear = useCallback(() => {
    setFiles([])
    setSelectedIdsState([])
  }, [])

  const selectFile = useCallback((id: string, opts?: { toggle?: boolean; exclusive?: boolean }) => {
    setSelectedIdsState((prev) => {
      if (opts?.exclusive) return [id]
      if (opts?.toggle) {
        if (prev.includes(id)) return prev.filter((x) => x !== id)
        return [...prev, id]
      }
      return [id]
    })
  }, [])

  const setSelectedIds = useCallback((ids: string[]) => {
    setSelectedIdsState(ids)
  }, [])

  const selectAll = useCallback(() => {
    setFiles((prev) => {
      setSelectedIdsState(prev.map((f) => f.id))
      return prev
    })
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedIdsState([])
  }, [])

  const reorder = useCallback((fromIndex: number, toIndex: number) => {
    setFiles((prev) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex >= prev.length ||
        fromIndex === toIndex
      ) {
        return prev
      }
      const next = [...prev]
      const [item] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, item)
      return next
    })
  }, [])

  const effectiveSelectedIds = useMemo(
    () => normalizeSelected(selectedIds, files),
    [selectedIds, files],
  )

  const selectedFiles = useMemo(
    () => files.filter((f) => effectiveSelectedIds.includes(f.id)),
    [files, effectiveSelectedIds],
  )

  const selectedFile = selectedFiles[0] || null
  const selectedId = selectedFile?.id ?? null

  const value = useMemo<SharedFilesContextValue>(
    () => ({
      files,
      selectedIds: effectiveSelectedIds,
      selectedFiles,
      selectedId,
      selectedFile,
      singleFile: selectedFile,
      addFiles,
      addPaths,
      removeFile,
      removeAt,
      clear,
      selectFile,
      setSelectedIds,
      selectAll,
      clearSelection,
      reorder,
    }),
    [
      files,
      effectiveSelectedIds,
      selectedFiles,
      selectedId,
      selectedFile,
      addFiles,
      addPaths,
      removeFile,
      removeAt,
      clear,
      selectFile,
      setSelectedIds,
      selectAll,
      clearSelection,
      reorder,
    ],
  )

  return (
    <SharedFilesContext.Provider value={value}>{children}</SharedFilesContext.Provider>
  )
}

export function useSharedFiles(): SharedFilesContextValue {
  const ctx = useContext(SharedFilesContext)
  if (!ctx) {
    throw new Error('useSharedFiles must be used within SharedFilesProvider')
  }
  return ctx
}
