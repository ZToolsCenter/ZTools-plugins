const lineBreakPattern = /\r\n|\n|\r/g
const commentLinePattern = /^\s*(\/\/|#|--)/

const splitLines = (text: string) => text.split(/\r\n|\n|\r/)

const getNonEmptyLines = (text: string) =>
  splitLines(text)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

export const removeLineBreaks = (text: string) => text.replace(lineBreakPattern, '')

export const addBlankLines = (text: string) => getNonEmptyLines(text).join('\n\n')

export const linesToComma = (text: string) => getNonEmptyLines(text).join(',')

export const dedupeLines = (text: string) => {
  const seen = new Set<string>()
  const result: string[] = []

  for (const line of getNonEmptyLines(text)) {
    if (seen.has(line)) continue
    seen.add(line)
    result.push(line)
  }

  return result.join('\n')
}

export const removeCommas = (text: string) => text.replace(/,/g, '')

export const addCommasByLine = (text: string) =>
  getNonEmptyLines(text)
    .map((line) => `${line},`)
    .join('\n')

export const commasToLines = (text: string) =>
  text
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .join('\n')

export const removeQuotes = (text: string) => text.replace(/['"]/g, '')

export const wrapLinesWithSingleQuotes = (text: string) =>
  getNonEmptyLines(text)
    .map((line) => `'${line}'`)
    .join('\n')

export const wrapLinesWithDoubleQuotes = (text: string) =>
  getNonEmptyLines(text)
    .map((line) => `"${line}"`)
    .join('\n')

export const trimLineEdges = (text: string) => getNonEmptyLines(text).join('\n')

export const removeAllWhitespace = (text: string) => text.replace(/\s/g, '')

export const removeCommentLines = (text: string) =>
  splitLines(text)
    .filter((line) => line.trim().length > 0)
    .filter((line) => !commentLinePattern.test(line))
    .join('\n')

export const toLowerCaseText = (text: string) => text.toLowerCase()

export const toUpperCaseText = (text: string) => text.toUpperCase()

export const replacePlainText = (text: string, findText: string, replacement: string) =>
  text.split(findText).join(replacement)

export const wrapLinesWithAffixes = (text: string, prefix: string, suffix: string) =>
  getNonEmptyLines(text)
    .map((line) => `${prefix}${line}${suffix}`)
    .join('\n')
