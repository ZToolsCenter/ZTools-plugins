export interface IDEItem {
  code: string
  name: string
  command: string
  dbPath: string
  shell?: string
}

export interface ProjectItem {
  name: string
  path: string
  uri: string
  type: 'folder' | 'file' | 'workspace' | 'remote'
  label: string
}

const STORAGE_KEY = 'ide-ides'

export function getIDEs(): IDEItem[] {
  try {
    const data = window.ztools.dbStorage.getItem(STORAGE_KEY)
    return Array.isArray(data) ? data : []
  } catch { return [] }
}

export function saveIDEs(ides: IDEItem[]) {
  window.ztools.dbStorage.setItem(STORAGE_KEY, ides)
  window.services?.registerFeatures()
}

export function addIDE(ide: IDEItem) {
  const ides = getIDEs()
  const idx = ides.findIndex(i => i.code === ide.code)
  if (idx >= 0) ides[idx] = ide
  else ides.push(ide)
  saveIDEs(ides)
}

export function removeIDE(code: string) {
  saveIDEs(getIDEs().filter(i => i.code !== code))
}

export function getPresets() {
  return window.services?.getPresets() || {}
}

export function getQuickFillPresets() {
  return window.services?.getQuickFillPresets() || []
}

export async function detectPresetPaths() {
  return window.services?.detectPresetPaths() || {}
}

export async function readProjects(dbPath: string): Promise<ProjectItem[]> {
  if (!window.services) throw new Error('preload 未就绪')
  return window.services.readProjects(dbPath)
}

export async function openProject(command: string, uri: string, shell?: string) {
  return window.services.openProject(command, uri, shell)
}

export async function deleteProject(dbPath: string, uri: string) {
  return window.services.deleteProject(dbPath, uri)
}

export function getAppDataPath() {
  return window.services?.getAppDataPath() || ''
}

export function getDefaultShell() {
  return window.services?.getDefaultShell() || ''
}
