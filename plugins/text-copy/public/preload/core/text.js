const { extractUrls } = require('./url-extractor')

function toInputText(value) {
  if (typeof value === 'string') {
    return value
  }

  if (value == null) {
    return ''
  }

  return String(value)
}

function createPlainCopyPayload(input) {
  return {
    text: toInputText(input),
  }
}

function createCompactCopyPayload(input) {
  const compacted = toInputText(input).match(/\S+/gu)?.join('') ?? ''
  return {
    text: compacted,
  }
}

function createLinkCopyPayload(input) {
  const links = extractUrls(toInputText(input))
  if (links.length === 0) {
    return null
  }

  return {
    text: links.join('\r\n'),
    count: links.length,
  }
}

module.exports = {
  createPlainCopyPayload,
  createCompactCopyPayload,
  createLinkCopyPayload,
}
