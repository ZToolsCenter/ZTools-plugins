export type OutlineItem = { level: number; text: string; headingIndex: number }

export function extractOutline(markdown: string): OutlineItem[] {
  const items: OutlineItem[] = []
  const lines = markdown.split(/\r?\n/)
  let inFence = false
  let fenceMarker = ''

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (fence) {
      const marker = fence[1][0]
      if (!inFence) {
        inFence = true
        fenceMarker = marker
      } else if (marker === fenceMarker) {
        inFence = false
      }
      continue
    }
    if (inFence) continue

    const atx = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (atx) {
      items.push({ level: atx[1].length, text: atx[2].trim(), headingIndex: items.length })
      continue
    }

    if (index + 1 < lines.length && line.trim()) {
      const setext = lines[index + 1].match(/^\s{0,3}(=+|-+)\s*$/)
      if (setext) {
        items.push({ level: setext[1][0] === '=' ? 1 : 2, text: line.trim(), headingIndex: items.length })
        index += 1
      }
    }
  }
  return items
}
