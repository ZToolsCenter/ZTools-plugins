import { clipboard } from 'electron'
import {
  convertByCode,
  hasConvertibleNaming,
  hasEnglishLetter,
  isNamingCode,
} from './case-convert.js'

/** 计划退出插件的时长 */
const IDLE_KILL_MS = 3 * 60 * 1000

let idleKillTimer: ReturnType<typeof setTimeout> | null = null

function clearIdleKillTimer(): void {
  if (idleKillTimer !== null) {
    clearTimeout(idleKillTimer)
    idleKillTimer = null
  }
}

/** 隐藏窗口，如果三分钟内没有使用则退出插件 */
function scheduleIdleKill(): void {
  clearIdleKillTimer()
  idleKillTimer = setTimeout(() => {
    idleKillTimer = null
    window.ztools.outPlugin(true)
  }, IDLE_KILL_MS)
}

function resolvePayloadText(payload: unknown): string {
  if (typeof payload === 'string') return payload
  if (payload && typeof payload === 'object' && 'text' in payload) {
    const text = (payload as { text: unknown }).text
    if (typeof text === 'string') return text
  }
  return ''
}

function resolveInputText(type: string, payload: unknown): string {
  if (type === 'regex' || type === 'over') {
    return resolvePayloadText(payload)
  }
  return clipboard.readText()
}

/** 隐藏窗口并计划空闲退出 */
function exitPlugin(): void {
  window.ztools.outPlugin(false)
  scheduleIdleKill()
}

/** 提示后退出 */
function failAndExit(message: string): void {
  window.ztools.showNotification(message)
  window.ztools.hideMainWindow()
  exitPlugin()
}

window.ztools.onPluginEnter(({ code, type, payload }: { code: string; type: string; payload: unknown }) => {
  clearIdleKillTimer()

  try {
    const text = resolveInputText(type, payload)

    if (!text.trim()) {
      failAndExit('文本为空，无法转换')
      return
    }

    if (isNamingCode(code)) {
      if (!hasConvertibleNaming(text)) {
        failAndExit('无法识别可转换的命名片段')
        return
      }
    } else if (!hasEnglishLetter(text)) {
      failAndExit('未检测到有效英文字母')
      return
    }

    const result = convertByCode(code, text)
    if (result === null) {
      failAndExit('未知功能')
      return
    }

    if (isNamingCode(code) && result === '') {
      failAndExit('无法识别可转换的命名片段')
      return
    }

    const fromSelection = type === 'regex' || type === 'over'
    if (fromSelection) {
      window.ztools.hideMainWindowPasteText(result)
    } else {
      window.ztools.copyText(result)
      window.ztools.hideMainWindow()
    }

    // window.ztools.showNotification(successMessage(code))
    exitPlugin()
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    failAndExit(detail ? `转换失败：${detail}` : '转换失败')
  }
})

window.ztools.onPluginOut((processExit) => {
  if (processExit) clearIdleKillTimer()
})
