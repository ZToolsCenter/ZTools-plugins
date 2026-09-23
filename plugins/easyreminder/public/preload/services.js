const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')

const STORAGE_KEY = 'easyremind_reminders'
const LOG_KEY = 'easyremind_logs'
const HOLIDAY_KEY = 'easyremind_holidays'
const HOLIDAY_API = 'https://timor.tech/api/holiday/year/'
const HOLIDAY_TIMEOUT_MS = 5000
const HOLIDAY_NEXT_YEAR_MONTH = 11 // 12 月起（getMonth()=11）进插件时顺带补次年数据

// ==================== 工具函数 ====================
function pad2(n) {
  return String(n).padStart(2, '0')
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
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
    const now = new Date()
    const time = pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds()) + '.' + String(now.getMilliseconds()).padStart(3, '0')
    logs.unshift({ id: logId++, time, message, detail: detail || {} })
    if (logs.length > 100) logs.length = 100
    writeLogs(logs)
  } catch (e) {}
}

// ==================== 提醒数据 ====================
function readReminders() {
  try {
    const data = window.ztools.dbStorage.getItem(STORAGE_KEY)
    if (!data) return []
    const raw = typeof data === 'string' ? JSON.parse(data) : data
    return Array.isArray(raw) ? raw : []
  } catch (e) {
    console.error('[easyremind] readReminders error:', e)
    return []
  }
}

function writeReminders(list) {
  window.ztools.dbStorage.setItem(STORAGE_KEY, JSON.stringify(list))
}

// ==================== 法定节假日数据 ====================
// 数据源 timor.tech/api/holiday，holiday=true 放假 / false 补班（调休上班）
// 缓存结构: { years: { "2026": { "01-01": {h:0|1, n:"元旦"} } }, updatedAt: ts }

let holidayCache = readHolidayCache()
let holidayUpdating = false

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
  const ym = holidayCache && holidayCache.years && holidayCache.years[d.getFullYear()]
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

function formatTime(ts) {
  const d = new Date(ts)
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
}

// ==================== 调度器 ====================
let schedulerTimer = null
let scheduledTime = null

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

function scheduleNext() {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer)
    schedulerTimer = null
  }

  const next = calcNextTick(readReminders())
  if (next === null) {
    scheduledTime = null
    return
  }

  scheduledTime = next
  const delay = Math.max(0, next - Date.now())
  addLog('[调度] 定时器: ' + delay + 'ms 后触发 (' + formatTime(next) + ')', { nextTime: formatTime(next), delay })
  schedulerTimer = setTimeout(() => {
    triggerDue()
    scheduleNext()
  }, delay)
}

function triggerDue() {
  if (scheduledTime === null) return
  const target = scheduledTime
  const reminders = readReminders()

  for (const r of reminders) {
    if (!r.enabled) continue
    const t = getNextTriggerTime(r, target)
    if (t !== null && Math.abs(t - target) < 1000) {
      doTrigger(r, target)
    }
  }
}

function doTrigger(reminder, scheduled) {
  const now = Date.now()
  const reminders = readReminders()
  const target = reminders.find(r => r.id === reminder.id)
  if (!target) return

  target.lastTriggered = now
  if (target.type === 'once') {
    target.enabled = false
  }
  writeReminders(reminders)

  addLog('[触发] ' + target.title + ' 计划=' + formatTime(scheduled) + ' 实际=' + formatTime(now) + ' 偏差=' + (now - scheduled) + 'ms', {
    type: target.type,
    scheduledTime: formatTime(scheduled),
    actualTime: formatTime(now),
    drift: (now - scheduled) + 'ms',
    interval: target.interval,
    lastTriggered: target.lastTriggered > 0 ? formatTime(target.lastTriggered) : '从未',
    triggerAt: target.triggerAt ? formatTime(target.triggerAt) : undefined
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

// ==================== 暴露服务 ====================
window.services = {
  // 读文件
  readFile(file) {
    try {
      return fs.readFileSync(file, { encoding: 'utf-8' })
    } catch {
      return ''
    }
  },
  // 文本写入到下载目录
  writeTextFile(text) {
    const filePath = path.join(window.ztools.getPath('downloads'), Date.now().toString() + '.txt')
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },
  // 图片写入到下载目录
  writeImageFile(base64Url) {
    const matches = /^data:image\/([a-z]{1,20});base64,/i.exec(base64Url)
    if (!matches) return
    const filePath = path.join(
      window.ztools.getPath('downloads'),
      Date.now().toString() + '.' + matches[1]
    )
    fs.writeFileSync(filePath, base64Url.substring(matches[0].length), { encoding: 'base64' })
    return filePath
  },
  // 自定义标题的通知
  notify(title, body) {
    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'granted') {
      new Notification(title, { body })
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(perm => {
        if (perm === 'granted') new Notification(title, { body })
      })
    }
  },
  sendNotification(title, body) {
    if (window.ztools && window.ztools.showNotification) {
      window.ztools.showNotification(title + ': ' + body)
    } else {
      this.notify(title, body)
    }
  },

  // ===== 提醒数据 CRUD =====
  getReminders() {
    return readReminders()
  },

  addReminder(formData) {
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
      enabled: true,
      lastTriggered: 0,
      createdAt: Date.now()
    }
    const reminders = readReminders()
    reminders.push(reminder)
    writeReminders(reminders)
    addLog('[新建] ' + reminder.title + ' 类型=' + reminder.type, {
      id: reminder.id,
      type: reminder.type,
      interval: reminder.interval,
      triggerAt: reminder.triggerAt ? new Date(reminder.triggerAt).toLocaleString() : undefined,
      weekdays: reminder.weekdays,
      triggerTime: reminder.triggerTime,
      schedules: reminder.schedules
    })
    scheduleNext()
    return reminder
  },

  updateReminder(id, formData) {
    const reminders = readReminders()
    const index = reminders.findIndex(r => r.id === id)
    if (index === -1) return false

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
      dayFilter: formData.dayFilter || 'all'
    }
    writeReminders(reminders)
    addLog('[更新] ' + reminders[index].title, { id, type: formData.type, dayFilter: reminders[index].dayFilter })
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
    addLog('[' + (reminder.enabled ? '启用' : '禁用') + '] ' + reminder.title, { id })
    scheduleNext()
    return true
  },

  // ===== 调度器控制 =====
  refreshScheduler() {
    scheduleNext()
  },

  stopScheduler() {
    if (schedulerTimer) {
      clearTimeout(schedulerTimer)
      schedulerTimer = null
    }
    scheduledTime = null
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

  addLog(message, detail) {
    addLog(message, detail)
  },

  clearLogs() {
    window.ztools.dbStorage.setItem(LOG_KEY, JSON.stringify([]))
  }
}

// ==================== 启动调度 ====================
scheduleNext()

// 节假日数据：异步拉取，成功后内部会重算调度，不阻塞启动
ensureHolidayData(false).catch(() => {})
