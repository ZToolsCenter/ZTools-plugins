// src/types.ts

// 配置数据
export interface Config {
  // 提醒设置
  interval: number              // 提醒间隔（分钟），默认 30
  workTimeMode: 'single' | 'multi' | 'weekly'  // 工作时段模式
  workTime: WorkTimeConfig

  // 提醒与计数
  reminderMode: 'notify' | 'notify+popup'  // 仅通知 / 通知+弹窗
  countMode: 'auto' | 'manual'             // 自动计数 / 手动计数

  // 运动参数
  exercise: {
    contractSeconds: number    // 收缩时长（秒）
    relaxSeconds: number       // 放松时长（秒）
    repeatCount: number        // 重复次数
  }

  // 文案风格
  style: 'random' | 'normal' | 'funny'
  normalTexts: NotificationText[]  // 正经文案列表（包含默认和自定义）
  funnyTexts: NotificationText[]   // 搞怪文案列表（包含默认和自定义）

  // 运行状态
  enabled: boolean             // 开关启停
}

// 工作时段配置
export interface WorkTimeConfig {
  single: { start: string; end: string }
  multi: Array<{ start: string; end: string }>
  weekly: Record<number, { start: string; end: string } | null>
}

// 统计数据
export interface StatsData {
  records: Array<{
    date: string      // YYYY-MM-DD
    count: number     // 当日完成次数
    times: string[]   // 每次完成的时间点 HH:MM
  }>
}

// 通知文案
export interface NotificationText {
  title: string
  body: string
}

// 正经文案
export const NORMAL_TEXTS: NotificationText[] = [
  { title: '提肛提醒', body: '久坐伤身，该做提肛运动了，关爱您的盆底健康。' },
  { title: '健康时刻', body: '收缩盆底肌，保持5秒，放松5秒，关爱久坐族健康。' },
  { title: '运动提醒', body: '定时提肛运动，预防痔疮，改善盆底功能。' }
]

// 搞怪文案池
export const FUNNY_TEXTS: NotificationText[] = [
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

// 默认配置
export const DEFAULT_CONFIG: Config = {
  interval: 30,
  workTimeMode: 'single',
  workTime: {
    single: { start: '09:00', end: '18:00' },
    multi: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
    weekly: {
      0: null,  // 周日
      1: { start: '09:00', end: '18:00' },
      2: { start: '09:00', end: '18:00' },
      3: { start: '09:00', end: '18:00' },
      4: { start: '09:00', end: '18:00' },
      5: { start: '09:00', end: '18:00' },
      6: null,  // 周六
    }
  },
  reminderMode: 'notify+popup',
  countMode: 'manual',
  exercise: {
    contractSeconds: 5,
    relaxSeconds: 10,
    repeatCount: 2
  },
  style: 'random',
  normalTexts: [...NORMAL_TEXTS],
  funnyTexts: [...FUNNY_TEXTS],
  enabled: true
}

// 存储键名
export const STORAGE_KEYS = {
  config: 'tiga_config',
  stats: 'tiga_stats'
}

// 获取随机文案
export function getRandomText(style: Config['style'], normalTexts?: NotificationText[], funnyTexts?: NotificationText[]): NotificationText {
  const normalList = normalTexts || NORMAL_TEXTS
  const funnyList = funnyTexts || FUNNY_TEXTS

  if (style === 'normal') {
    const index = Math.floor(Math.random() * normalList.length)
    return normalList[index]
  }

  if (style === 'funny') {
    const index = Math.floor(Math.random() * funnyList.length)
    return funnyList[index]
  }

  // random: 从全部文案中随机
  const allTexts = [...normalList, ...funnyList]
  const index = Math.floor(Math.random() * allTexts.length)
  return allTexts[index]
}

// 计算连续打卡天数（真正的连续：中间任何一天没打卡即中断）
// 易用性优化：若今天尚未打卡（例如上午还未开始），
// 但昨天有打卡，连续天数应依然有效，从昨天起向前计算。
// 只有今天和昨天都没打卡时，连续才算中断。
export function calculateStreak(records: StatsData['records']): number {
  if (!records || !records.length) return 0

  const today = getTodayDate()

  // 用 Map 做 O(1) 查找，替代之前的 Array.find O(n)
  const recordMap = new Map(records.map(r => [r.date, r]))

  // 确定起始日期：若今天尚未打卡，则从昨天开始向前计算
  const todayRecord = recordMap.get(today)
  const startFromToday = todayRecord && todayRecord.count > 0

  let streak = 0
  const checkDate = parseLocalDate(today)
  if (!startFromToday) {
    // 今天未打卡：从昨天开始
    checkDate.setDate(checkDate.getDate() - 1)
  }

  for (let i = 0; i < 365; i++) {
    const dateStr = formatLocalDate(checkDate)
    const record = recordMap.get(dateStr)

    if (!record || record.count <= 0) {
      // 没有记录或 count=0：连续中断
      break
    }

    streak++
    checkDate.setDate(checkDate.getDate() - 1)
  }

  return streak
}

// 将 YYYY-MM-DD 解析为本地时区的 Date（避免 new Date('YYYY-MM-DD') 按 UTC 0 时解析）
function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// 将 Date 格式化为本地时区的 YYYY-MM-DD 字符串
function formatLocalDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 获取今日日期字符串（本地时区，避免 toISOString 在 UTC+8 凌晨 0-8 点把日期算成昨天）
export function getTodayDate(): string {
  return formatLocalDate(new Date())
}