const https = require('node:https')

const STORAGE_KEY = 'easyremind_reminders'
const GROUPS_KEY = 'easyremind_groups'
const LOG_KEY = 'easyremind_logs'
const HOLIDAY_KEY = 'easyremind_holidays'
const HOLIDAY_API = 'https://timor.tech/api/holiday/year/'
const HOLIDAY_TIMEOUT_MS = 5000
const HOLIDAY_NEXT_YEAR_MONTH = 11 // 12 月起（getMonth()=11）进插件时顺带补次年数据
const HOLIDAY_RECHECK_MS = 60 * 60 * 1000 // 后台常驻时每小时自检一次节假日数据（跨年补数据）

// 调度自愈参数
const INIT_RETRY_MS = 300 // 宿主 API 未注入时的快速重试间隔
const INIT_FAST_TRIES = 40 // 快速重试次数（300ms × 40 ≈ 12s），之后交给看门狗慢速重试
const WATCHDOG_INTERVAL_MS = 30 * 1000 // 看门狗巡检间隔
const MISSED_FIRE_GRACE_MS = 5 * 60 * 1000 // 错过的触发在此时间内仍补发，超过则只重排不补发
const MIN_REARM_DELAY_MS = 1000 // 触发后重排的最小延迟：数据异常（如状态写不进去）时不会 0 延迟自我循环
const TRIGGER_MATCH_WINDOW_MS = 1000 // 触发命中窗口：实际时刻与计划时刻相差在此范围内即视为「到点」
const ERROR_BACKOFF_MS = 30 * 1000 // 触发处理抛错后的退避间隔

// ==================== 工具函数 ====================
function pad2(n) {
  return String(n).padStart(2, '0')
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// 日志时间戳：年月日 + 时分秒.毫秒
function formatTimestamp(d) {
  return (
    d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
    pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) + '.' +
    String(d.getMilliseconds()).padStart(3, '0')
  )
}

// ==================== 日志 ====================
let logId = 1

function readLogs() {
  try {
    const data = window.ztools.dbStorage.getItem(LOG_KEY)
    if (!data) return []
    const raw = typeof data === 'string' ? JSON.parse(data) : data
    return Array.isArray(raw) ? raw : []
  } catch (e) {
    return []
  }
}

function writeLogs(logs) {
  try {
    window.ztools.dbStorage.setItem(LOG_KEY, JSON.stringify(logs))
  } catch (e) {}
}

function addLog(message, detail) {
  try {
    const logs = readLogs()
    const time = formatTimestamp(new Date())
    logs.unshift({ id: logId++, time, message, detail: detail || {} })
    if (logs.length > 100) logs.length = 100
    writeLogs(logs)
  } catch (e) {}
}

// ==================== 提醒数据 ====================
// 读失败（宿主 IPC 异常）与「确实没有数据」必须区分：
// 前者要等下一轮重试，后者是合法状态（无待触发项）
let storageReadFailed = false

function readReminders() {
  try {
    const data = window.ztools.dbStorage.getItem(STORAGE_KEY)
    storageReadFailed = false
    if (!data) return []
    const raw = typeof data === 'string' ? JSON.parse(data) : data
    return Array.isArray(raw) ? normalizeReminderOrders(raw) : []
  } catch (e) {
    storageReadFailed = true
    console.error('[easyremind] readReminders error:', e)
    return []
  }
}

function writeReminders(list) {
  window.ztools.dbStorage.setItem(STORAGE_KEY, JSON.stringify(list))
}

// 排序字段迁移：旧数据没有 order，按原显示顺序补齐（任务按创建时间倒序、以分组为桶）
function normalizeReminderOrders(list) {
  if (list.every(r => typeof r.order === 'number')) return list
  const buckets = new Map()
  for (const r of list) {
    const key = r.groupId || ''
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(r)
  }
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => b.createdAt - a.createdAt)
    const len = bucket.length
    bucket.forEach((r, i) => { r.order = len - i })
  }
  try {
    writeReminders(list)
  } catch (e) {}
  return list
}

// 某分组（空串表示未分组）当前最大 order，用于把新任务/移入任务排到最前或最后
function maxOrderInBucket(list, bucketKey) {
  let max = 0
  for (const r of list) {
    if ((r.groupId || '') !== bucketKey) continue
    if (typeof r.order === 'number' && r.order > max) max = r.order
  }
  return max
}

// ==================== 分组数据 ====================
function readGroups() {
  try {
    const data = window.ztools.dbStorage.getItem(GROUPS_KEY)
    if (!data) return []
    const raw = typeof data === 'string' ? JSON.parse(data) : data
    return Array.isArray(raw) ? normalizeGroupOrders(raw) : []
  } catch (e) {
    console.error('[easyremind] readGroups error:', e)
    return []
  }
}

function writeGroups(list) {
  window.ztools.dbStorage.setItem(GROUPS_KEY, JSON.stringify(list))
}

// 分组排序迁移：旧数据按创建时间正序补齐 order
function normalizeGroupOrders(list) {
  if (list.every(g => typeof g.order === 'number')) return list
  const sorted = [...list].sort((a, b) => a.createdAt - b.createdAt)
  sorted.forEach((g, i) => { g.order = i })
  try {
    writeGroups(list)
  } catch (e) {}
  return list
}

// 按名称查找，找不到就新建；供表单直接输入新组名时复用
function ensureGroupByName(name) {
  const trimmed = String(name || '').trim()
  if (!trimmed) return null
  const groups = readGroups()
  const existing = groups.find(g => g.name === trimmed)
  if (existing) return existing
  const order = groups.reduce((max, g) => Math.max(max, typeof g.order === 'number' ? g.order : 0), 0)
  const group = { id: generateId(), name: trimmed, createdAt: Date.now(), order: order + 1 }
  groups.push(group)
  writeGroups(groups)
  addLog('[新建组] ' + group.name)
  return group
}

// ==================== 法定节假日数据 ====================
// 数据源 timor.tech/api/holiday，holiday=true 放假 / false 补班（调休上班）
// 缓存结构: { years: { "2026": { "01-01": {h:0|1, n:"元旦"} } }, updatedAt: ts }

let holidayCache = null
let holidayCacheLoaded = false
let holidayUpdating = false

// 宿主 API 有可能在 preload 执行完之后才注入（见文件末尾 init 的重试逻辑），
// 所以节假日缓存改成「宿主就绪后首次使用时」读取，
// 避免模块加载那一刻读到空值并被永久缓存下来
function getHolidayCache() {
  if (holidayCacheLoaded) return holidayCache
  if (!hostReady()) return null
  holidayCache = readHolidayCache()
  holidayCacheLoaded = true
  return holidayCache
}

function readHolidayCache() {
  try {
    const data = window.ztools.dbStorage.getItem(HOLIDAY_KEY)
    if (!data) return null
    const raw = typeof data === 'string' ? JSON.parse(data) : data
    if (!raw || typeof raw !== 'object' || !raw.years) return null
    return raw
  } catch (e) {
    return null
  }
}

function writeHolidayCache(cache) {
  try {
    window.ztools.dbStorage.setItem(HOLIDAY_KEY, JSON.stringify(cache))
  } catch (e) {}
}

// 拉取某年的节假日表（次年未公布时返回空对象，视为"没有新数据"）
function fetchHolidayYear(year) {
  return new Promise((resolve) => {
    let settled = false
    const done = (val) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(val)
    }
    const req = https.get(HOLIDAY_API + year, (res) => {
      let buf = ''
      res.on('data', (c) => { buf += c })
      res.on('end', () => {
        try {
          const json = JSON.parse(buf)
          if (json.code === 0 && json.holiday && typeof json.holiday === 'object') {
            done(json.holiday)
          } else {
            done(null)
          }
        } catch (e) {
          done(null)
        }
      })
    })
    const timer = setTimeout(() => {
      req.destroy()
      done(null)
    }, HOLIDAY_TIMEOUT_MS)
    req.on('error', () => done(null))
  })
}

function normalizeHolidayYear(raw) {
  const out = {}
  for (const key of Object.keys(raw)) {
    const v = raw[key]
    if (!v || typeof v !== 'object') continue
    out[key] = { h: v.holiday ? 1 : 0, n: v.name || '' }
  }
  return out
}

// 进入插件时检查：缓存缺哪年就拉哪年，存在就不管
function holidayNeedFetch(cache) {
  const now = new Date()
  const y = now.getFullYear()
  const years = []
  if (!cache || !cache.years || !cache.years[String(y)]) years.push(y)
  // 12 月起次年被跨年调度用到，若缺则顺带补一次（次年安排此时已公布）
  if (now.getMonth() >= HOLIDAY_NEXT_YEAR_MONTH && (!cache || !cache.years || !cache.years[String(y + 1)])) years.push(y + 1)
  return { need: years.length > 0, years }
}

async function ensureHolidayData(force) {
  if (holidayUpdating) return false
  const cache = readHolidayCache()
  const plan = force
    ? { need: true, years: [new Date().getFullYear()] } // 手动更新：强制重拉当年并覆盖
    : holidayNeedFetch(cache)
  if (!plan.need) return false

  holidayUpdating = true
  try {
    const results = await Promise.all(plan.years.map((y) => fetchHolidayYear(y).then((d) => (d ? normalizeHolidayYear(d) : null))))
    const next = cache || { years: {}, updatedAt: 0 }
    let changed = false
    let anySuccess = false
    results.forEach((norm, i) => {
      if (norm === null) return // 网络/接口失败，保留缓存
      anySuccess = true
      if (Object.keys(norm).length > 0 && JSON.stringify(next.years[plan.years[i]]) !== JSON.stringify(norm)) {
        next.years[plan.years[i]] = norm
        changed = true
      }
    })
    if (anySuccess) {
      next.updatedAt = Date.now()
      writeHolidayCache(next)
      holidayCache = next
      holidayCacheLoaded = true
      if (changed) {
        addLog('[节假日] 数据已更新，覆盖: ' + Object.keys(next.years).map((y) => y + '年').join('、'))
        scheduleNext() // 数据变化后重算下次触发时间
      }
    }
    return changed
  } finally {
    holidayUpdating = false
  }
}

// 某天是工作日还是节假日（无数据时退化为自然周）
function getDayType(d) {
  const cache = getHolidayCache()
  const ym = cache && cache.years && cache.years[d.getFullYear()]
  const key = pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
  if (ym && Object.prototype.hasOwnProperty.call(ym, key)) {
    return ym[key].h === 1 ? 'holiday' : 'workday'
  }
  const wd = d.getDay()
  return wd === 0 || wd === 6 ? 'holiday' : 'workday'
}

function matchDayFilter(d, dayFilter) {
  if (!dayFilter || dayFilter === 'all') return true
  return getDayType(d) === dayFilter
}

// ==================== 触发时间计算 ====================
function getNextTriggerTime(r, atTime) {
  if (!r || !r.enabled) return null

  switch (r.type) {
    case 'once': {
      if (!r.triggerAt || r.lastTriggered !== 0) return null
      return r.triggerAt
    }
    case 'daily': {
      if (!r.weekdays || !r.weekdays.length || !r.triggerTime) return null
      return calcNextDailyTime(r, atTime)
    }
    case 'interval': {
      if (!r.schedules || !r.schedules.length) return null
      return calcNextIntervalTime(r, atTime)
    }
    default:
      return null
  }
}

// 向前找 31 天：最长法定假期 8 天左右，即使叠加「仅工作日/仅节假日」过滤也足够
function calcNextDailyTime(r, atTime) {
  const parts = (r.triggerTime || '').split(':')
  if (parts.length < 2) return null
  const h = Number(parts[0])
  const m = Number(parts[1])
  const base = new Date(atTime)

  for (let i = 0; i <= 30; i++) {
    const next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, h, m, 0, 0)
    if (next.getTime() < atTime) continue
    if (!r.weekdays.includes(next.getDay())) continue
    if (!matchDayFilter(next, r.dayFilter)) continue
    return next.getTime()
  }
  return null
}

function calcNextIntervalTime(r, atTime) {
  const intervalMs = r.interval * 60 * 1000

  // 对齐起点模式：触发点 = 每天 startTime + k × 间隔，与创建时刻无关
  if (r.align === 'start') {
    return calcNextIntervalAligned(r, atTime)
  }

  // 随创建时间起算（旧默认）：锚点 = 上次触发时间（首次为创建时间）
  const anchor = r.lastTriggered > 0 ? r.lastTriggered : (r.createdAt || atTime)
  const elapsed = atTime - anchor
  const periods = Math.max(1, Math.ceil(elapsed / intervalMs))
  let current = anchor + periods * intervalMs

  const schedules = r.schedules
  if (!schedules.length) return null

  // 跳过不满足「工作日/节假日」过滤的整天
  for (let attempt = 0; attempt < 40; attempt++) {
    const d = new Date(current)
    if (!matchDayFilter(d, r.dayFilter)) {
      current = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime()
      continue
    }
    const day = d.getDay()
    const hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes())

    const daySchedules = schedules.filter(s => s.weekday === day).sort((a, b) => a.startTime.localeCompare(b.startTime))
    if (daySchedules.length > 0) {
      for (const s of daySchedules) {
        if (hm >= s.startTime && hm <= s.endTime) {
          return current
        }
      }
      for (const s of daySchedules) {
        if (hm < s.startTime) {
          const sp = s.startTime.split(':')
          const nextStart = new Date(d)
          nextStart.setHours(Number(sp[0]), Number(sp[1]), 0, 0)
          return nextStart.getTime()
        }
      }
    }
    current = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime()
  }
  return null
}

// 对齐起点模式：枚举每天的触发点（startTime、startTime+间隔、…、≤ endTime，含 endTime 端点），
// 返回第一个不早于 atTime 的触发点；跨天/跳过节假日由外层循环处理。
// 每次都重新对格，错过（如睡眠唤醒）不会拖累后续序列。
function calcNextIntervalAligned(r, atTime) {
  const intervalMs = r.interval * 60 * 1000
  const base = new Date(atTime)

  for (let i = 0; i <= 40; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i)
    if (!matchDayFilter(d, r.dayFilter)) continue

    const daySchedules = r.schedules.filter(s => s.weekday === d.getDay()).sort((a, b) => a.startTime.localeCompare(b.startTime))
    for (const s of daySchedules) {
      const sp = s.startTime.split(':')
      const ep = s.endTime.split(':')
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Number(sp[0]), Number(sp[1]), 0, 0).getTime()
      const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Number(ep[0]), Number(ep[1]), 0, 0).getTime()
      for (let t = start; t <= end; t += intervalMs) {
        if (t >= atTime) return t
      }
    }
  }
  return null
}

const TYPE_LABELS = { daily: '每日提醒', interval: '间隔提醒', once: '定时提醒' }

function formatTime(ts) {
  const d = new Date(ts)
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
}

// 下次触发时间的人类可读格式：今天/明天带日期词，更远的日子带月-日
function formatNextTime(ts) {
  const d = new Date(ts)
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.round((dayStart.getTime() - todayStart.getTime()) / 86400000)
  const datePart = diffDays === 0 ? '今天' : diffDays === 1 ? '明天' : pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
  return datePart + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

// ==================== 调度器 ====================
let schedulerTimer = null
let scheduledTime = null
// 连续算出「下次触发时间仍在过去」的次数：第一次立即补触发（启动时已过期的一次性提醒），
// 之后按退避间隔重试，避免异常数据把渲染进程拖进 0 延迟死循环
let overdueStreak = 0

function calcNextTick(reminders) {
  let next = null
  for (const r of reminders) {
    const t = getNextTriggerTime(r, Date.now())
    if (t !== null && (next === null || t < next)) {
      next = t
    }
  }
  return next
}

// 重排下一次触发。minDelay 用于「刚触发完」的场景，
// 保证异常数据下也不会出现 0 延迟的自我循环
function scheduleNext(minDelay) {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer)
    schedulerTimer = null
  }
  scheduledTime = null

  let next = null
  try {
    next = calcNextTick(readReminders())
  } catch (e) {
    // 计算异常等同于「暂时没有待触发项」，交给看门狗下一轮重试
    console.error('[easyremind] scheduleNext calc error:', e)
  }
  if (next === null) {
    overdueStreak = 0
    return
  }

  scheduledTime = next
  const rawDelay = next - Date.now()
  let delay
  if (rawDelay < 0) {
    delay = Math.max(minDelay || 0, overdueStreak === 0 ? 0 : ERROR_BACKOFF_MS)
    overdueStreak++
  } else {
    delay = Math.max(minDelay || 0, rawDelay)
    overdueStreak = 0
  }
  schedulerTimer = setTimeout(() => {
    // 先摘掉句柄：万一 triggerDue 抛错，看门狗才能识别出「定时器已不在」并补设
    schedulerTimer = null
    // triggerDue 里的存储写入、系统通知都可能抛错，
    // 但重排必须执行，否则一次异常就会让整条调度链永久停摆
    let errored = false
    try {
      triggerDue()
    } catch (e) {
      errored = true
      console.error('[easyremind] triggerDue error:', e)
      addLog('[异常] 触发处理失败，' + Math.round(ERROR_BACKOFF_MS / 1000) + 's 后重试：' + ((e && e.message) || String(e)))
    } finally {
      scheduleNext(errored ? ERROR_BACKOFF_MS : MIN_REARM_DELAY_MS)
    }
  }, delay)
}

function triggerDue() {
  if (scheduledTime === null) return
  const target = scheduledTime
  const now = Date.now()

  // 定时器提前唤醒（系统时钟被回拨、休眠唤醒后的时间补偿）不能当作「到点」：
  // 直接跳过这一轮，调用方（定时器回调的 finally）会按剩余时间重新等待。
  // 否则会在同一计划时刻先触发一次、重排后再触发一次，变成重复提醒
  if (now < target - TRIGGER_MATCH_WINDOW_MS) {
    addLog('[自愈] 定时器提前唤醒，重新等待 · ' + formatTime(target) + '（早 ' + Math.round((target - now) / 1000) + 's）', {
      scheduledTime: formatTime(target),
      earlyByMs: target - now
    })
    return
  }

  const reminders = readReminders()

  for (const r of reminders) {
    if (!r.enabled) continue
    const t = getNextTriggerTime(r, target)
    if (t !== null && Math.abs(t - target) < TRIGGER_MATCH_WINDOW_MS) {
      // 单条提醒出错不影响同一时刻的其他提醒
      try {
        doTrigger(r, target)
      } catch (e) {
        console.error('[easyremind] doTrigger error:', r.id, e)
        addLog('[异常] 「' + (r.title || r.id) + '」触发失败：' + ((e && e.message) || String(e)), { id: r.id })
      }
    }
  }
}

// 已经发过通知的 once 提醒：状态写库失败时防止每轮重排都重复通知
const firedOnceIds = new Set()

function doTrigger(reminder, scheduled) {
  const now = Date.now()
  const reminders = readReminders()
  const target = reminders.find(r => r.id === reminder.id)
  if (!target) return

  // 同一计划时刻只触发一次：时钟回拨、定时器提前唤醒、多个插件视图各跑一份调度器，
  // 都可能让同一时刻再次进到这里。命中 lastFiredSlot 就跳过通知
  if (target.lastFiredSlot === scheduled) {
    addLog('[去重] 「' + target.title + '」已触发过该时刻，跳过重复通知 · ' + formatTime(scheduled), {
      id: target.id,
      scheduledTime: formatTime(scheduled)
    })
    return
  }

  if (target.type === 'once') {
    if (firedOnceIds.has(target.id)) {
      // 已通知过，不再重复发；但仍要重试把「已触发」状态落库，
      // 否则这条过期数据会一直占住 calcNextTick 的最小值，饿死其他提醒
      if (target.enabled || target.lastTriggered === 0) {
        target.enabled = false
        target.lastTriggered = now
        try {
          writeReminders(reminders)
        } catch (e) {
          console.error('[easyremind] writeReminders retry error:', e)
        }
      }
      return
    }
    firedOnceIds.add(target.id)
    target.enabled = false
  }
  target.lastTriggered = now
  target.lastFiredSlot = scheduled
  try {
    writeReminders(reminders)
  } catch (e) {
    // 状态没写进去也要把提醒发出去，漏提醒比重复提醒更糟；
    // 下一轮重排会再试一次写入
    console.error('[easyremind] writeReminders error:', e)
    addLog('[异常] 「' + target.title + '」触发状态保存失败：' + ((e && e.message) || String(e)), { id: target.id })
  }

  const drift = now - scheduled
  addLog('[触发] ' + target.title + ' · ' + formatTime(scheduled) + (drift ? '（偏差 ' + (drift > 0 ? '+' : '') + drift + 'ms）' : '（准点）'), {
    id: target.id,
    type: target.type,
    scheduledTime: formatTime(scheduled),
    actualTime: formatTime(now)
  })

  // 发送系统通知：标题=任务名，内容=描述
  try {
    const notif = new Notification(target.title, {
      body: target.content || '提醒时间到了',
      requireInteraction: true
    })
    // 点击通知回到插件
    notif.onclick = function () {
      notif.close()
    }
  } catch (e) {
    // 降级：ztools 通知（只支持单字符串）
    if (window.ztools && window.ztools.showNotification) {
      window.ztools.showNotification(target.title + ': ' + (target.content || '提醒时间到了'))
    }
  }
}

// ==================== 启动与自愈 ====================
// ZTools 只在创建插件视图时才执行 preload.js：要么用户打开插件，
// 要么勾选「插件设置 → 跟随主程序同时启动运行」后由主程序在启动时后台预加载。
// 所以这里不能假设「模块加载即一切就绪」：宿主 API 可能尚未注入、
// 存储可能瞬时读失败、提醒数据可能稍后才落库。一次性排程只要读空一次
// 就会永久停摆，因此启动走显式 init + 快速重试，长期由看门狗兜底。
let schedulerReady = false
let watchdogTimer = null
let lastHolidayCheckAt = 0
const hostReadyAtLoad = hostReady()

function hostReady() {
  const z = window.ztools
  return !!(z && z.dbStorage && typeof z.dbStorage.getItem === 'function')
}

function init() {
  if (schedulerReady) return true
  if (!hostReady()) return false

  schedulerReady = true
  scheduleNext()
  startWatchdog()
  logSchedulerStart()
  // 节假日数据：异步拉取，成功后内部会重算调度，不阻塞启动
  ensureHolidayData(false).catch(() => {})
  return true
}

function logSchedulerStart() {
  const list = readReminders()
  const enabled = list.filter(r => r.enabled).length
  const suffix = scheduledTime
    ? ' · 下次触发 ' + formatNextTime(scheduledTime)
    : storageReadFailed
      ? ' · 存储读取失败，稍后自动重试'
      : ' · 暂无待触发项'
  addLog('[启动] 调度器已就绪 · 提醒 ' + list.length + ' 条（启用 ' + enabled + '）' + suffix, {
    hostReadyAtLoad,
    total: list.length,
    enabled,
    nextTriggerAt: scheduledTime || undefined
  })
}

// 宿主 API 还没注入时快速重试；重试窗口用尽后交给看门狗长期兜底
function requestInit(triesLeft) {
  if (init()) return
  if (triesLeft > 0) {
    setTimeout(() => requestInit(triesLeft - 1), INIT_RETRY_MS)
    return
  }
  startWatchdog()
}

function startWatchdog() {
  if (watchdogTimer) return
  watchdogTimer = setInterval(watchdogTick, WATCHDOG_INTERVAL_MS)
}

function watchdogTick() {
  try {
    if (!schedulerReady) {
      init()
      return
    }
    if (!hostReady()) return

    const now = Date.now()

    // 1. 定时器不在：上次排程读到空数据、触发链被打断、或视图被冻结后丢弃
    if (!schedulerTimer) {
      const list = readReminders()
      // 读失败 ≠ 没有提醒：等下一轮巡检，别把瞬时故障当成「无待触发项」
      if (!storageReadFailed && calcNextTick(list) !== null) {
        scheduleNext()
        if (scheduledTime !== null) {
          addLog('[自愈] 调度器已停摆，重新排程 · 下次触发 ' + formatNextTime(scheduledTime), { nextTriggerAt: scheduledTime })
        }
      }
      checkHolidayData(now)
      return
    }

    // 2. 排程时间已过却还没触发：定时器丢失、睡眠/休眠唤醒、系统时间跳变。
    //    渲染进程单线程，这里补发后再 scheduleNext（内部会 clearTimeout）
    //    就不会和原定时器重复触发
    if (scheduledTime !== null && scheduledTime <= now) {
      const missedBy = now - scheduledTime
      if (missedBy <= MISSED_FIRE_GRACE_MS) {
        addLog('[自愈] 补发错过的触发（迟到 ' + Math.round(missedBy / 1000) + 's）· ' + formatTime(scheduledTime), {
          scheduledTime: formatTime(scheduledTime),
          missedByMs: missedBy
        })
        triggerDue()
      } else {
        addLog('[自愈] 触发已过期 ' + Math.round(missedBy / 60000) + ' 分钟，跳过补发并重新排程', {
          scheduledTime: formatTime(scheduledTime),
          missedByMs: missedBy
        })
      }
      scheduleNext()
      checkHolidayData(now)
      return
    }

    // 3. 数据被外部改动（另一个插件窗口、上一次读取失败后恢复）→ 重新对齐
    const list = readReminders()
    if (storageReadFailed) {
      checkHolidayData(now)
      return
    }
    const next = calcNextTick(list)
    const mismatch = next === null ? scheduledTime !== null : scheduledTime === null || Math.abs(next - scheduledTime) > TRIGGER_MATCH_WINDOW_MS
    if (mismatch) scheduleNext()

    checkHolidayData(now)
  } catch (e) {
    // 巡检自身绝不能把调度带崩
    console.error('[easyremind] watchdog error:', e)
  }
}

// 后台常驻时插件视图不会重建，节假日数据靠这里按小时自检补全（跨年、次年数据公布）
function checkHolidayData(now) {
  if (now - lastHolidayCheckAt < HOLIDAY_RECHECK_MS) return
  lastHolidayCheckAt = now
  if (!holidayNeedFetch(getHolidayCache()).need) return
  ensureHolidayData(false).catch(() => {})
}

// ==================== 批量操作 ====================
// 批量启停：已是目标状态的任务跳过，返回是否发生变化
function applyEnabledByIds(ids, enabled, groupId) {
  const idSet = new Set(ids)
  const reminders = readReminders()
  let changed = false
  for (const r of reminders) {
    if (!idSet.has(r.id) || r.enabled === enabled) continue
    r.enabled = enabled
    changed = true
    if (enabled) {
      const next = getNextTriggerTime(r, Date.now())
      addLog('[启用] ' + r.title + (next ? ' · 下次触发 ' + formatNextTime(next) : ' · 当前不会触发'), {
        id: r.id,
        groupId,
        nextTriggerAt: next || undefined
      })
    } else {
      addLog('[停用] ' + r.title, { id: r.id, groupId })
    }
  }
  if (changed) {
    writeReminders(reminders)
    scheduleNext()
  }
  return changed
}

// groupId 为空表示移出分组；分组不存在时不做任何修改
function applyAssignGroup(ids, groupId) {
  const groups = readGroups()
  const group = groupId ? groups.find(g => g.id === groupId) : null
  if (groupId && !group) return false

  const idSet = new Set(ids)
  const reminders = readReminders()
  let order = maxOrderInBucket(reminders, groupId || '')
  let changed = false
  for (const r of reminders) {
    if (!idSet.has(r.id)) continue
    if (groupId) {
      if (r.groupId === groupId) continue
      r.groupId = groupId
      r.order = ++order
      addLog('[移入组] ' + r.title + ' → ' + group.name, { id: r.id, groupId })
    } else {
      if (!r.groupId) continue
      delete r.groupId
      r.order = ++order
      addLog('[移出组] ' + r.title, { id: r.id })
    }
    changed = true
  }
  if (changed) writeReminders(reminders)
  return changed
}

function applyDeleteByIds(ids) {
  const idSet = new Set(ids)
  const reminders = readReminders()
  const removed = reminders.filter(r => idSet.has(r.id))
  if (!removed.length) return false

  writeReminders(reminders.filter(r => !idSet.has(r.id)))
  for (const r of removed) addLog('[删除] ' + r.title, { id: r.id })
  scheduleNext()
  return true
}

// ==================== 暴露服务 ====================
window.services = {
  // ===== 提醒数据 CRUD =====
  getReminders() {
    return readReminders()
  },

  getGroups() {
    return readGroups()
  },

  // 按名称复用已有分组，不存在则新建（表单里直接输入组名）
  addGroup(name) {
    return ensureGroupByName(name)
  },

  addReminder(formData) {
    const reminders = readReminders()
    const bucketKey = formData.groupId || ''
    const reminder = {
      id: generateId(),
      title: formData.title,
      content: formData.content || '',
      type: formData.type,
      schedules: formData.schedules || [],
      interval: formData.interval || 60,
      align: formData.align === 'start' ? 'start' : 'create',
      triggerAt: formData.triggerAt,
      weekdays: formData.weekdays,
      triggerTime: formData.triggerTime,
      dayFilter: formData.dayFilter || 'all',
      groupId: formData.groupId || undefined,
      order: maxOrderInBucket(reminders, bucketKey) + 1,
      enabled: true,
      lastTriggered: 0,
      lastFiredSlot: 0,
      createdAt: Date.now()
    }
    reminders.push(reminder)
    writeReminders(reminders)
    const next = getNextTriggerTime(reminder, Date.now())
    addLog('[新建] ' + reminder.title + ' · ' + TYPE_LABELS[reminder.type] + (next ? ' · 下次触发 ' + formatNextTime(next) : ' · 当前不会触发'), {
      id: reminder.id,
      type: reminder.type,
      nextTriggerAt: next || undefined
    })
    scheduleNext()
    return reminder
  },

  updateReminder(id, formData) {
    const reminders = readReminders()
    const index = reminders.findIndex(r => r.id === id)
    if (index === -1) return false

    const prevBucket = reminders[index].groupId || ''
    const nextGroupId = formData.groupId || undefined
    const nextBucket = nextGroupId || ''
    // 换了分组就排到新分组最前面；同组内编辑保持原排序
    const order = prevBucket === nextBucket
      ? reminders[index].order
      : maxOrderInBucket(reminders, nextBucket) + 1

    reminders[index] = {
      ...reminders[index],
      title: formData.title,
      content: formData.content || '',
      type: formData.type,
      schedules: formData.schedules || [],
      interval: formData.interval || 60,
      align: formData.align === 'start' ? 'start' : 'create',
      triggerAt: formData.triggerAt,
      weekdays: formData.weekdays,
      triggerTime: formData.triggerTime,
      dayFilter: formData.dayFilter || 'all',
      groupId: nextGroupId,
      order,
      // 改了调度参数，旧的「已触发时刻」不能再挡住重新算出来的同一时刻
      lastFiredSlot: 0
    }
    writeReminders(reminders)
    const next = getNextTriggerTime(reminders[index], Date.now())
    addLog('[修改] ' + reminders[index].title + ' · ' + TYPE_LABELS[formData.type] + (next ? ' · 下次触发 ' + formatNextTime(next) : ' · 当前不会触发'), {
      id,
      type: formData.type,
      nextTriggerAt: next || undefined
    })
    scheduleNext()
    return true
  },

  deleteReminder(id) {
    const reminders = readReminders()
    const deleted = reminders.find(r => r.id === id)
    const filtered = reminders.filter(r => r.id !== id)
    if (filtered.length < reminders.length) {
      writeReminders(filtered)
      addLog('[删除] ' + (deleted ? deleted.title : id), { id })
      scheduleNext()
      return true
    }
    return false
  },

  toggleReminder(id) {
    const reminders = readReminders()
    const reminder = reminders.find(r => r.id === id)
    if (!reminder) return false

    reminder.enabled = !reminder.enabled
    writeReminders(reminders)
    if (reminder.enabled) {
      const next = getNextTriggerTime(reminder, Date.now())
      addLog('[启用] ' + reminder.title + (next ? ' · 下次触发 ' + formatNextTime(next) : ' · 当前不会触发'), { id, nextTriggerAt: next || undefined })
    } else {
      addLog('[停用] ' + reminder.title, { id })
    }
    scheduleNext()
    return true
  },

  // 复制提醒：配置与启用状态保持不变，重置触发记录作为一条全新任务
  copyReminder(id) {
    const reminders = readReminders()
    const src = reminders.find(r => r.id === id)
    if (!src) return null

    const copy = JSON.parse(JSON.stringify(src))
    copy.id = generateId()
    copy.title = (src.title + '（副本）').slice(0, 50)
    copy.createdAt = Date.now()
    copy.order = maxOrderInBucket(reminders, src.groupId || '') + 1
    copy.lastTriggered = 0
    copy.lastFiredSlot = 0
    reminders.push(copy)
    writeReminders(reminders)

    const next = getNextTriggerTime(copy, Date.now())
    addLog('[复制] ' + copy.title + ' · ' + TYPE_LABELS[copy.type] + (next ? ' · 下次触发 ' + formatNextTime(next) : ' · 当前不会触发'), {
      id: copy.id,
      from: src.id,
      type: copy.type,
      nextTriggerAt: next || undefined
    })
    scheduleNext()
    return copy
  },

  // ===== 分组操作 =====
  // 批量启停组内任务
  setGroupEnabled(groupId, enabled) {
    const group = readGroups().find(g => g.id === groupId)
    if (!group) return false
    const ids = readReminders().filter(r => r.groupId === groupId).map(r => r.id)
    applyEnabledByIds(ids, enabled, groupId)
    return true
  },

  // 解散分组：只移除分组本身，组内任务保留为未分组
  dissolveGroup(groupId) {
    const groups = readGroups()
    const group = groups.find(g => g.id === groupId)
    if (!group) return false

    writeGroups(groups.filter(g => g.id !== groupId))
    const reminders = readReminders()
    // 原未分组任务的 order 不与解散出来的任务冲突，解散出来的追加到末尾
    let order = maxOrderInBucket(reminders, '')
    let touched = false
    for (const r of reminders) {
      if (r.groupId !== groupId) continue
      delete r.groupId
      r.order = ++order
      touched = true
    }
    if (touched) writeReminders(reminders)
    addLog('[解散组] ' + group.name)
    return true
  },

  // 删除分组：连同组内任务一起删除
  deleteGroup(groupId) {
    const groups = readGroups()
    const group = groups.find(g => g.id === groupId)
    if (!group) return false

    writeGroups(groups.filter(g => g.id !== groupId))
    addLog('[删除组] ' + group.name)
    applyDeleteByIds(readReminders().filter(r => r.groupId === groupId).map(r => r.id))
    return true
  },

  // ===== 批量任务操作 =====
  assignGroup(ids, groupId) {
    return applyAssignGroup(ids, groupId || '')
  },

  setRemindersEnabled(ids, enabled) {
    applyEnabledByIds(ids, enabled)
    return true
  },

  deleteReminders(ids) {
    return applyDeleteByIds(ids)
  },

  // ===== 排序 =====
  // 分组拖拽排序：ids 为拖拽后的完整顺序
  reorderGroups(ids) {
    const groups = readGroups()
    const orderMap = new Map(ids.map((id, i) => [id, i]))
    let changed = false
    for (const g of groups) {
      const order = orderMap.get(g.id)
      if (order === undefined || g.order === order) continue
      g.order = order
      changed = true
    }
    if (changed) writeGroups(groups)
    return true
  },

  // 任务拖拽排序/换组：items = [{ id, groupId, order }]，只更新传入的任务
  updateReminderOrder(items) {
    if (!Array.isArray(items) || !items.length) return false
    const groups = readGroups()
    const groupName = (gid) => {
      const g = groups.find(x => x.id === gid)
      return g ? g.name : gid
    }
    const itemMap = new Map(items.map(it => [it.id, it]))
    const reminders = readReminders()
    let changed = false
    for (const r of reminders) {
      const it = itemMap.get(r.id)
      if (!it) continue
      if (it.groupId) {
        if (r.groupId !== it.groupId) {
          r.groupId = it.groupId
          addLog('[移入组] ' + r.title + ' → ' + groupName(it.groupId), { id: r.id, groupId: it.groupId })
          changed = true
        }
      } else if (r.groupId) {
        delete r.groupId
        addLog('[移出组] ' + r.title, { id: r.id })
        changed = true
      }
      if (typeof it.order === 'number' && r.order !== it.order) {
        r.order = it.order
        changed = true
      }
    }
    if (changed) writeReminders(reminders)
    return true
  },

  // ===== 调度器控制 =====
  // 渲染层不参与调度，只在进入插件时请求一次重排（睡眠唤醒/长时间后台后立刻对齐）
  refreshScheduler() {
    scheduleNext()
  },

  // 调度状态（供 UI 展示，只读）
  getSchedulerState() {
    return {
      ready: schedulerReady,
      nextTriggerText: scheduledTime ? formatNextTime(scheduledTime) : ''
    }
  },

  // ===== 法定节假日数据 =====
  getHolidayStatus() {
    const cache = readHolidayCache()
    const years = cache && cache.years ? Object.keys(cache.years).map(Number).sort((a, b) => a - b) : []
    return {
      years,
      updatedAt: cache ? cache.updatedAt || 0 : 0,
      refreshing: holidayUpdating
    }
  },

  // 强制重新拉取（resolve 后可调 getHolidayStatus 读取最新状态）
  refreshHolidayData() {
    return ensureHolidayData(true)
  },

  // ===== 日志 =====
  getLogs() {
    return readLogs()
  },

  clearLogs() {
    window.ztools.dbStorage.setItem(LOG_KEY, JSON.stringify([]))
  }
}

// ==================== 启动调度 ====================
// 插件视图一被创建（用户打开插件，或主程序自启时后台预加载）就把内部任务调度起来。
// 宿主 API 未就绪时快速重试，重试窗口用尽后由看门狗长期兜底。
requestInit(INIT_FAST_TRIES)
