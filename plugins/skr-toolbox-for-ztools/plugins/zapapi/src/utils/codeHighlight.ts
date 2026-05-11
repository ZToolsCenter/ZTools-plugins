import hljs from 'highlight.js/lib/core'
import plaintext from 'highlight.js/lib/languages/plaintext'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import csharp from 'highlight.js/lib/languages/csharp'
import php from 'highlight.js/lib/languages/php'
import ruby from 'highlight.js/lib/languages/ruby'
import bash from 'highlight.js/lib/languages/bash'
import powershell from 'highlight.js/lib/languages/powershell'
import rust from 'highlight.js/lib/languages/rust'
import kotlin from 'highlight.js/lib/languages/kotlin'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'

hljs.registerLanguage('plaintext', plaintext)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('go', go)
hljs.registerLanguage('java', java)
hljs.registerLanguage('csharp', csharp)
hljs.registerLanguage('php', php)
hljs.registerLanguage('ruby', ruby)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('powershell', powershell)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('kotlin', kotlin)
hljs.registerLanguage('c', c)
hljs.registerLanguage('cpp', cpp)

export const langMap: Record<string, string> = {
  curl: 'bash',
  wget: 'bash',
  powershell: 'powershell',
  php: 'php',
  ruby: 'ruby',
  c: 'c',
  cpp: 'cpp',
  csharp: 'csharp',
  kotlin: 'kotlin',
  rust: 'rust',
  javascript: 'javascript',
  javascriptAxios: 'javascript',
  typescriptFetch: 'typescript',
  python: 'python',
  go: 'go',
  javaOkHttp: 'java',
  ws: 'javascript',
  tcp: 'bash',
  udp: 'bash'
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function highlightCodeSync(code: string, language: string): string {
  if (!code) return ''

  const lang = langMap[language] || 'plaintext'

  try {
    const loaded = hljs.getLanguage(lang)
    if (lang !== 'plaintext' && loaded) {
      return hljs.highlight(code, { language: lang }).value
    }
    return escapeHtml(code)
  } catch {
    return escapeHtml(code)
  }
}