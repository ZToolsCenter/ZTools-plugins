// src/Containers/logFormat.ts — 日志行解析（高亮行首时间戳）

export interface LogLineParts {
  prefix: string   // compose 服务前缀（如 "postgres-1  | "）或时间前的少量前缀（如 "1:C "）
  time: string     // 行首时间戳（支持多种日期格式，含毫秒）
  rest: string     // 其余内容
}

// 支持的时间格式（日期部分 + 时间部分）：
//   2026-08-14 16:36:57            ISO 空格
//   2026-08-15T15:34:00            ISO T 分隔
//   2026/08/14 16:36:57            斜杠分隔
//   14/08/2026 16:36:57            日/月/年（或月/日/年）
//   13 Aug 2026 06:36:46           redis 日 月名 年
//   Aug 13, 2026 06:36:46          月名 日, 年
//   均支持可选毫秒 .123
const TIME_PATTERN =
  '(?:' +
  '\\d{4}[-/.]\\d{2}[-/.]\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}' +   // YYYY-MM-DD[T ]HH:mm:ss
  '|\\d{2}[-/.]\\d{2}[-/.]\\d{4}[T ]\\d{2}:\\d{2}:\\d{2}' +   // DD/MM/YYYY 或 MM/DD/YYYY
  '|\\d{1,2} [A-Z][a-z]{2} \\d{4} \\d{2}:\\d{2}:\\d{2}' +       // 13 Aug 2026 06:36:46
  '|[A-Z][a-z]{2} \\d{1,2},? \\d{4} \\d{2}:\\d{2}:\\d{2}' +     // Aug 13, 2026 06:36:46
  ')(?:\\.\\d+)?'

// 在行首（可能前有少量非时间前缀，如 redis 的 "1:C "）扫描第一个时间戳
const TIME_RE = new RegExp('^(.{0,12}?)(' + TIME_PATTERN + ')')

export function parseLogLine(line: string): LogLineParts {
  const s = String(line || '')
  let head = s
  let prefix = ''
  // compose 服务前缀："service-1  | "
  const compose = /^([\w.-]+ {2}\| )/.exec(s)
  if (compose) {
    prefix = compose[1]
    head = s.slice(compose[1].length)
  }
  const m = TIME_RE.exec(head)
  if (m) {
    return {
      prefix: prefix + m[1],
      time: m[2],
      rest: head.slice(m[1].length + m[2].length)
    }
  }
  return { prefix, time: '', rest: head }
}
