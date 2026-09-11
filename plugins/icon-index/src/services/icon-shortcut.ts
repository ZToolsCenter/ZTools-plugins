export interface IconSequenceMatch {
  buffer: string
  index: number | null
  commit: boolean
}

export function matchIconSequence(buffer: string, digit: string, itemCount: number): IconSequenceMatch {
  if (!/^\d$/.test(digit) || itemCount < 1) return { buffer: '', index: null, commit: false }
  if (!buffer && digit === '0') return { buffer: '', index: null, commit: false }

  const candidate = `${buffer}${digit}`
  const value = Number(candidate)
  if (!Number.isInteger(value) || value < 1 || value > itemCount) {
    return { buffer: '', index: null, commit: false }
  }

  let hasLongerMatch = false
  for (let sequence = 1; sequence <= itemCount; sequence += 1) {
    const sequenceText = String(sequence)
    if (sequenceText.length > candidate.length && sequenceText.startsWith(candidate)) {
      hasLongerMatch = true
      break
    }
  }

  return {
    buffer: candidate,
    index: value - 1,
    commit: !hasLongerMatch
  }
}
