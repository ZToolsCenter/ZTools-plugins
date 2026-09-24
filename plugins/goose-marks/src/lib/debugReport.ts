type ConsoleLevel = 'log' | 'info' | 'warn' | 'error'

type ConsoleEntry = {
  ts: number
  level: ConsoleLevel
  message: string
}

type BehaviorEntry = {
  ts: number
  action: string
  detail?: string
}

const MAX_ENTRIES = 200
const consoleEntries: ConsoleEntry[] = []
const behaviorEntries: BehaviorEntry[] = []
let consolePatched = false

const pushEntry = <T>(list: T[], entry: T) => {
  list.push(entry)
  if (list.length > MAX_ENTRIES) list.shift()
}

const formatArg = (arg: unknown) => {
  if (typeof arg === 'string') return arg
  if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg)
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`
  try {
    return JSON.stringify(arg)
  } catch {
    return String(arg)
  }
}

const captureConsole = (level: ConsoleLevel, args: unknown[]) => {
  const message = args.map(formatArg).join(' ')
  pushEntry(consoleEntries, { ts: Date.now(), level, message })
}

export const initConsoleCapture = () => {
  if (consolePatched) return
  consolePatched = true
  ;(['log', 'info', 'warn', 'error'] as ConsoleLevel[]).forEach(level => {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      captureConsole(level, args)
      original(...args)
    }
  })
}

export const addBehaviorLog = (action: string, detail?: string) => {
  pushEntry(behaviorEntries, { ts: Date.now(), action, detail })
}

export const getDebugSnapshot = () => ({
  behavior: [...behaviorEntries],
  console: [...consoleEntries]
})
