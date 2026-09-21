// 终端类型与探测结果（preload/services.js detectTerminals 的返回结构）
// 'terminal' / 'iterm' 仅 macOS；其余仅 Windows
export type TerminalType = 'wt' | 'pwsh' | 'powershell' | 'cmd' | 'gitbash' | 'terminal' | 'iterm'

export interface TerminalInfo {
  type: TerminalType
  label: string
  available: boolean
  exe?: string
  path?: string
}
