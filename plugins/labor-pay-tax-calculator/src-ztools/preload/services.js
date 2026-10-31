const MAX_AMOUNT = 100_000_000

// 中国劳务报酬预扣率表二（国家税务总局公告 2018 年第 56 号）。
// 应纳税所得额 = 单次收入 ≤ 4000 元时减 800 元；> 4000 元时按 80% 计入。
// 预扣税额 = 应纳税所得额 × 预扣率 - 速算扣除数。
// 档位以「应纳税所得额」判定，不是收入额：≤2 万 20%；2 万–5 万 30%（速扣 2000）；>5 万 40%（速扣 7000）。
const LABOR_TAX_BRACKETS = [
  { maxBase: 20000, rate: 0.2, deduction: 0 },
  { maxBase: 50000, rate: 0.3, deduction: 2000 },
  { maxBase: Infinity, rate: 0.4, deduction: 7000 }
]

/**
 * 从用户输入中提取一个非负金额。支持中文分/角、千分位逗号与 "元" 等后缀。
 * @param {string} raw 用户输入。
 * @returns {{value: number, raw: string} | null} 解析成功时返回数值与原样输入。
 */
function parseAmount(raw) {
  if (raw === null || raw === undefined) return null
  const text = String(raw).trim()
  if (!text) return null
  const normalized = text.replace(/[,，\s]/g, '').replace(/[元￥¥分角]/g, '')
  const match = /(?:^|[^\d-])(-?\d+(?:\.\d{1,2})?)(?=$|[^\d.])/u.exec(normalized)
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value) || value < 0) return null
  return { value, raw: match[1] }
}

/**
 * 计算劳务报酬的预扣个税与税后金额。
 * @param {number} gross 税前劳务报酬金额。
 * @returns {{ gross: number, incomeBase: number, taxableBase: number, tax: number, net: number, rate: number, deduction: number }} 结果。
 * @throws {Error} 金额不在允许范围内时抛出。
 */
function calculateForward(gross) {
  if (!Number.isFinite(gross) || gross < 0 || gross > MAX_AMOUNT) {
    throw new Error('税前金额需在 0 至 1 亿之间')
  }
  const incomeBase = gross > 4000 ? gross * 0.8 : Math.max(0, gross - 800)
  const bracket = LABOR_TAX_BRACKETS.find((item) => incomeBase <= item.maxBase)
  const tax = Math.max(0, incomeBase * bracket.rate - bracket.deduction)
  const net = Math.max(0, gross - tax)
  return {
    gross: round2(gross),
    incomeBase: round2(incomeBase),
    taxableBase: round2(incomeBase),
    tax: round2(tax),
    net: round2(net),
    rate: bracket.rate,
    deduction: bracket.deduction
  }
}

/**
 * 用税后金额反推税前金额与预扣个税。
 * 由于税前金额的取值同时影响税率与速算扣除数，直接用解析式反推容易与档位
 * 边界错位，这里采用单调二分搜索，保证与正向公式完全一致。
 * @param {number} net 税后金额。
 * @returns {{ gross: number, incomeBase: number, taxableBase: number, tax: number, net: number, rate: number, deduction: number }} 结果。
 * @throws {Error} 金额不在允许范围内时抛出。
 */
function calculateReverse(net) {
  if (!Number.isFinite(net) || net < 0 || net > MAX_AMOUNT) {
    throw new Error('税后金额需在 0 至 1 亿之间')
  }
  // net 随 gross 单调递增，二分搜索税前金额
  let lo = 0
  let hi = Math.min(MAX_AMOUNT, Math.max(net / 0.68, net))
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2
    const calculated = calculateForward(mid)
    if (Math.abs(calculated.net - net) < 0.005) {
      return calculated
    }
    if (calculated.net < net) {
      lo = mid
    } else {
      hi = mid
    }
  }
  return calculateForward((lo + hi) / 2)
}

function round2(value) {
  return Math.round(value * 100) / 100
}

/**
 * 面向页面的统一入口：解析文本、执行计算并补充可展示信息。
 * @param {string} input 用户输入，可包含金额与单位。
 * @param {'forward'|'reverse'} mode 计算方向。
 * @returns {{ mode: string, input: string, value: number, result: object }} 结构化结果。
 */
function calculate(input, mode) {
  if (mode !== 'forward' && mode !== 'reverse') {
    throw new Error('未知的计算模式')
  }
  const parsed = parseAmount(input)
  if (!parsed) throw new Error('未找到有效的金额，请输入 0 到 1 亿之间的数字')
  const result = mode === 'forward' ? calculateForward(parsed.value) : calculateReverse(parsed.value)
  result.direction = mode === 'forward' ? '税前 → 税后' : '税后 → 税前'
  result.inputText = parsed.raw
  return { mode, input: parsed.raw, value: parsed.value, result }
}

window.services = {
  /** 把金额文本转为数值，用于校验输入。 */
  parseAmount(input) {
    return parseAmount(input)
  },
  /** 税前金额 → 税后金额与预扣个税。 */
  calculateForward(input) {
    const data = parseAmount(input)
    if (!data) throw new Error('未找到有效的税前金额')
    return calculateForward(data.value)
  },
  /** 税后金额 → 税前金额与预扣个税。 */
  calculateReverse(input) {
    const data = parseAmount(input)
    if (!data) throw new Error('未找到有效的税后金额')
    return calculateReverse(data.value)
  },
  /** 统一入口，用于插件指令直接触发。 */
  calculate(input, mode) {
    return calculate(input, mode)
  }
}
