import { useState } from 'react'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const MONTHS = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']

function getDaysInMonth (year, month) {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfWeek (year, month) {
  return new Date(year, month, 1).getDay()
}

function pad (v) {
  return String(v).padStart(2, '0')
}

function formatDate (d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function diffDates (a, b) {
  const da = new Date(a)
  const db = new Date(b)
  if (isNaN(da) || isNaN(db)) return null
  const diffMs = db - da
  const diffDays = Math.round(diffMs / 86400000)
  const abs = Math.abs(diffDays)
  const weeks = Math.floor(abs / 7)
  const days = abs % 7
  return { diffDays, abs, weeks, days }
}

export default function Calendar () {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [selected, setSelected] = useState(formatDate(today))
  const [dateA, setDateA] = useState(formatDate(today))
  const [dateB, setDateB] = useState('')

  const daysInMonth = getDaysInMonth(year, month)
  const firstDow = getFirstDayOfWeek(year, month)

  const cells = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1)
  }
  const goToday = () => { setYear(today.getFullYear()); setMonth(today.getMonth()) }

  const todayStr = formatDate(today)
  const diff = dateA && dateB ? diffDates(dateA, dateB) : null

  return (
    <div className='cal'>
      {/* 月历 */}
      <div className='cal__month-nav'>
        <button type='button' onClick={prevMonth}>‹</button>
        <span className='cal__month-label'>{year} 年 {MONTHS[month]}</span>
        <button type='button' onClick={nextMonth}>›</button>
        <button type='button' className='cal__today-btn' onClick={goToday}>今天</button>
      </div>

      <div className='cal__grid'>
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={`cal__weekday${i === 0 || i === 6 ? ' is-weekend' : ''}`}>{w}</div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div key={`empty-${i}`} />
          const dateStr = `${year}-${pad(month + 1)}-${pad(d)}`
          const dow = (firstDow + d - 1) % 7
          const isToday = dateStr === todayStr
          const isSelected = dateStr === selected
          const isWeekend = dow === 0 || dow === 6
          return (
            <div
              key={d}
              className={[
                'cal__day',
                isToday ? 'is-today' : '',
                isSelected ? 'is-selected' : '',
                isWeekend ? 'is-weekend' : ''
              ].filter(Boolean).join(' ')}
              onClick={() => { setSelected(dateStr); setDateA(dateStr) }}
            >
              {d}
            </div>
          )
        })}
      </div>

      {/* 日期差计算 */}
      <div className='cal__diff'>
        <div className='cal__diff-title'>日期计算</div>
        <div className='cal__diff-row'>
          <input
            type='date'
            value={dateA}
            className='cal__date-input'
            onChange={(e) => setDateA(e.target.value)}
          />
          <span className='cal__diff-sep'>至</span>
          <input
            type='date'
            value={dateB}
            className='cal__date-input'
            onChange={(e) => setDateB(e.target.value)}
          />
        </div>
        {diff !== null && (
          <div className='cal__diff-result'>
            <span className={diff.diffDays >= 0 ? 'is-pos' : 'is-neg'}>
              {diff.diffDays >= 0 ? '+' : '-'}{diff.abs} 天
            </span>
            {diff.abs >= 7 && (
              <span className='cal__diff-sub'>（{diff.weeks} 周 {diff.days > 0 ? `${diff.days} 天` : ''}）</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
