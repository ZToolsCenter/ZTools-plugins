/**
 * 代码截图应用状态管理模块
 * 管理代码内容、语言检测、主题、背景等全局状态
 */
import { ref, reactive, watch } from 'vue'
import hljs from 'highlight.js/lib/core'

// 导入 highlight.js 语言支持模块
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import java from 'highlight.js/lib/languages/java'
import csharp from 'highlight.js/lib/languages/csharp'
import cpp from 'highlight.js/lib/languages/cpp'
import c from 'highlight.js/lib/languages/c'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import ruby from 'highlight.js/lib/languages/ruby'
import php from 'highlight.js/lib/languages/php'
import swift from 'highlight.js/lib/languages/swift'
import kotlin from 'highlight.js/lib/languages/kotlin'
import scala from 'highlight.js/lib/languages/scala'
import html from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import scss from 'highlight.js/lib/languages/scss'
import json from 'highlight.js/lib/languages/json'
import yaml from 'highlight.js/lib/languages/yaml'
import sql from 'highlight.js/lib/languages/sql'
import bash from 'highlight.js/lib/languages/bash'
import powershell from 'highlight.js/lib/languages/powershell'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import markdown from 'highlight.js/lib/languages/markdown'
import graphql from 'highlight.js/lib/languages/graphql'
import xml from 'highlight.js/lib/languages/xml'
import vue from 'highlight.js/lib/languages/xml'

// 注册 highlight.js 支持的语言
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('java', java)
hljs.registerLanguage('csharp', csharp)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('c', c)
hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('ruby', ruby)
hljs.registerLanguage('php', php)
hljs.registerLanguage('swift', swift)
hljs.registerLanguage('kotlin', kotlin)
hljs.registerLanguage('scala', scala)
hljs.registerLanguage('html', html)
hljs.registerLanguage('css', css)
hljs.registerLanguage('scss', scss)
hljs.registerLanguage('json', json)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('powershell', powershell)
hljs.registerLanguage('dockerfile', dockerfile)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('graphql', graphql)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('vue', vue)

/**
 * 自动检测代码语言
 * 使用 highlight.js 的自动检测功能来确定代码的编程语言
 * @param code - 要检测的代码字符串
 * @returns 检测到的语言标识符，如果无法检测则返回 null
 */
export function detectLanguage(code: string): string | null {
  const result = hljs.highlightAuto(code, [
    'javascript', 'typescript', 'python', 'java', 'csharp', 'cpp', 'c',
    'go', 'rust', 'ruby', 'php', 'swift', 'kotlin', 'scala',
    'html', 'css', 'scss', 'json', 'yaml', 'sql', 'bash', 'powershell',
    'dockerfile', 'markdown', 'graphql', 'xml', 'vue'
  ])
  return result.language || null
}

/**
 * 支持的编程语言列表
 * 包含语言标识符和显示标签，用于语言选择器
 */
export const SUPPORTED_LANGUAGES = [
  { id: 'auto', label: '自动检测' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'python', label: 'Python' },
  { id: 'java', label: 'Java' },
  { id: 'csharp', label: 'C#' },
  { id: 'cpp', label: 'C++' },
  { id: 'c', label: 'C' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'php', label: 'PHP' },
  { id: 'swift', label: 'Swift' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'scala', label: 'Scala' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'scss', label: 'SCSS' },
  { id: 'json', label: 'JSON' },
  { id: 'yaml', label: 'YAML' },
  { id: 'sql', label: 'SQL' },
  { id: 'bash', label: 'Bash' },
  { id: 'powershell', label: 'PowerShell' },
  { id: 'dockerfile', label: 'Dockerfile' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'graphql', label: 'GraphQL' },
  { id: 'xml', label: 'XML' },
  { id: 'vue', label: 'Vue' },
  { id: 'jsx', label: 'JSX' },
  { id: 'tsx', label: 'TSX' },
  { id: 'svelte', label: 'Svelte' },
  { id: 'dart', label: 'Dart' },
  { id: 'elixir', label: 'Elixir' },
  { id: 'erlang', label: 'Erlang' },
  { id: 'haskell', label: 'Haskell' },
  { id: 'lua', label: 'Lua' },
  { id: 'perl', label: 'Perl' },
  { id: 'r', label: 'R' },
  { id: 'julia', label: 'Julia' },
  { id: 'matlab', label: 'MATLAB' },
  { id: 'objective-c', label: 'Objective-C' },
  { id: 'objective-cpp', label: 'Objective-C++' },
  { id: 'fsharp', label: 'F#' },
  { id: 'ocaml', label: 'OCaml' },
  { id: 'clojure', label: 'Clojure' },
  { id: 'haxe', label: 'Haxe' },
  { id: 'groovy', label: 'Groovy' },
  { id: 'toml', label: 'TOML' },
  { id: 'ini', label: 'INI' },
  { id: 'diff', label: 'Diff' },
  { id: 'nginx', label: 'Nginx' },
  { id: 'apache', label: 'Apache' },
  { id: 'text', label: 'Plain Text' },
]

/**
 * 语言别名映射表
 * 将常见的文件扩展名和语言别名映射到标准语言标识符
 */
export const LANGUAGE_ALIASES: Record<string, string> = {
  'ts': 'typescript',
  'js': 'javascript',
  'py': 'python',
  'rb': 'ruby',
  'rs': 'rust',
  'cs': 'csharp',
  'c++': 'cpp',
  'c#': 'csharp',
  'sh': 'bash',
  'shell': 'bash',
  'zsh': 'bash',
  'yml': 'yaml',
  'md': 'markdown',
  'docker': 'dockerfile',
  'vue-html': 'vue',
  'gradle': 'java',
  'plaintext': 'text',
  'txt': 'text',
}

/**
 * 加载代码到应用状态
 * 根据文件名自动检测语言，并设置代码内容和语言
 * @param text - 代码文本内容
 * @param filename - 可选的文件名，用于语言检测
 */
export function loadCode(text: string, filename?: string) {
  state.code = text
  if (filename) state.filename = filename

  let finalLang = state.language
  let languageSet = false

  // Attempt language detection from extension
  if (filename) {
    const extMatch = filename.match(/\.([^.]+)$/)
    if (extMatch) {
      const ext = extMatch[1].toLowerCase()
      const extMap: Record<string, string> = {
        'ts': 'typescript', 'tsx': 'typescript',
        'js': 'javascript', 'jsx': 'javascript', 'mjs': 'javascript', 'cjs': 'javascript',
        'vue': 'vue',
        'html': 'html', 'htm': 'html',
        'css': 'css', 'scss': 'scss', 'sass': 'scss', 'less': 'css',
        'java': 'java',
        'py': 'python',
        'cpp': 'cpp', 'cxx': 'cpp', 'cc': 'cpp', 'c': 'cpp', 'h': 'cpp', 'hpp': 'cpp', 'c++': 'cpp',
        'go': 'go',
        'rs': 'rust',
        'json': 'json', 'jsonc': 'json', 'json5': 'json',
        'sql': 'sql',
        'md': 'markdown', 'mdx': 'markdown',
        'rb': 'ruby',
        'php': 'php',
        'swift': 'swift',
        'kt': 'kotlin', 'kts': 'kotlin',
        'cs': 'csharp',
        'scala': 'scala',
        'sh': 'bash', 'bash': 'bash', 'zsh': 'bash',
        'ps1': 'powershell', 'psm1': 'powershell',
        'dockerfile': 'dockerfile',
        'yml': 'yaml', 'yaml': 'yaml',
        'xml': 'xml',
        'graphql': 'graphql', 'gql': 'graphql',
        'svelte': 'svelte',
        'dart': 'dart',
        'ex': 'elixir', 'exs': 'elixir',
        'erl': 'erlang',
        'hs': 'haskell',
        'lua': 'lua',
        'pl': 'perl', 'pm': 'perl',
        'r': 'r',
        'jl': 'julia',
        'm': 'matlab',
        'gradle': 'java',
        'toml': 'toml',
        'ini': 'ini',
        'diff': 'diff', 'patch': 'diff',
        'cfg': 'nginx', 'conf': 'nginx',
      }

      const mappedLangId = extMap[ext] || LANGUAGE_ALIASES[ext]
      if (mappedLangId && SUPPORTED_LANGUAGES.some(lang => lang.id === mappedLangId)) {
        finalLang = mappedLangId
        languageSet = true
      }
    }
  }

  // Auto-detect language if set to auto or no language was detected from extension
  if (finalLang === 'auto' || !languageSet) {
    const detected = detectLanguage(text)
    if (detected && SUPPORTED_LANGUAGES.some(lang => lang.id === detected)) {
      finalLang = detected
    } else if (detected && LANGUAGE_ALIASES[detected]) {
      finalLang = LANGUAGE_ALIASES[detected]
    } else if (state.language !== 'auto') {
      // Keep manual selection if not auto
    } else {
      finalLang = 'plaintext'
    }
  }

  state.language = finalLang
}

/**
 * 背景渐变样式列表
 * 提供多种预设的背景渐变效果，用于代码截图的背景
 */
export const BG_GRADIENTS = [
  // ── Originals ──────────────────────────────────────────────────────────────
  { id: 'breeze', name: 'Breeze', colors: 'linear-gradient(140deg, rgb(207, 47, 152), rgb(106, 61, 236))' },
  { id: 'candy', name: 'Candy', colors: 'linear-gradient(140deg, rgb(165, 142, 251), rgb(233, 191, 248))' },
  { id: 'crimson', name: 'Crimson', colors: 'linear-gradient(140deg, rgb(255, 99, 99), rgb(113, 27, 134))' },
  { id: 'falcon', name: 'Falcon', colors: 'linear-gradient(140deg, rgb(189, 227, 236), rgb(54, 54, 84))' },
  { id: 'meadow', name: 'Meadow', colors: 'linear-gradient(140deg, rgb(89, 212, 153), rgb(160, 253, 205))' },
  { id: 'midnight', name: 'Midnight', colors: 'linear-gradient(140deg, rgb(0, 0, 0), rgb(58, 60, 64))' },
  { id: 'sunset', name: 'Sunset', colors: 'linear-gradient(140deg, rgb(255, 207, 115), rgb(255, 122, 47))' },
  { id: 'bamboo', name: 'Bamboo', colors: 'linear-gradient(140deg, rgb(186, 217, 186), rgb(90, 169, 131))' },

  // ── Neon & Cyberpunk ───────────────────────────────────────────────────────
  { id: 'neon', name: 'Neon', colors: 'linear-gradient(140deg, rgb(0, 242, 234), rgb(79, 0, 255))' },
  { id: 'laser', name: 'Laser', colors: 'linear-gradient(140deg, rgb(255, 0, 128), rgb(0, 200, 255))' },
  { id: 'plasma', name: 'Plasma', colors: 'linear-gradient(140deg, rgb(138, 43, 226), rgb(0, 219, 200))' },
  { id: 'matrix', name: 'Matrix', colors: 'linear-gradient(140deg, rgb(0, 20, 0), rgb(0, 80, 20), rgb(0, 180, 60))' },

  // ── Aurora & Sky ───────────────────────────────────────────────────────────
  { id: 'aurora', name: 'Aurora', colors: 'linear-gradient(140deg, rgb(20, 30, 48), rgb(36, 59, 85), rgb(0, 212, 180))' },
  { id: 'nordic', name: 'Nordic', colors: 'linear-gradient(140deg, rgb(46, 52, 64), rgb(76, 86, 106), rgb(136, 192, 208))' },
  { id: 'galaxy', name: 'Galaxy', colors: 'linear-gradient(140deg, rgb(9, 9, 45), rgb(43, 0, 98), rgb(186, 0, 255))' },
  { id: 'dusk', name: 'Dusk', colors: 'linear-gradient(140deg, rgb(44, 62, 80), rgb(253, 116, 108))' },

  // ── Warm Palette ───────────────────────────────────────────────────────────
  { id: 'peach', name: 'Peach', colors: 'linear-gradient(140deg, rgb(255, 175, 189), rgb(255, 230, 175))' },
  { id: 'ember', name: 'Ember', colors: 'linear-gradient(140deg, rgb(60, 10, 10), rgb(180, 50, 20), rgb(255, 140, 60))' },
  { id: 'gold', name: 'Gold', colors: 'linear-gradient(140deg, rgb(195, 144, 28), rgb(255, 228, 130))' },
  { id: 'rose', name: 'Rose', colors: 'linear-gradient(140deg, rgb(240, 128, 128), rgb(248, 200, 220))' },

  // ── Cool & Ocean ───────────────────────────────────────────────────────────
  { id: 'ocean', name: 'Ocean', colors: 'linear-gradient(140deg, rgb(0, 119, 182), rgb(0, 180, 216), rgb(144, 224, 239))' },
  { id: 'teal', name: 'Teal', colors: 'linear-gradient(140deg, rgb(0, 77, 77), rgb(0, 188, 188))' },
  { id: 'sapphire', name: 'Sapphire', colors: 'linear-gradient(140deg, rgb(15, 32, 80), rgb(32, 80, 200))' },
  { id: 'ice', name: 'Ice', colors: 'linear-gradient(140deg, rgb(215, 235, 255), rgb(175, 215, 255))' },

  // ── Monochrome ─────────────────────────────────────────────────────────────
  { id: 'carbon', name: 'Carbon', colors: 'linear-gradient(140deg, rgb(20, 20, 20), rgb(60, 60, 60))' },
  { id: 'silver', name: 'Silver', colors: 'linear-gradient(140deg, rgb(200, 205, 215), rgb(240, 242, 245))' },
  { id: 'steel', name: 'Steel', colors: 'linear-gradient(140deg, rgb(30, 38, 50), rgb(90, 100, 115))' },
  { id: 'none', name: 'Transparent', colors: 'transparent' },
]

// 本地存储键名
const STORAGE_KEY = 'code-screenshot-settings'

/**
 * 应用状态类型定义
 * 定义代码截图工具的所有可配置状态属性
 */
type CsState = {
  /**
   * 当前代码内容
   */
  code: string
  /**
   * 文件名（用于显示和语言检测）
   */
  filename: string
  /**
   * 当前编程语言
   */
  language: string
  /**
   * 语法高亮主题
   */
  theme: string
  /**
   * 是否使用暗色模式
   */
  darkMode: boolean
  /**
   * 是否显示背景
   */
  showBackground: boolean
  /**
   * 背景渐变ID
   */
  backgroundId: string
  /**
   * 边距大小（像素）
   */
  padding: number
}

/**
 * 默认状态值
 * 应用初始化时的默认配置
 */
const defaultState: CsState = {
  code: 'console.log("Hello, World!");',
  filename: 'Untitled.ts',
  language: 'auto',
  theme: 'github-dark',
  darkMode: true,
  showBackground: true,
  backgroundId: 'breeze',
  padding: 64,
}

// 从本地存储加载保存的设置
// 支持两种存储方式：浏览器 localStorage 或 ztools 插件的 dbStorage
const savedState: CsState = JSON.parse((window.ztools ? window.ztools.dbStorage.getItem(STORAGE_KEY) : localStorage.getItem(STORAGE_KEY)) || '{}')

/**
 * 全局响应式状态
 * 包含所有应用配置，会自动持久化到本地存储
 */
export const state = reactive<CsState>({
  ...defaultState,
  ...savedState,
  // Ensure transient data isn't overwritten if we want to keep them fresh, 
  // but usually users want to resume where they left off.
  // However, for "theme", we definitely want these:
  darkMode: savedState.darkMode ?? defaultState.darkMode,
  showBackground: savedState.showBackground ?? defaultState.showBackground,
  backgroundId: savedState.backgroundId ?? defaultState.backgroundId,
  padding: savedState.padding ?? defaultState.padding,
})

// 状态持久化逻辑
// 监听状态变化并自动保存到本地存储
watch(
  () => ({
    darkMode: state.darkMode,
    showBackground: state.showBackground,
    backgroundId: state.backgroundId,
    padding: state.padding,
    language: state.language
  }),
  (val) => {
    if (window.ztools) {
      window.ztools.dbStorage.setItem(STORAGE_KEY, JSON.stringify(val))
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(val))
    }
  },
  { deep: true }
)

// 监听暗色模式变化，自动切换 Shiki 语法高亮主题
watch(() => state.darkMode, (isDark) => {
  state.theme = isDark ? 'github-dark' : 'github-light'
}, { immediate: true })
