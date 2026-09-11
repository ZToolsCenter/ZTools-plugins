const fs = require('node:fs')
const path = require('node:path')

const STORAGE_KEY = 'easyremind_reminders'
const LOG_KEY = 'easyremind_logs'

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
      return calcNextDailyTime(r.weekdays, r.triggerTime, atTime)
    }
    case 'interval': {
      if (!r.schedules || !r.schedules.length) return null
      return calcNextIntervalTime(r, atTime)
    }
    default:
      return null
  }
}

function calcNextDailyTime(weekdays, triggerTime, atTime) {
  const parts = (triggerTime || '').split(':')
  if (parts.length < 2) return null
  const h = Number(parts[0])
  const m = Number(parts[1])
  const today = new Date(atTime)
  const todayTrigger = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m, 0, 0)

  if (weekdays.includes(today.getDay()) && todayTrigger.getTime() >= atTime) {
    return todayTrigger.getTime()
  }

  for (let i = 1; i <= 7; i++) {
    const next = new Date(today)
    next.setDate(next.getDate() + i)
    if (weekdays.includes(next.getDay())) {
      next.setHours(h, m, 0, 0)
      return next.getTime()
    }
  }
  return atTime + 7 * 86400000
}

function calcNextIntervalTime(r, atTime) {
  const intervalMs = r.interval * 60 * 1000
  const anchor = r.lastTriggered > 0 ? r.lastTriggered : (r.createdAt || atTime)
  const elapsed = atTime - anchor
  const periods = Math.max(1, Math.ceil(elapsed / intervalMs))
  let current = anchor + periods * intervalMs

  const schedules = r.schedules
  if (!schedules.length) return null

  for (let attempt = 0; attempt < 14; attempt++) {
    const d = new Date(current)
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
      triggerAt: formData.triggerAt,
      weekdays: formData.weekdays,
      triggerTime: formData.triggerTime,
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
      triggerAt: formData.triggerAt,
      weekdays: formData.weekdays,
      triggerTime: formData.triggerTime
    }
    writeReminders(reminders)
    addLog('[更新] ' + reminders[index].title, { id, type: formData.type })
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
