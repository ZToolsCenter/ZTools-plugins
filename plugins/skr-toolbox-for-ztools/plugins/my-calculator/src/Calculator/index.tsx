import { useState, useCallback } from 'react'
import './index.css'
import { calculate, isValidExpression, appendToExpression, isOperatorChar } from './utils'

interface HistoryItem {
  expression: string
  result: string
  timestamp: number
}

interface CalculatorProps {
  enterAction: { code: string; type: string; payload: unknown; option: unknown }
}

export default function Calculator({ enterAction }: CalculatorProps) {
  const [expression, setExpression] = useState('')
  const [result, setResult] = useState('0')
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [hasResult, setHasResult] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  // 处理按钮点击
  const handleButton = useCallback((value: string) => {
    if (value === 'AC') {
      setExpression('')
      setResult('0')
      setHasResult(false)
      return
    }

    if (value === '=') {
      if (!expression || hasResult) return
      if (!isValidExpression(expression)) {
        setResult('Error')
        return
      }
      const { result: calcResult, error } = calculate(expression)
      if (error) {
        setResult('Error')
      } else {
        setResult(calcResult)
        setHistory((prev) => [
          { expression, result: calcResult, timestamp: Date.now() },
          ...prev.slice(0, 19), // 保留最近20条
        ])
        setHasResult(true)
      }
      return
    }

    if (value === '()') {
      // 简单处理：计算当前左括号和右括号的数量
      const leftCount = (expression.match(/\(/g) || []).length
      const rightCount = (expression.match(/\)/g) || []).length

      if (leftCount > rightCount && expression.length > 0 && !isOperatorChar(expression.slice(-1))) {
        // 如果左括号多，且末尾不是运算符，添加右括号
        setExpression((prev) => prev + ')')
      } else {
        // 否则添加左括号
        setExpression((prev) => appendToExpression(prev, '(', hasResult))
      }
      setHasResult(false)
      return
    }

    if (value === '%') {
      setExpression((prev) => appendToExpression(prev, '%', hasResult))
      setHasResult(false)
      return
    }

    // 数字和运算符
    setExpression((prev) => appendToExpression(prev, value, hasResult, result))
    setHasResult(false)
  }, [expression, hasResult, result])

  // 处理历史项点击
  const handleHistoryClick = (item: HistoryItem) => {
    setExpression(item.result)
    setResult(item.result)
    setHasResult(true)
    setShowHistory(false)
  }

  // 清空历史
  const clearHistory = () => {
    setHistory([])
  }

  // 删除最后一个字符
  const handleBackspace = () => {
    if (hasResult) {
      setExpression('')
      setResult('0')
      setHasResult(false)
    } else {
      setExpression((prev) => prev.slice(0, -1))
    }
  }

  // 键盘支持
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const key = e.key
    if (/\d/.test(key)) {
      handleButton(key)
    } else if (key === '+') handleButton('+')
    else if (key === '-') handleButton('-')
    else if (key === '*') handleButton('×')
    else if (key === '/') handleButton('÷')
    else if (key === '%') handleButton('%')
    else if (key === '(' || key === ')') handleButton('()')
    else if (key === 'Enter' || key === '=') handleButton('=')
    else if (key === 'Escape' || key === 'AC') handleButton('AC')
    else if (key === 'Backspace') handleBackspace()
    else if (key === '.') handleButton('.')
  }

  const ButtonClass = (value: string) => {
    if (['AC', '()', '%', '÷', '×', '-', '+', '='].includes(value)) {
      if (value === '=') return 'btn btn-equals'
      if (['÷', '×', '-', '+'].includes(value)) return 'btn btn-operator'
      return 'btn btn-function'
    }
    if (value === '0') return 'btn btn-number btn-zero'
    return 'btn btn-number'
  }

  return (
    <div className="calculator" tabIndex={0} onKeyDown={handleKeyDown}>
      {/* 头部 */}
      <div className="calculator-header">
        <button
          className={`history-toggle ${showHistory ? 'active' : ''}`}
          onClick={() => setShowHistory(!showHistory)}
        >
          {showHistory ? '隐藏历史' : '查看历史'}
        </button>
        {history.length > 0 && (
          <button className="clear-history" onClick={clearHistory}>
            清空历史
          </button>
        )}
      </div>

      {/* 历史记录 */}
      {showHistory && (
        <div className="calculator-history">
          {history.length === 0 ? (
            <div className="history-empty">暂无历史记录</div>
          ) : (
            history.map((item, index) => (
              <div
                key={item.timestamp}
                className="history-item"
                onClick={() => handleHistoryClick(item)}
              >
                <span className="history-expression">{item.expression}</span>
                <span className="history-result">= {item.result}</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* 显示区域 */}
      <div className="calculator-display">
        <div className="display-expression">{expression || '0'}</div>
        <div className="display-result">{result}</div>
      </div>

      {/* 按钮区域 */}
      <div className="calculator-buttons">
        <button className={ButtonClass('AC')} onClick={() => handleButton('AC')}>
          AC
        </button>
        <button className={ButtonClass('()')} onClick={() => handleButton('()')}>
          ()
        </button>
        <button className={ButtonClass('%')} onClick={() => handleButton('%')}>
          %
        </button>
        <button className={ButtonClass('÷')} onClick={() => handleButton('÷')}>
          ÷
        </button>

        <button className={ButtonClass('7')} onClick={() => handleButton('7')}>
          7
        </button>
        <button className={ButtonClass('8')} onClick={() => handleButton('8')}>
          8
        </button>
        <button className={ButtonClass('9')} onClick={() => handleButton('9')}>
          9
        </button>
        <button className={ButtonClass('×')} onClick={() => handleButton('×')}>
          ×
        </button>

        <button className={ButtonClass('4')} onClick={() => handleButton('4')}>
          4
        </button>
        <button className={ButtonClass('5')} onClick={() => handleButton('5')}>
          5
        </button>
        <button className={ButtonClass('6')} onClick={() => handleButton('6')}>
          6
        </button>
        <button className={ButtonClass('-')} onClick={() => handleButton('-')}>
          -
        </button>

        <button className={ButtonClass('1')} onClick={() => handleButton('1')}>
          1
        </button>
        <button className={ButtonClass('2')} onClick={() => handleButton('2')}>
          2
        </button>
        <button className={ButtonClass('3')} onClick={() => handleButton('3')}>
          3
        </button>
        <button className={ButtonClass('+')} onClick={() => handleButton('+')}>
          +
        </button>

        <button className={ButtonClass('0')} onClick={() => handleButton('0')}>
          0
        </button>
        <button className={ButtonClass('.')} onClick={() => handleButton('.')}>
          .
        </button>
        <button className={ButtonClass('=')} onClick={() => handleButton('=')}>
          =
        </button>
      </div>
    </div>
  )
}
