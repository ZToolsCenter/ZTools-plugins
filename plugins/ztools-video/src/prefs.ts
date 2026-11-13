const AUTO_NEXT_KEY = 'auto-play-next'
const DISCLAIMER_KEY = 'disclaimer-accepted'

/**
 * 读取「自动连播」开关。
 * 与播放记录一致：优先用 ZTools 键值存储，网页预览时退回 localStorage。
 * @returns 是否自动播放下一集，默认开启。
 */
export function readAutoNext(): boolean {
  try {
    const raw = typeof ztools !== 'undefined'
      ? ztools.dbStorage.getItem<unknown>(AUTO_NEXT_KEY)
      : JSON.parse(localStorage.getItem(AUTO_NEXT_KEY) || 'null')
    // 只有明确关闭过才返回 false。
    return raw !== false
  } catch {
    return true
  }
}

/**
 * 保存「自动连播」开关。
 * @param value 是否自动播放下一集。
 */
export function saveAutoNext(value: boolean) {
  try {
    if (typeof ztools !== 'undefined') ztools.dbStorage.setItem(AUTO_NEXT_KEY, value)
    else localStorage.setItem(AUTO_NEXT_KEY, JSON.stringify(value))
  } catch {
    // 存储不可用时只影响这次选择能否记住，不打断播放。
  }
}

/**
 * 读取是否已确认免责声明。
 * @returns 已确认过时为 true；存储不可用时按未确认处理，宁可多提示一次。
 */
export function readDisclaimerAccepted(): boolean {
  try {
    const raw = typeof ztools !== 'undefined'
      ? ztools.dbStorage.getItem<unknown>(DISCLAIMER_KEY)
      : JSON.parse(localStorage.getItem(DISCLAIMER_KEY) || 'null')
    return raw === true
  } catch {
    return false
  }
}

/**
 * 记录用户已确认免责声明。
 */
export function acceptDisclaimer() {
  try {
    if (typeof ztools !== 'undefined') ztools.dbStorage.setItem(DISCLAIMER_KEY, true)
    else localStorage.setItem(DISCLAIMER_KEY, JSON.stringify(true))
  } catch {
    // 写入失败时下次仍会提示，不影响本次使用。
  }
}
