import figlet from 'figlet'
// @ts-ignore
import { registerAllFonts, ALL_FONT_NAMES } from '../constants/fonts.js'

let initialized = false

export function initFiglet() {
  if (initialized) return
  registerAllFonts()
  initialized = true
}

export function generateAsciiArt(
  text: string,
  font: string,
  horizontalLayout: string = 'default',
  verticalLayout: string = 'default'
): string {
  if (!text) return ''
  if (!initialized) initFiglet()
  try {
    return figlet.textSync(text, {
      font,
      horizontalLayout: horizontalLayout as any,
      verticalLayout: verticalLayout as any,
    })
  } catch {
    return `[字体 "${font}" 不支持当前输入]`
  }
}

export function getAllFontNames(): string[] {
  return ALL_FONT_NAMES
}
