import { isJsonDocument, parseJson, stringifyJson } from './parse.ts'

type FilterRequest = { id: number; text: string; expression: string }

const runExpression = new Function('expression', '"use strict"; return eval("this" + expression)')

let lastText: string | undefined
let context: unknown
let inputError = ''

function evaluateFilter(text: string, expression: string): string {
  if (!text) return '// JSON为空'

  if (text !== lastText) {
    lastText = text
    inputError = ''
    try {
      context = parseJson(text)
      if (!context) inputError = '// 错误的JSON格式'
    } catch {
      inputError = '// 错误的JSON格式'
    }
  }
  if (inputError) return inputError

  try {
    let result: unknown = runExpression.call(context, expression)
    if (typeof result === 'string' && isJsonDocument(result)) {
      try {
        result = parseJson(result)
      } catch {
        // Leave strings that are not valid JSON intact.
      }
    }

    if (result === undefined) return '// undefined'
    if (typeof result === 'function') return '// function'
    return stringifyJson(result) ?? '// undefined'
  } catch (error) {
    return '// ' + (error instanceof Error ? error.message : String(error))
  }
}

self.onmessage = ({ data }: MessageEvent<FilterRequest>) => {
  const { id, text, expression } = data
  self.postMessage({ id, output: evaluateFilter(text, expression) })
}
