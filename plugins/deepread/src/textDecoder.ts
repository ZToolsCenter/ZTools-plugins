type DecodedText = {
  content: string
  encoding: string
}

const CANDIDATE_ENCODINGS = ['utf-8', 'gb18030', 'gbk', 'gb2312', 'big5']

function decodeWith(bytes: Uint8Array, encoding: string, fatal = true) {
  return new TextDecoder(encoding, { fatal }).decode(bytes)
}

function countMatches(text: string, pattern: RegExp) {
  return text.match(pattern)?.length ?? 0
}

function scoreDecodedText(text: string, encoding: string) {
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
  const chinesePunctuation = countMatches(sample, /[，。！？、；：“”‘’（）《》]/g)
  const mojibakeMarks = countMatches(sample, /锟斤拷|锘|烫烫|屯屯|Ã|Â|�/g)
  const utf8AsGbMojibake = countMatches(sample, /杩欐槸|涓€|娈典|腑鏂|囧皬|璇村|唴瀹|癸紝|涓昏|璧拌|繘鎴|块棿|锛岀|湅瑙|佺獥|澶栫|殑椋|庛|绗|浠栦|鐭ラ|亾鑷|繁|鐫|氫箙|彧瑙|夊緱|鍥涘|懆瀹|夐潤|寰/g)
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

function guessUtf16(bytes: Uint8Array) {
  const sampleLength = Math.min(bytes.length, 4096)
  if (sampleLength < 8) return ''

  let evenNulls = 0
  let oddNulls = 0

  for (let index = 0; index < sampleLength; index += 1) {
    if (bytes[index] !== 0) continue
    if (index % 2 === 0) evenNulls += 1
    else oddNulls += 1
  }

  const pairs = sampleLength / 2
  if (oddNulls / pairs > 0.28 && evenNulls / pairs < 0.08) return 'utf-16le'
  if (evenNulls / pairs > 0.28 && oddNulls / pairs < 0.08) return 'utf-16be'
  return ''
}

function uniqueEncodings(encodings: string[]) {
  return [...new Set(encodings.filter(Boolean))]
}

function pickBestDecode(bytes: Uint8Array, encodings: string[], fatal: boolean) {
  let best: DecodedText | null = null
  let bestScore = Number.NEGATIVE_INFINITY

  for (const encoding of encodings) {
    try {
      const content = decodeWith(bytes, encoding, fatal)
      const score = scoreDecodedText(content, encoding)
      if (score > bestScore) {
        best = { content, encoding }
        bestScore = score
      }
    } catch (error) {
      // Unsupported labels or invalid byte sequences fall through to the next candidate.
    }
  }

  return best
}

export function decodeTextBytes(input: ArrayBuffer | Uint8Array): DecodedText {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)

  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { content: decodeWith(bytes.subarray(3), 'utf-8', false), encoding: 'utf-8-bom' }
  }

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { content: decodeWith(bytes.subarray(2), 'utf-16le', false), encoding: 'utf-16le-bom' }
  }

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { content: decodeWith(bytes.subarray(2), 'utf-16be', false), encoding: 'utf-16be-bom' }
  }

  const utf16Guess = guessUtf16(bytes)
  const encodings = uniqueEncodings([utf16Guess, ...CANDIDATE_ENCODINGS, 'utf-16le', 'utf-16be'])
  const strictDecoded = pickBestDecode(bytes, encodings, true)
  if (strictDecoded) return strictDecoded

  return pickBestDecode(bytes, encodings, false) ?? {
    content: decodeWith(bytes, 'utf-8', false),
    encoding: 'utf-8'
  }
}
