import { load } from 'js-yaml'
import { isJsonDocument, stringifyJson } from './parse.ts'
import { xmlToJson } from './xml.ts'

const queryParams = /^(?:[^\s=&]{1,40}=[^\s=&]*&)+[^\s=&]{1,40}=[^\s=&]*$/
const xmlDocument = /<(\w+?)(?: .*)?>[\s\S]*<\/\1>/
const yamlMapping = /^\w{1,40}:($| )/m

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

function normalizeJson(text: string): string {
  const decoded = text.replace(/(?<!\\)(?:\\\\)*\\u[\da-f]{4}/gi, (escape) => {
    const character = String.fromCharCode(parseInt(escape.slice(-4), 16))
    if (character < ' ' || character === '"' || character === '\\') return escape
    return escape.slice(0, -6) + character
  })
  if (isValidJson(decoded)) return decoded
  if (isValidJson(text)) return text

  const unescaped = decoded.replaceAll('\\"', '"')
  if (isValidJson(unescaped)) return unescaped
  return text
}

export function formatInput(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  if (isJsonDocument(text)) return normalizeJson(text)

  if (queryParams.test(text)) {
    return stringifyJson(Object.fromEntries(new URLSearchParams(text)))
  }

  if (trimmed.startsWith('<') && trimmed.endsWith('>') && xmlDocument.test(text)) {
    return stringifyJson(xmlToJson(text))
  }

  if (yamlMapping.test(text)) {
    try {
      return stringifyJson(load(text)) ?? text
    } catch {
      return text
    }
  }
  return text
}
