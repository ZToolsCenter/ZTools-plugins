const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:', 'ftp:'])
const LEADING_NOISE = new Set(['(', '[', '{', '<', '（', '【', '《', '「', '『', '“', '‘', '"', "'"])
const TRAILING_NOISE = new Set([')', ']', '}', '>', '）', '】', '》', '」', '』', '”', '’', '"', "'", ',', '，', '.', '。', '!', '！', '?', '？', ';', '；', ':', '：'])
const INLINE_SEPARATORS = new Set([',', '，', ';', '；', '|', '、'])

function extractUrls(input) {
  const source = typeof input === 'string' ? input : String(input ?? '')
  if (!source.trim()) {
    return []
  }

  const results = []
  const seen = new Set()

  for (const chunk of scanChunks(source)) {
    const candidates = extractCandidatesFromChunk(chunk)

    for (const candidate of candidates) {
      const accepted = validateCandidate(candidate)
      if (!accepted || seen.has(accepted.key)) {
        continue
      }

      seen.add(accepted.key)
      results.push(accepted.output)
    }
  }

  return results
}

function scanChunks(source) {
  return source.match(/\S+/gu) || []
}

function extractCandidatesFromChunk(chunk) {
  const candidates = []
  let index = 0

  while (index < chunk.length) {
    const start = findCandidateStart(chunk, index)
    if (start === -1) {
      break
    }

    const end = findCandidateEnd(chunk, start)
    const rawCandidate = trimNoise(chunk.slice(start, end))
    if (rawCandidate) {
      candidates.push(rawCandidate)
    }

    index = end > start ? end : start + 1
  }

  return candidates
}

function findCandidateStart(chunk, fromIndex) {
  for (let index = fromIndex; index < chunk.length; index += 1) {
    if (hasSupportedSchemeAt(chunk, index) || hasWwwPrefixAt(chunk, index)) {
      return index
    }

    if (isPotentialBareHostStart(chunk, index)) {
      return index
    }
  }

  return -1
}

function findCandidateEnd(chunk, start) {
  let end = start

  while (end < chunk.length) {
    const char = chunk[end]
    if (INLINE_SEPARATORS.has(char)) {
      break
    }
    end += 1
  }

  return end
}

function hasSupportedSchemeAt(text, index) {
  const remainder = text.slice(index).toLowerCase()
  return (
    remainder.startsWith('http://') ||
    remainder.startsWith('https://') ||
    remainder.startsWith('ftp://')
  )
}

function hasWwwPrefixAt(text, index) {
  if (text.slice(index, index + 4).toLowerCase() !== 'www.') {
    return false
  }

  return !isHostCharacter(text[index - 1])
}

function isPotentialBareHostStart(text, index) {
  const current = text[index]
  if (!isHostCharacter(current) || isHostCharacter(text[index - 1])) {
    return false
  }

  const preview = trimNoise(text.slice(index, findCandidateEnd(text, index)))
  return looksLikeHostCandidate(preview)
}

function trimNoise(value) {
  let result = String(value ?? '')

  while (result && LEADING_NOISE.has(result[0])) {
    result = result.slice(1)
  }

  while (result && TRAILING_NOISE.has(result[result.length - 1])) {
    result = result.slice(0, -1)
  }

  return result
}

function validateCandidate(candidate) {
  if (!candidate) {
    return null
  }

  if (hasSupportedSchemeAt(candidate, 0)) {
    return validateAbsoluteUrl(candidate)
  }

  return validateHostBasedUrl(candidate)
}

function validateAbsoluteUrl(candidate) {
  try {
    const parsed = new URL(candidate)
    if (!SUPPORTED_PROTOCOLS.has(parsed.protocol) || !isSupportedHostname(parsed.hostname)) {
      return null
    }

    return {
      key: buildUrlKey(parsed, false),
      output: candidate,
    }
  } catch {
    return null
  }
}

function validateHostBasedUrl(candidate) {
  try {
    const parsed = new URL(`https://${candidate}`)
    if (!isSupportedHostname(parsed.hostname)) {
      return null
    }

    return {
      key: buildUrlKey(parsed, true),
      output: candidate,
    }
  } catch {
    return null
  }
}

function buildUrlKey(parsed, ignoreProtocol) {
  const protocol = ignoreProtocol ? '' : `${parsed.protocol}//`
  const port = parsed.port ? `:${parsed.port}` : ''
  return `${protocol}${parsed.hostname.toLowerCase()}${port}${parsed.pathname}${parsed.search}${parsed.hash}`
}

function looksLikeHostCandidate(candidate) {
  if (!candidate || hasSupportedSchemeAt(candidate, 0) || hasWwwPrefixAt(candidate, 0)) {
    return false
  }

  try {
    const parsed = new URL(`https://${candidate}`)
    return isSupportedHostname(parsed.hostname)
  } catch {
    return false
  }
}

function isSupportedHostname(hostname) {
  if (!hostname) {
    return false
  }

  if (hostname === 'localhost' || isIPv4(hostname)) {
    return true
  }

  if (!hostname.includes('.')) {
    return false
  }

  const labels = hostname.toLowerCase().split('.')
  const topLevelDomain = labels[labels.length - 1]
  if (!/^[a-z]{2,63}$/.test(topLevelDomain)) {
    return false
  }

  return labels.every((label) => {
    return Boolean(label) && /^[a-z0-9-]+$/i.test(label) && !label.startsWith('-') && !label.endsWith('-')
  })
}

function isIPv4(hostname) {
  const parts = hostname.split('.')
  if (parts.length !== 4) {
    return false
  }

  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) {
      return false
    }

    const value = Number(part)
    return value >= 0 && value <= 255
  })
}

function isHostCharacter(char) {
  return typeof char === 'string' && /[a-z0-9-]/i.test(char)
}

module.exports = {
  extractUrls,
}
