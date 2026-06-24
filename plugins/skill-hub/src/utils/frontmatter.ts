export function parseFrontmatter(text: string): Record<string, string> {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const match = normalized.match(/^---\n([\s\S]*?)\n---/)
  const fm: Record<string, string> = {}
  if (match) {
    const lines = match[1].split('\n')
    let i = 0
    while (i < lines.length) {
      const line = lines[i]
      const sep = line.indexOf(':')
      if (sep <= 0) { i++; continue }
      const key = line.slice(0, sep).trim()
      let val = line.slice(sep + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        fm[key] = val.slice(1, -1)
        i++
        continue
      }
      const blockMatch = val.match(/^([>|])([+-]?)$/)
      if (blockMatch) {
        const style = blockMatch[1]
        const chomp = blockMatch[2]
        const blockLines: string[] = []
        i++
        while (i < lines.length) {
          const next = lines[i]
          if (next === '' || next.startsWith(' ') || next.startsWith('\t')) {
            blockLines.push(next.trimEnd())
            i++
          } else {
            break
          }
        }
        i--
        if (style === '>') {
          const paragraphs: string[] = []
          let current: string[] = []
          for (const bl of blockLines) {
            if (bl === '') {
              if (current.length) { paragraphs.push(current.join(' ')); current = [] }
            } else {
              current.push(bl)
            }
          }
          if (current.length) paragraphs.push(current.join(' '))
          val = paragraphs.join('\n\n')
          if (chomp === '+' && blockLines.length > 0) {
            const trailing = blockLines.reduce((n, l) => l === '' ? n + 1 : 0, 0)
            for (let t = 0; t < trailing; t++) val += '\n'
          }
        } else {
          val = blockLines.join('\n').trimEnd()
        }
      } else if (val === '' || val === '""' || val === "''") {
        const nextIdx = i + 1
        if (nextIdx < lines.length && (lines[nextIdx].startsWith(' ') || lines[nextIdx].startsWith('\t'))) {
          const blockLines: string[] = []
          i++
          while (i < lines.length) {
            const curr = lines[i]
            if (curr.startsWith(' ') || curr.startsWith('\t')) {
              blockLines.push(curr.trimEnd())
              i++
            } else {
              break
            }
          }
          i--
          val = blockLines.join(' ').replace(/\s+/g, ' ').trim()
        }
      }
      if (val.startsWith('[') && val.endsWith(']')) {
        val = val.slice(1, -1).trim()
      }
      fm[key] = val
      i++
    }
  }
  if (!fm.description) {
    const bodyStart = match ? match[0].length : 0
    const body = normalized.slice(bodyStart).trim()
    const firstLine = body.split('\n').find((l) => l.trim() && !l.startsWith('#'))
    if (firstLine) fm.description = firstLine.trim().slice(0, 200)
  }
  return fm
}
