import JSONBigInt from 'json-bigint'

const json = JSONBigInt()

export function isJsonDocument(text: string): boolean {
  return /^\s*(\{[\s\S]*\}|\[[\s\S]*\])\s*$/.test(text)
}

export function parseJson(text: string): unknown {
  return json.parse(text)
}

export function stringifyJson(value: unknown): string {
  return json.stringify(value, undefined, 4)
}

export function compactJson(text: string): string {
  let inString = false
  let escaped = false
  let output = ''
  for (const char of text) {
    if (inString) {
      if (char === '"' && !escaped) inString = false
      escaped = char === '\\' && !escaped
    } else {
      if (char === ' ' || char === '\t' || char === '\r' || char === '\n') continue
      if (char === '"') inString = true
    }
    output += char
  }
  return output
}

export function escapeCompactJson(text: string): string {
  return JSON.stringify(compactJson(text)).slice(1, -1)
}
