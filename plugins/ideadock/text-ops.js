// ==================== 文本处理纯函数 ====================
// 从 app.js 抽出：splitWords / MORSE 码表 / ops 文本转换字典。
// 纯函数，无 DOM、无应用状态依赖。必须在 app.js 之前加载
// （app.js 会向 ops 追加 htmlFormat / zhPunctToEn 等属性）。

// 按分隔符（空格/-/_）以及大小写边界拆分单词，用于命名格式互转
function splitWords(str) {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean)
}

// 国际莫斯电码表（仅 A-Z / 0-9 / 常用标点；字母间空格分隔，单词间 " / "）
const MORSE = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....',
  I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.',
  Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
  Y: '-.--', Z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-',
  5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--',
  '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...',
  ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', '_': '..--.-',
  '"': '.-..-.', '$': '...-..-', '@': '.--.-.'
}
const MORSE_REV = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, String(k)]))

// ==================== 文本处理函数 ====================

const ops = {
  trimLines: text => text.split(/\r?\n/).map(l => l.trim()).join('\n'),

  removeEmptyLines: text => text.split(/\r?\n/).filter(l => l.trim() !== '').join('\n'),

  removeLineBreaks: text => text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).join(' '),

  sortLinesAsc: text => text.split(/\r?\n/).sort((a, b) => a.localeCompare(b)).join('\n'),

  sortLinesDesc: text => text.split(/\r?\n/).sort((a, b) => b.localeCompare(a)).join('\n'),

  dedupeLines: text => [...new Set(text.split(/\r?\n/))].join('\n'),

  addLineSpacing: text => text.split(/\r?\n/).join('\n\n'),

  addLineNumbers: text => {
    const lines = text.split(/\r?\n/)
    const nonEmpty = lines.filter(l => l.trim() !== '')
    const numberedRe = /^\d+[.、。)）]\s*/
    const allNumbered = nonEmpty.length > 0 && nonEmpty.every(l => numberedRe.test(l.trim()))
    let n = 0
    return lines.map(l => {
      if (l.trim() === '') return l
      n++
      const body = allNumbered ? l.trim().replace(numberedRe, '') : l
      return n + '. ' + body
    }).join('\n')
  },

  addBulletPoints: text => text.split(/\r?\n/).map(l => l.trim() === '' ? l : '- ' + l).join('\n'),

  removeLineNumbers: text => text.split(/\r?\n/).map(l => l.replace(/^(\d+[.、。)）]\s*|-\s+)/, '')).join('\n'),

  prependRandomEmoji: text => {
    const pool = ['✨','🔥','💯','🎉','🌟','💫','🫶','💖','🎀','🌈','😊','😍','🥰','😘','🤩','💪','👏','🌸','🌺','🌻','🍀','🌙','☀️','🍓','🧋','💎','🎊','💕','❤️','🌿','🍃','🌹','🌷','👍','🙌','🙏']
    return text.split(/\r?\n/).map(l => l.trim() === '' ? l : pool[Math.floor(Math.random() * pool.length)] + l).join('\n')
  },

  normalizeSpaces: text => text.split(/\r?\n/).map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n'),

  removeAllSpaces: text => text.replace(/[ \t]+/g, ''),

  tabToSpace: text => text.replace(/\t/g, '    '),

  // 整体缩进：所有行同步增减行首缩进（空行不补空白，避免产生纯空白行）
  indentSpace: text => text.split(/\r?\n/).map(l => l === '' ? l : ' ' + l).join('\n'),

  outdentSpace: text => text.split(/\r?\n/).map(l => l.replace(/^ /, '')).join('\n'),

  indentTab: text => text.split(/\r?\n/).map(l => l === '' ? l : '\t' + l).join('\n'),

  outdentTab: text => text.split(/\r?\n/).map(l => l.replace(/^\t/, '')).join('\n'),

  toUpperCase: text => text.toUpperCase(),

  toLowerCase: text => text.toLowerCase(),


  toHalfWidth: text => {
    let out = text.replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    out = out.replace(/　/g, ' ')
    const punctMap = {
      '“': '"', '”': '"', '‘': "'", '’': "'",
      '《': '<', '》': '>', '、': ',', '…': '...',
      '—': '-'
    }
    return out.replace(/[“”‘’《》、…—]/g, ch => punctMap[ch] || ch)
  },

  toFullWidth: text => {
    return text.replace(/[\x21-\x7E]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0xFEE0))
      .replace(/ /g, '　')
  },

  jsonFormat: text => {
    try {
      return JSON.stringify(JSON.parse(text), null, 2)
    } catch (e) {
      throw new Error('JSON 解析失败：' + e.message)
    }
  },

  jsonMinify: text => {
    try {
      return JSON.stringify(JSON.parse(text))
    } catch (e) {
      throw new Error('JSON 解析失败：' + e.message)
    }
  },

  base64Encode: text => {
    const bytes = new TextEncoder().encode(text)
    let binary = ''
    bytes.forEach(b => { binary += String.fromCharCode(b) })
    return btoa(binary)
  },

  base64Decode: text => {
    try {
      const binary = atob(text)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      return new TextDecoder().decode(bytes)
    } catch (e) {
      throw new Error('Base64 解码失败：' + e.message)
    }
  },

  urlEncode: text => encodeURIComponent(text),

  urlDecode: text => {
    try {
      return decodeURIComponent(text)
    } catch (e) {
      throw new Error('URL 解码失败：' + e.message)
    }
  },

  unicodeEscape: text => text.replace(/[^\x00-\x7F]/g, ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')),

  unicodeUnescape: text => text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))),

  morseEncode: text => {
    const upper = text.toUpperCase()
    const bad = [...new Set([...upper].filter(ch => !/\s/.test(ch) && !MORSE[ch]))]
    if (bad.length) throw new Error('以下字符无标准莫斯码，无法编码：' + bad.join(' '))
    return upper.trim().split(/\s+/)
      .map(w => [...w].map(c => MORSE[c]).join(' '))
      .join(' / ')
  },

  morseDecode: text => text.trim().split(/\s*\/\s*/).filter(w => w.trim())
    .map(w => w.trim().split(/\s+/).map(c => MORSE_REV[c] || '?').join(''))
    .join(' '),

  capitalizeWords: text => text.replace(/\b\w/g, c => c.toUpperCase()),

  toCamelCase: text => text.split(/\r?\n/).map(line => {
    const words = splitWords(line)
    if (words.length === 0) return line
    return words.map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('')
  }).join('\n'),

  toSnakeCase: text => text.split(/\r?\n/).map(line => {
    const words = splitWords(line)
    if (words.length === 0) return line
    return words.map(w => w.toLowerCase()).join('_')
  }).join('\n'),

  toKebabCase: text => text.split(/\r?\n/).map(line => {
    const words = splitWords(line)
    if (words.length === 0) return line
    return words.map(w => w.toLowerCase()).join('-')
  }).join('\n'),

  // 按逗号/空格/换行拆分，尊重引号和括号，保留 item 原始形态（不加引号）
  jsonToArray: text => {
    const items = []
    let cur = '', inQuote = null, depth = 0
    for (const ch of text.trim()) {
      if (inQuote) {
        cur += ch
        if (ch === inQuote) inQuote = null
      } else if (ch === '"' || ch === "'") {
        inQuote = ch; cur += ch
      } else if (ch === '{' || ch === '[' || ch === '(') {
        depth++; cur += ch
      } else if (ch === '}' || ch === ']' || ch === ')') {
        depth--; cur += ch
      } else if (depth === 0 && (ch === ',' || ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t')) {
        if (cur.trim()) { items.push(cur.trim()); cur = '' }
      } else {
        cur += ch
      }
    }
    if (cur.trim()) items.push(cur.trim())
    return '[' + items.join(', ') + ']'
  },

  // 每行末尾补逗号（最后一个非空行除外），整体加 {} 包裹
  jsonWrapObject: text => {
    const t = text.trim()
    if (!t) return '{}'
    const lines = t.split('\n')
    let lastIdx = lines.length - 1
    while (lastIdx > 0 && !lines[lastIdx].trim()) lastIdx--
    const out = lines.map((l, i) => {
      const ind = '  ' + l
      if (!l.trim() || i === lastIdx || l.trimEnd().endsWith(',')) return ind
      return ind + ','
    })
    return '{\n' + out.join('\n') + '\n}'
  },

  jsonUnwrap: text => {
    const t = text.trim()
    if ((t.startsWith('[') && t.endsWith(']')) || (t.startsWith('{') && t.endsWith('}'))) {
      return t.slice(1, -1).trim()
    }
    return text
  },

  jsonToYaml: text => {
    try {
      const obj = JSON.parse(text)
      if (typeof jsyaml === 'undefined') throw new Error('js-yaml 库未加载')
      return jsyaml.dump(obj, { indent: 2, lineWidth: -1 }).replace(/\n$/, '')
    } catch (e) {
      throw new Error('转换失败：' + e.message)
    }
  },

  yamlToJson: text => {
    try {
      if (typeof jsyaml === 'undefined') throw new Error('js-yaml 库未加载')
      const obj = jsyaml.load(text)
      return JSON.stringify(obj, null, 2)
    } catch (e) {
      throw new Error('转换失败：' + e.message)
    }
  }
}
