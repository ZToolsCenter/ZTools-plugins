// 将模板事件值转换为数字，兼容 ZTools 组件可能返回字符串或数字的场景。
export function uiNum(value: string | number): number {
  return Number(value)
}

// 统一清理输入控件提交值，后续数值解析都基于去空白后的字符串。
export function normalizeInputValue(value: string | number) {
  return String(value).trim()
}

// 解析数值表达式，支持相对调整（+10、-5）、倍率调整（*2、/2）和简单数学运算。
export function evaluateExpression(currentValue: number, input: string): number | null {
  const normalized = normalizeInputValue(input)
  if (normalized === '') return null

  // 直接数字
  const directNumber = Number(normalized)
  if (Number.isFinite(directNumber)) {
    return directNumber
  }

  // 相对调整：+10、-5
  if (/^[+\-]\d+(\.\d+)?$/.test(normalized)) {
    const delta = Number(normalized)
    if (Number.isFinite(delta)) {
      return currentValue + delta
    }
  }

  // 倍率调整：*2、/2
  if (/^[*/]\d+(\.\d+)?$/.test(normalized)) {
    const operator = normalized[0]
    const operand = Number(normalized.slice(1))
    if (Number.isFinite(operand)) {
      if (operator === '*') {
        return currentValue * operand
      } else if (operator === '/' && operand !== 0) {
        return currentValue / operand
      }
    }
  }

  // 简单数学表达式：支持四则运算
  try {
    // 安全地计算表达式，只允许数字和基本运算符
    if (/^[\d+\-*/.() ]+$/.test(normalized)) {
      // 使用 Function 构造器安全地计算表达式
      const result = new Function(`return ${normalized}`)()
      if (Number.isFinite(result)) {
        return result
      }
    }
  } catch (e) {
    // 表达式无效，返回 null
  }

  return null
}

// 提交普通数值输入，空值或非法数值会回退到当前值，并先反映到输入框再应用业务更新。
// 支持表达式：+10（相对）、*2（倍率）、100+50（计算）。
export function commitNumericInput(
  value: string | number,
  fallback: number,
  apply: (next: number) => void,
  reflect: (next: string) => void
) {
  const normalized = normalizeInputValue(value)
  const evaluated = evaluateExpression(fallback, normalized)
  const next = evaluated !== null ? evaluated : fallback
  reflect(String(next))
  apply(next)
}

// 仅接受正数输入，适用于宽高等不能为 0 或负数的字段，非法内容统一回退到当前有效值。
// 支持表达式：+10（相对）、*2（倍率）、100+50（计算）。
export function commitPositiveNumericInput(
  value: string | number,
  fallback: number,
  apply: (next: number) => void,
  reflect: (next: string) => void
) {
  const normalized = normalizeInputValue(value)
  const evaluated = evaluateExpression(fallback, normalized)
  const next = evaluated !== null && evaluated > 0 ? evaluated : fallback
  reflect(formatNumericInputValue(next))
  apply(next)
}

// 从原生 input 事件中读取数值，保留给仍使用原生控件的模板或回调复用。
export function evNum(e: Event): number {
  return +(e.target as HTMLInputElement).value
}

// 从原生 checkbox 事件中读取勾选状态，保留给仍使用原生控件的模板或回调复用。
export function evChecked(e: Event): boolean {
  return (e.target as HTMLInputElement).checked
}

// 将编辑器中的数值格式化为最多两位小数，避免输入框展示长浮点尾差。
export function formatNumericInputValue(value: number) {
  return String(Math.round(value * 100) / 100)
}
