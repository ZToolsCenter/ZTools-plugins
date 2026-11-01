const MASK_CHARACTER = '•'
const EDGE_VISIBLE_COUNT = 3

const getVisibleEdgeCount = (visibleCharacterCount) => {
  if (visibleCharacterCount <= 2) return 0
  if (visibleCharacterCount <= EDGE_VISIBLE_COUNT * 2) return 1
  return EDGE_VISIBLE_COUNT
}

/**
 * Mask the middle of a string while retaining a recognizable prefix and suffix.
 * Whitespace and line breaks keep their original positions.
 * The original clipboard content is never modified.
 */
export const maskTextContent = (content) => {
  const characters = Array.from(String(content ?? ''))
  const visibleCharacterCount = characters.reduce(
    (count, character) => count + (/\S/u.test(character) ? 1 : 0),
    0
  )
  const visibleEdgeCount = getVisibleEdgeCount(visibleCharacterCount)
  let visibleIndex = 0

  return characters.map(character => {
    if (/\s/u.test(character)) return character

    const shouldRemainVisible = visibleEdgeCount > 0 && (
      visibleIndex < visibleEdgeCount ||
      visibleIndex >= visibleCharacterCount - visibleEdgeCount
    )
    visibleIndex++
    return shouldRemainVisible ? character : MASK_CHARACTER
  }).join('')
}
