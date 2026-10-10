/**
 * zNotes keeps image dimensions beside otherwise standard Markdown images:
 *
 * ![Alt text](./image.png)<!-- znotes:image-width=640 -->
 *
 * Other Markdown readers continue to render the image and ignore the comment.
 */
export const IMAGE_WIDTH_MAX = 10_000

export type MarkdownImageMatch = {
  index: number
  start: number
  end: number
  markdown: string
  alt: string
  src: string
  width: number | null
}

type WidthComment = {
  start: number
  end: number
  width: number | null
}

function isEscaped(value: string, offset: number) {
  let slashes = 0
  for (let index = offset - 1; index >= 0 && value[index] === '\\'; index -= 1) slashes += 1
  return slashes % 2 === 1
}

function findClosing(value: string, start: number, open: string, close: string, end: number) {
  let depth = 1
  for (let index = start + 1; index < end; index += 1) {
    if (isEscaped(value, index)) continue
    if (value[index] === open) depth += 1
    if (value[index] !== close) continue
    depth -= 1
    if (depth === 0) return index
  }
  return -1
}

function unescapeMarkdownText(value: string) {
  return value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1')
}

function parseImageSource(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('<')) {
    const closing = trimmed.indexOf('>')
    return closing === -1 ? null : trimmed.slice(1, closing)
  }
  const source = trimmed.match(/^([^\s]+)/)?.[1]
  return source ? unescapeMarkdownText(source) : null
}

function parseWidth(value: string) {
  if (!/^\d+$/.test(value)) return null
  const width = Number(value)
  return Number.isSafeInteger(width) && width >= 1 && width <= IMAGE_WIDTH_MAX ? width : null
}

function getAdjacentWidthComment(markdown: string, imageEnd: number): WidthComment | null {
  const match = /[ \t]*<!--\s*znotes:image-width=([^>\r\n]*)-->/y
  match.lastIndex = imageEnd
  const result = match.exec(markdown)
  if (!result) return null
  return {
    start: imageEnd,
    end: imageEnd + result[0].length,
    width: parseWidth(result[1].trim()),
  }
}

function parseImageAt(markdown: string, start: number, lineEnd: number) {
  if (markdown.slice(start, start + 2) !== '![' || isEscaped(markdown, start)) return null
  const altEnd = findClosing(markdown, start + 1, '[', ']', lineEnd)
  if (altEnd === -1 || markdown[altEnd + 1] !== '(') return null
  const imageEnd = findClosing(markdown, altEnd + 1, '(', ')', lineEnd)
  if (imageEnd === -1) return null
  const src = parseImageSource(markdown.slice(altEnd + 2, imageEnd))
  if (!src) return null
  return {
    start,
    end: imageEnd + 1,
    markdown: markdown.slice(start, imageEnd + 1),
    alt: unescapeMarkdownText(markdown.slice(start + 2, altEnd)),
    src,
  }
}

function fenceMarker(line: string) {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})/)
  return match ? match[1] : null
}

/** Returns images in document order, excluding images written inside code fences or inline code. */
export function getMarkdownImages(markdown: string): MarkdownImageMatch[] {
  const images: MarkdownImageMatch[] = []
  let offset = 0
  let activeFence: string | null = null

  for (const lineWithEnding of markdown.matchAll(/.*(?:\r\n|\r|\n|$)/g)) {
    const line = lineWithEnding[0].replace(/\r?\n$/, '').replace(/\r$/, '')
    if (!lineWithEnding[0]) break
    const marker = fenceMarker(line)
    if (activeFence) {
      if (marker && marker[0] === activeFence[0] && marker.length >= activeFence.length) activeFence = null
      offset += lineWithEnding[0].length
      continue
    }
    if (marker) {
      activeFence = marker
      offset += lineWithEnding[0].length
      continue
    }

    const lineEnd = offset + line.length
    let index = offset
    while (index < lineEnd) {
      if (markdown[index] === '`' && !isEscaped(markdown, index)) {
        const run = markdown.slice(index, lineEnd).match(/^`+/)?.[0] ?? '`'
        const closing = markdown.indexOf(run, index + run.length)
        index = closing === -1 || closing >= lineEnd ? lineEnd : closing + run.length
        continue
      }
      const image = parseImageAt(markdown, index, lineEnd)
      if (image) {
        const comment = getAdjacentWidthComment(markdown, image.end)
        images.push({ ...image, index: images.length, width: comment?.width ?? null })
        index = image.end
        continue
      }
      index += 1
    }
    offset += lineWithEnding[0].length
  }
  return images
}

function getImageOrThrow(markdown: string, imageIndex: number) {
  if (!Number.isInteger(imageIndex) || imageIndex < 0) throw new RangeError('图片索引无效')
  const image = getMarkdownImages(markdown)[imageIndex]
  if (!image) throw new RangeError('未找到对应图片')
  return image
}

function assertWidth(width: number) {
  if (!Number.isSafeInteger(width) || width < 1 || width > IMAGE_WIDTH_MAX) {
    throw new RangeError(`图片宽度必须是 1 到 ${IMAGE_WIDTH_MAX} 之间的整数像素`)
  }
}

/** Adds or replaces the selected image's adjacent zNotes width comment. */
export function setMarkdownImageWidth(markdown: string, imageIndex: number, width: number) {
  assertWidth(width)
  const image = getImageOrThrow(markdown, imageIndex)
  const comment = getAdjacentWidthComment(markdown, image.end)
  const replacement = `<!-- znotes:image-width=${width} -->`
  if (!comment) return `${markdown.slice(0, image.end)}${replacement}${markdown.slice(image.end)}`
  return `${markdown.slice(0, comment.start)}${replacement}${markdown.slice(comment.end)}`
}

/** Removes only the selected image's immediately adjacent zNotes width comment. */
export function clearMarkdownImageWidth(markdown: string, imageIndex: number) {
  const image = getImageOrThrow(markdown, imageIndex)
  const comment = getAdjacentWidthComment(markdown, image.end)
  return comment ? `${markdown.slice(0, comment.start)}${markdown.slice(comment.end)}` : markdown
}

/** Removes the selected image and its adjacent zNotes width comment, when present. */
export function removeMarkdownImage(markdown: string, imageIndex: number) {
  const image = getImageOrThrow(markdown, imageIndex)
  const comment = getAdjacentWidthComment(markdown, image.end)
  return `${markdown.slice(0, image.start)}${markdown.slice(comment?.end ?? image.end)}`
}

/**
 * Resolves an image index from raw Markdown attributes when a DOM source position is unavailable.
 * Prefer the image's document-order index when handling a rendered-image context menu.
 */
export function findMarkdownImageIndex(markdown: string, criteria: { src?: string; alt?: string; occurrence?: number }) {
  const { src, alt, occurrence = 0 } = criteria
  if (src === undefined && alt === undefined) return null
  if (!Number.isInteger(occurrence) || occurrence < 0) return null
  const matching = getMarkdownImages(markdown).filter((image) => (
    (src === undefined || image.src === src) &&
    (alt === undefined || image.alt === alt)
  ))
  return matching[occurrence]?.index ?? null
}
