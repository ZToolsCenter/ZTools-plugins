// public/preload/services.js
const fs = require('node:fs')
const path = require('node:path')

// 将 Date 格式化为本地时区的 YYYY-MM-DD 字符串
// （避免 toISOString 在 UTC+8 凌晨 0-8 点把日期算成昨天，导致今日打卡记录存到错误日期）
function formatLocalDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 存储文件路径
const getStoragePath = (key) => {
  const userDataPath = window.ztools.getPath('userData')
  return path.join(userDataPath, `tiga_${key}.json`)
}

// 弹窗实例存储（用于单例化）
let exerciseWindowInstance = null

window.services = {
  // ===== 定时器管理 =====
  timerId: null,

  startTimer(intervalMinutes) {
    if (this.timerId) {
      clearInterval(this.timerId)
    }
    this.timerId = setInterval(() => {
      this._onTimerTick()
    }, intervalMinutes * 60 * 1000)
  },

  stopTimer() {
    if (this.timerId) {
      clearInterval(this.timerId)
      this.timerId = null
    }
  },

  _onTimerTick() {
    const config = this.getItem('tiga_config')
    if (!config || !config.enabled) return

    if (!this.isInWorkTime(config.workTime, config.workTimeMode)) return

    if (config.reminderMode === 'notify+popup') {
      // 通知+弹窗模式：发系统通知，点击后弹窗
      const texts = this._getNotificationTexts(config)
      const text = texts[Math.floor(Math.random() * texts.length)]
      this.sendNotification(text.title, text.body, () => {
        this._showExercisePopup()
      })
    } else {
      // 仅通知模式：直接弹窗
      this._showExercisePopup()
    }

    if (config.countMode === 'auto') {
      this.addRecord()
    }
  },

  // 显示运动引导弹窗
  _showExercisePopup() {
    this._closeAndClearExerciseWindow()

    const display = window.ztools.getPrimaryDisplay()
    const { width, height } = display.workAreaSize
    const windowWidth = 140
    const windowHeight = 120
    const padding = 20

    exerciseWindowInstance = window.ztools.createBrowserWindow(
      'exercise-guide.html',
      {
        width: windowWidth,
        height: windowHeight,
        x: width - windowWidth - padding,
        y: height - windowHeight - padding,
        frame: false,
        alwaysOnTop: true,
        resizable: false,
        fullscreenable: false,
        transparent: false,
        backgroundColor: '#1a1a1a',
        hasShadow: true,
        skipTaskbar: true,
      },
      () => {
        if (exerciseWindowInstance) {
          exerciseWindowInstance.setSize(windowWidth, windowHeight)
        }
      }
    )
  },

  // 获取通知文案
  _getNotificationTexts(config) {
    const normalTexts = config.normalTexts || [
      { title: '提肛提醒', body: '久坐伤身，该做提肛运动了，关爱您的盆底健康。' },
      { title: '健康时刻', body: '收缩盆底肌，保持5秒，放松5秒，关爱久坐族健康。' },
      { title: '运动提醒', body: '定时提肛运动，预防痔疮，改善盆底功能。' }
    ]

    const funnyTexts = config.funnyTexts || [
      { title: '盆底肌呼叫中心', body: '您的盆底肌已欠费停机，请立即充值（提肛）恢复服务！' },
      { title: '提肛小助手', body: '别坐了别坐了，屁股要废了！起来动一动，提肛保健康！' },
      { title: '健康警报', body: '警告：您的臀部已连续静止太久，建议立即启动提肛程序！' },
      { title: '提肛时间到', body: '收缩、放松，让盆底肌跳起健康的舞蹈！' },
      { title: '盆底健康守护', body: '提肛一分钟，健康一整天！现在就开始吧～' },
      { title: '久坐预警', body: '您的屁股正在酝酿抗议，请立即安抚（提肛）！' },
      { title: '提肛大使', body: '来自未来的你发来消息：感谢现在坚持提肛的我！' },
      { title: '健康投递', body: '叮咚！您的盆底健康快递已送达，请签收（提肛）！' },
      { title: '提肛站', body: '下一站：提肛站。请各位乘客做好准备，收缩放松！' },
      { title: '盆底健身房', body: '您有一张免费的盆底健身券，有效期：现在！' }
    ]

    if (config.style === 'normal') return normalTexts
    if (config.style === 'funny') return funnyTexts
    return [...normalTexts, ...funnyTexts]
  },

  // 增加打卡记录（统一入口，供 Vue 层和弹窗调用）
  addRecord() {
    const now = new Date()
    const today = formatLocalDate(now)
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
    const stats = this.getItem('tiga_stats') || { records: [] }
    // 防御性检查：兼容存储损坏或旧版本数据格式
    if (!Array.isArray(stats.records)) stats.records = []

    const todayRecord = stats.records.find(r => r.date === today)
    if (todayRecord) {
      todayRecord.count++
      if (!todayRecord.times) todayRecord.times = []
      todayRecord.times.push(time)
    } else {
      stats.records.push({ date: today, count: 1, times: [time] })
    }

    this.setItem('tiga_stats', stats)
  },

  // ===== 工作时段判断 =====
  isInWorkTime(workTimeConfig, workTimeMode) {
    const now = new Date()
    const currentHour = now.getHours()
    const currentMinute = now.getMinutes()
    const currentTimeStr = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`
    const currentDay = now.getDay()  // 0-6, 0=周日

    const isInRange = (start, end) => {
      return currentTimeStr >= start && currentTimeStr <= end
    }

    if (workTimeMode === 'single') {
      return isInRange(workTimeConfig.single.start, workTimeConfig.single.end)
    }

    if (workTimeMode === 'multi') {
      return workTimeConfig.multi.some(period =>
        isInRange(period.start, period.end)
      )
    }

    if (workTimeMode === 'weekly') {
      const dayConfig = workTimeConfig.weekly[currentDay]
      if (!dayConfig) return false  // 该天未配置或为 null
      return isInRange(dayConfig.start, dayConfig.end)
    }

    return false
  },

  // ===== 桌面通知 =====
  // 优先使用 ZTools 平台 API（showNotification），
  // 仅在需要点击回调（notify+popup 模式）时使用 Web Notification API
  sendNotification(title, body, onClick) {
    if (onClick && typeof Notification !== 'undefined') {
      // 需要点击回调：使用 Web Notification API（支持 onclick）
      try {
        const notification = new Notification(title, {
          body: body,
          requireInteraction: true
        })

        notification.onclick = () => {
          onClick()
          notification.close()
        }
        return
      } catch (e) {
        console.warn('Web Notification 不可用，降级到 ztools.showNotification')
      }
    }

    // 无需点击回调或 Web Notification 不可用：使用 ZTools 平台 API
    if (window.ztools && window.ztools.showNotification) {
      window.ztools.showNotification(`${title}: ${body}`)
    }
  },

  // 强制关闭并清空运动弹窗引用
  _closeAndClearExerciseWindow() {
    if (!exerciseWindowInstance) return

    try {
      // WindowInstance 提供 close()（API 类型声明中另有拼写错误的 destory()，统一用 close）
      if (typeof exerciseWindowInstance.close === 'function') {
        exerciseWindowInstance.close()
      }
    } catch (e) {
      console.error('关闭窗口失败:', e)
    }

    exerciseWindowInstance = null
  },

  // ===== 存储 API =====
  // 使用 ZTools dbStorage API（与 exercise-guide.html 共享）
  getItem(key) {
    if (window.ztools && window.ztools.dbStorage) {
      return window.ztools.dbStorage.getItem(key)
    }
    // fallback 到文件存储（开发模式）
    const filePath = getStoragePath(key)
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, { encoding: 'utf-8' })
        return JSON.parse(content)
      }
    } catch (e) {
      console.error('Failed to read storage:', e)
    }
    return null
  },

  setItem(key, value) {
    if (window.ztools && window.ztools.dbStorage) {
      window.ztools.dbStorage.setItem(key, value)
      return
    }
    // fallback 到文件存储（开发模式）
    const filePath = getStoragePath(key)
    try {
      fs.writeFileSync(filePath, JSON.stringify(value, null, 2), { encoding: 'utf-8' })
    } catch (e) {
      console.error('Failed to write storage:', e)
    }
  },

  removeItem(key) {
    if (window.ztools && window.ztools.dbStorage) {
      window.ztools.dbStorage.removeItem(key)
      return
    }
    // fallback 到文件存储（开发模式）
    const filePath = getStoragePath(key)
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    } catch (e) {
      console.error('Failed to remove storage:', e)
    }
  },

  // ===== 初始化 =====
  init() {
    // 读取配置,如果存在则启动定时器
    const config = this.getItem('tiga_config')
    if (config && config.enabled) {
      this.startTimer(config.interval)
    }

    // 注意：子窗口（exercise-guide.html）通过 window.ztools.sendToParent 通知关闭，
    // 但 ZTools 主窗口侧未提供对应的监听 API（ipcOn 不存在）。
    // 因此不在此注册监听；运动弹窗实例引用会在下次 _showExercisePopup
    // 调用 _closeAndClearExerciseWindow 时统一清理，不影响功能。
  }
}

// 初始化
window.services.init()