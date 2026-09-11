import type { Canvas } from 'fabric'
import type { EditorCommands } from '../state/editorCommands'
import type { EditorSelectors } from '../state/editorSelectors'
import type { EditorStore } from '../state/editorStore'

export type EditorLifecyclePhase = 'created' | 'mounted' | 'canvas-ready' | 'document-ready' | 'disposed'

export type EditorMaybePromise<T = void> = T | Promise<T>

export interface EditorRuntimeLogger {
  warn?: (...args: unknown[]) => void
  error?: (...args: unknown[]) => void
}

export interface EditorRuntimeServices {
  window: Window
  logger: EditorRuntimeLogger
}

export interface EditorRuntimeState {
  store?: EditorStore
  commands?: EditorCommands
  selectors?: EditorSelectors
}

export interface EditorContext {
  services: EditorRuntimeServices
  state: EditorRuntimeState
  getCanvas: () => Canvas | null
  setCanvas: (canvas: Canvas | null) => void
  getPhase: () => EditorLifecyclePhase
}

export interface EditorModule {
  name: string
  onCreate?: (context: EditorContext) => EditorMaybePromise
  onMount?: (context: EditorContext) => EditorMaybePromise
  onCanvasReady?: (context: EditorContext) => EditorMaybePromise
  onDocumentReady?: (context: EditorContext) => EditorMaybePromise
  onDispose?: (context: EditorContext) => EditorMaybePromise
}

export interface EditorRuntime {
  context: EditorContext
  readonly modules: readonly EditorModule[]
  readonly phase: EditorLifecyclePhase
  register: (module: EditorModule) => void
  mount: () => Promise<void>
  markCanvasReady: () => Promise<void>
  markDocumentReady: () => Promise<void>
  dispose: () => Promise<void>
}
