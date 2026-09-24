const ENGINE_MIRRORS = [
  'https://ghfast.top/',
  'https://ghproxy.net/',
  'https://mirror.ghproxy.com/',
  'https://gitclone.com/github.com/'
]

function resolveEngineDownloadUrls(rawUrl) {
  const url = String(rawUrl || '').trim()
  if (!url) return []
  let host = ''
  try {
    host = new URL(url).hostname
  } catch (_) {
    return [url]
  }
  if (host !== 'github.com') return [url]
  const mirrored = ENGINE_MIRRORS.map((prefix) => {
    if (prefix.includes('gitclone.com/github.com/')) {
      return prefix + url.replace(/^https?:\/\/github\.com\//, '')
    }
    return prefix + url
  })
  return mirrored.concat([url])
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'

function resumeDownloadHeaders(existingBytes) {
  const headers = {
    'User-Agent': BROWSER_UA,
    Accept: '*/*'
  }
  const n = Math.max(0, Math.floor(Number(existingBytes) || 0))
  if (n > 0) headers.Range = 'bytes=' + n + '-'
  return headers
}

function shouldResumePartial(statusCode, existingBytes) {
  return existingBytes > 0 && statusCode === 206
}

module.exports = {
  ENGINE_MIRRORS,
  resolveEngineDownloadUrls,
  resumeDownloadHeaders,
  shouldResumePartial
}
