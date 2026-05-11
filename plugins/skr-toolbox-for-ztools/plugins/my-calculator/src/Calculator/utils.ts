/**
 * 计算器工具函数
 * 使用逆波兰表达式算法解析和计算数学表达式
 */

// 运算符优先级
const PRECEDENCE: Record<string, number> = {
  '+': 1,
  '-': 1,
  '*': 2,
  '/': 2,
}

// 判断是否为运算符
function isOperator(token: string): boolean {
  return token in PRECEDENCE
}

// 获取运算符优先级
function getPrecedence(token: string): number {
  return PRECEDENCE[token] ?? 0
}

// 表达式词法分析
function tokenize(expression: string): string[] {
  const tokens: string[] = []
  let i = 0
  const expr = expression.replace(/\s+/g, '')

  while (i < expr.length) {
    const char = expr[i]

    // 数字（包括小数）
    if (/\d/.test(char)) {
      let num = ''
      let dotCount = 0
      while (i < expr.length && (/\d/.test(expr[i]) || expr[i] === '.')) {
        if (expr[i] === '.') {
          dotCount++
          if (dotCount > 1) {
            throw new Error('Invalid number format: multiple decimal points')
          }
        }
        num += expr[i++]
      }
      tokens.push(num)
    }
    // 运算符和括号
    else if ('+-*/%()'.includes(char)) {
      tokens.push(char)
      i++
    } else {
      i++
    }
  }

  return tokens
}

// 逆波兰表达式转换
function toRPN(expression: string): string[] {
  const tokens = tokenize(expression)
  const output: string[] = []
  const stack: string[] = []

  for (const token of tokens) {
    if (/^\d/.test(token)) {
      output.push(token)
    } else if (token === '%') {
      // 百分号作为 postfix 运算符，直接加入 output
      output.push('%')
    } else if (token === '(') {
      stack.push(token)
    } else if (token === ')') {
      while (stack.length > 0 && stack[stack.length - 1] !== '(') {
        output.push(stack.pop()!)
      }
      stack.pop() // 弹出 '('
    } else if (isOperator(token)) {
      while (
        stack.length > 0 &&
        stack[stack.length - 1] !== '(' &&
        getPrecedence(stack[stack.length - 1]) >= getPrecedence(token)
      ) {
        output.push(stack.pop()!)
      }
      stack.push(token)
    }
  }

  while (stack.length > 0) {
    output.push(stack.pop()!)
  }

  return output
}

// 计算逆波兰表达式
function evaluateRPN(rpn: string[]): number {
  const stack: number[] = []

  for (const token of rpn) {
    if (token === '%') {
      // 百分号：栈顶元素除以100
      if (stack.length > 0) {
        const num = stack.pop()!
        stack.push(num / 100)
      }
    } else if (isOperator(token)) {
      const b = stack.pop()!
      const a = stack.pop()!
      let result: number

      switch (token) {
        case '+':
          result = a + b
          break
        case '-':
          result = a - b
          break
        case '*':
          result = a * b
          break
        case '/':
          if (b === 0) throw new Error('Division by zero')
          result = a / b
          break
        default:
          result = 0
      }

      stack.push(result)
    } else {
      stack.push(parseFloat(token))
    }
  }

  return stack[0] ?? 0
}

// 四舍五入到指定小数位（处理浮点精度问题）
function roundResult(num: number, decimals: number = 10): number {
  const factor = Math.pow(10, decimals)
  return Math.round(num * factor) / factor
}

// 主计算函数
export function calculate(expression: string): { result: string; error: boolean } {
  try {
    // 清理表达式
    const cleaned = expression
      .replace(/×/g, '*')
      .replace(/÷/g, '/')
      .replace(/٪/g, '%')

    if (!cleaned.trim()) {
      return { result: '0', error: false }
    }

    const rpn = toRPN(cleaned)
    const result = evaluateRPN(rpn)

    if (!isFinite(result)) {
      return { result: 'Error', error: true }
    }

    // 格式化结果
    const rounded = roundResult(result)
    const resultStr = rounded.toString()

    // 如果结果是大数，使用科学计数法
    if (Math.abs(rounded) >= 1e15) {
      return { result: rounded.toExponential(6), error: false }
    }

    return { result: resultStr, error: false }
  } catch (e) {
    return { result: 'Error', error: true }
  }
}

// 验证表达式是否合法
export function isValidExpression(expression: string): boolean {
  // 统一转换 UI 符号
  const cleaned = expression
    .replace(/\s+/g, '')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/٪/g, '%')

  if (!cleaned) return false

  // 检查非法连续运算符（允许负号作为一元运算符）
  // 负号可以在开头或运算符后面（如 5*-2, 5+-2）
  if (/[+*/%]{2,}/.test(cleaned)) return false

  // 百分号不能在非法位置：
  // - 开头
  // - 紧跟在 ( + * / 后面（- 允许，因为可能是一元负号）
  if (/^%/.test(cleaned)) return false
  if (/[(*/+]%/.test(cleaned)) return false

  // 检查括号是否匹配
  let parens = 0
  for (const char of cleaned) {
    if (char === '(') parens++
    if (char === ')') parens--
    if (parens < 0) return false
  }
  if (parens !== 0) return false

  // 不能以运算符结尾（除了右括号和百分号）
  if (/[+\-*/]$/.test(cleaned)) return false

  return true
}

// 追加内容到表达式
export function appendToExpression(
  current: string,
  value: string,
  hasResult: boolean,
  result: string = ''
): string {
  // 如果有结果且用户输入运算符，用结果作为起始
  if (hasResult && isOperator(value)) {
    return result + value
  }

  // 如果有结果且用户输入数字或括号，清空
  if (hasResult && /[\d(]/.test(value)) {
    return value
  }

  // 防止表达式过长
  if (current.length >= 50) {
    return current
  }

  return current + value
}

// 判断是否为运算符
export function isOperatorChar(char: string): boolean {
  return '+-*/%'.includes(char)
}
