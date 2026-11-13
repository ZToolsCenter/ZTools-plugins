export type EntryType = 'app' | 'folder' | 'file' | 'url' | 'plugin' | 'system';
export interface Category { id: string; name: string; icon: string; color: string; image?: string }
export interface Entry extends Category { categoryId: string; type: EntryType; target: string; plugin?: string }
export interface Settings { enabled: boolean; searchEnabled: boolean; displayId: string; openDelay: number; closeDelay: number; triggerWidth: number; triggerHeight: number; triggerOpacity: number; accent: string; columns: number; cardSize: number; theme: 'light' | 'dark' | 'system'; lastCategoryId: string }
export interface Config { version: number; settings: Settings; categories: Category[]; entries: Entry[] }
export interface State { config: Config; expanded: boolean; trayVisible: boolean; pinned: boolean; additionId?: string; error: string; dark: boolean; displays: { id: string; label: string; width: number; height: number; scaleFactor: number }[] }
export interface Bridge { surface: string; ready: Promise<void>; call: (op: string, payload?: unknown) => Promise<any>; subscribe: (fn: (state: State) => void) => () => void; filePaths: (files: FileList | File[]) => string[] }
declare global { interface Window { dock: Bridge } }
