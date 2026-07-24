const fs = require('node:fs')
const path = require('node:path')
const { ipcRenderer } = require('electron')

function decodeText(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buffer.subarray(3))
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer.subarray(2))
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buffer.subarray(2))
  }

  const candidates = uniqueEncodings([guessUtf16(buffer), 'utf-8', 'gb18030', 'gbk', 'gb2312', 'big5', 'utf-16le', 'utf-16be'])
  const strictDecoded = pickBestDecode(buffer, candidates, true)
  if (strictDecoded) return strictDecoded

  return pickBestDecode(buffer, candidates, false) ?? buffer.toString('utf8')
}

function uniqueEncodings(encodings) {
  return [...new Set(encodings.filter(Boolean))]
}

function decodeWith(buffer, encoding, fatal) {
  return new TextDecoder(encoding, { fatal }).decode(buffer)
}

function countMatches(text, pattern) {
  return text.match(pattern)?.length ?? 0
}

function scoreDecodedText(text, encoding) {
  const sample = text.slice(0, 10000)
  if (!sample) return 0

  let controlChars = 0
  let nullChars = 0

  for (const char of sample) {
    const code = char.charCodeAt(0)
    if (code === 0) {
      nullChars += 1
    } else if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      controlChars += 1
    }
  }

  const replacements = countMatches(sample, /\uFFFD/g)
  const cjkChars = countMatches(sample, /[\u3400-\u9fff\uf900-\ufaff]/g)
  const commonChineseChars = countMatches(sample, /[的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说面而方后多定行学法所民]/g)
  const chinesePunctuation = countMatches(sample, /[，。！？、；：""''（）《》]/g)
  const mojibakeMarks = countMatches(sample, /锟斤拷|锘|烫烫|屯屯|Ã|Â|�/g)
  const utf8AsGbMojibake = countMatches(sample, /杩欐槸|涓€|娈典|腑鏂|囧皬|璇村|唴瀹|癸紝|涓昏|璧拌|繘鎴|块棿|锛岀|湅瑙|佺獥|澶栫|殑椋|庛|绗浠栫|鐭ラ|亾鑷|繁|鐫|氫箙|彧瑙|夊緱|鍥涘|懆瀹|夐潤|寰/g)
  const privateUseChars = countMatches(sample, /[\ue000-\uf8ff]/g)
  const asciiPrintable = countMatches(sample, /[\x20-\x7e]/g)
  const encodingBias = encoding === 'utf-8' ? 24 : encoding.startsWith('gb') ? 6 : 0

  return (
    encodingBias +
    cjkChars * 1.5 +
    commonChineseChars * 2 +
    chinesePunctuation +
    asciiPrintable * 0.04 -
    replacements * 90 -
    controlChars * 35 -
    nullChars * 110 -
    mojibakeMarks * 40 -
    utf8AsGbMojibake * 85 -
    privateUseChars * 28
  )
}

function guessUtf16(buffer) {
  const sampleLength = Math.min(buffer.length, 4096)
  if (sampleLength < 8) return ''

  let evenNulls = 0
  let oddNulls = 0

  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] !== 0) continue
    if (index % 2 === 0) evenNulls += 1
    else oddNulls += 1
  }

  const pairs = sampleLength / 2
  if (oddNulls / pairs > 0.28 && evenNulls / pairs < 0.08) return 'utf-16le'
  if (evenNulls / pairs > 0.28 && oddNulls / pairs < 0.08) return 'utf-16be'
  return ''
}

function pickBestDecode(buffer, encodings, fatal) {
  let best = ''
  let bestScore = Number.NEGATIVE_INFINITY

  for (const encoding of encodings) {
    try {
      const text = decodeWith(buffer, encoding, fatal)
      const score = scoreDecodedText(text, encoding)
      if (score > bestScore) {
        best = text
        bestScore = score
      }
    } catch (error) {
      // try next
    }
  }

  return best
}

window.services = {
  onHushreaderCommand(handler) {
    const listener = (_event, command) => handler(command)
    ipcRenderer.on('hushreader-command', listener)
    return () => ipcRenderer.off('hushreader-command', listener)
  },

  readFile(filePath) {
    return window.services.readTextFile(filePath).content
  },

  readTextFile(filePath) {
    const fullPath = path.resolve(filePath)
    const buffer = fs.readFileSync(fullPath)
    const stat = fs.statSync(fullPath)

    return {
      name: path.basename(fullPath),
      path: fullPath,
      content: decodeText(buffer),
      size: stat.size,
      mtime: stat.mtimeMs
    }
  },

  readFileBinary(filePath) {
    return fs.readFileSync(filePath)
  },

  getFileInfo(filePath) {
    const fullPath = path.resolve(filePath)
    const stat = fs.statSync(fullPath)

    return {
      name: path.basename(fullPath),
      path: fullPath,
      size: stat.size,
      mtime: stat.mtimeMs
    }
  },

  getFileModifiedTime(filePath) {
    try {
      const fullPath = path.resolve(filePath)
      const stat = fs.statSync(fullPath)
      return stat.mtimeMs
    } catch {
      return null
    }
  },

  writeTextFile(text) {
    const filePath = path.join(
      window.ztools.getPath('downloads'),
      Date.now().toString() + '.txt'
    )
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },

  writeFileToPath(filePath, content, encoding) {
    const fullPath = path.resolve(filePath)
    const dir = path.dirname(fullPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(fullPath, content, { encoding: encoding || 'utf-8' })
    return fullPath
  },

  readFileFromPath(filePath) {
    const fullPath = path.resolve(filePath)
    return fs.readFileSync(fullPath, 'utf-8')
  }
}
