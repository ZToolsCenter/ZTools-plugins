export type MatchCmdType = 'over' | 'regex' | 'img' | 'files' | 'window'

export interface WindowMatch {
  app?: string | string[]
  title?: string
  class?: string | string[]
}

export interface MatchCmd {
  type: MatchCmdType
  label: string
  match?: string | WindowMatch
  exclude?: string
  minLength?: number
  maxLength?: number
  fileType?: 'file' | 'directory' | ''
}

export type Cmd = string | MatchCmd

// 指令（feature）结构与原版一致；mainHide 也在 feature 内
export interface Feature {
  code: string
  explain: string
  icon?: string
  platform?: string[]
  mainHide?: boolean
  cmds: Cmd[]
}

// 自定义脚本文档
export interface ScriptDoc {
  _id: string
  _rev?: string
  categoryId: string
  feature: Feature
  script: string
}

export interface CategoryDoc {
  _id: string
  _rev?: string
  label: string
}

// 指令类型显示名（与原版一致）
export const CMD_TYPE_NAMES: Record<string, string> = {
  keyword: '功能指令',
  over: '【任意文本】匹配指令',
  regex: '【特定文本】匹配指令',
  files: '【文件】匹配指令',
  img: '【图像】匹配指令',
  window: '【系统窗口】匹配指令'
}

// 点击匹配类指令时的说明提示（与原版一致）
export const CMD_TYPE_TIPS: Record<string, string> = {
  over: '【匹配任意文本】ZTools 搜索面板输入任意文本或选中任意文本弹出超级面板',
  regex: '【匹配特定文本】ZTools 搜索面板输入特定文本或选中特定文本弹出超级面板',
  img: '【匹配图像】ZTools 搜索面板粘贴截图或截图后弹出超级面板',
  files: '【匹配文件】ZTools 搜索面板粘贴文件或选中文件弹出超级面板',
  window: '【匹配窗口】在特定窗口下呼出 ZTools 搜索面板或弹出超级面板'
}

export const PLATFORMS = [
  { value: 'win32', name: 'Windows' },
  { value: 'darwin', name: 'macOS' },
  { value: 'linux', name: 'Linux' }
] as const

export const platformName = (p: string) =>
  ({ win32: 'Windows', darwin: 'macOS', linux: 'Linux' })[p] || p
