import beautifier from 'js-beautify'
import hljs from 'highlight.js'

// 语言配置：value(用户选择) -> hljs(highlight.js用) / monaco(Monaco Editor用) / label(显示名称)
export const LANGUAGES: { value: string; hljs: string; monaco: string; label: string }[] = [
  { value: 'json', hljs: 'json', monaco: 'json', label: 'JSON' },
  { value: 'yaml', hljs: 'yaml', monaco: 'yaml', label: 'YAML' },
  { value: 'html', hljs: 'xml', monaco: 'html', label: 'HTML' },
  { value: 'xml', hljs: 'xml', monaco: 'xml', label: 'XML' },
  { value: 'css', hljs: 'css', monaco: 'css', label: 'CSS' },
  { value: 'javascript', hljs: 'javascript', monaco: 'javascript', label: 'JavaScript' },
  { value: 'typescript', hljs: 'typescript', monaco: 'typescript', label: 'TypeScript' },
  { value: 'python', hljs: 'python', monaco: 'python', label: 'Python' },
  { value: 'c', hljs: 'c', monaco: 'c', label: 'C' },
  { value: 'cpp', hljs: 'cpp', monaco: 'cpp', label: 'C++' },
  { value: 'java', hljs: 'java', monaco: 'java', label: 'Java' },
  { value: 'rust', hljs: 'rust', monaco: 'rust', label: 'Rust' },
  { value: 'go', hljs: 'go', monaco: 'go', label: 'Go' },
  { value: 'sql', hljs: 'sql', monaco: 'sql', label: 'SQL' },
  { value: 'markdown', hljs: 'markdown', monaco: 'markdown', label: 'Markdown' },
  { value: 'shell', hljs: 'bash', monaco: 'shell', label: 'Shell' },
  { value: 'ruby', hljs: 'ruby', monaco: 'ruby', label: 'Ruby' },
  { value: 'php', hljs: 'php', monaco: 'php', label: 'PHP' },
  { value: 'swift', hljs: 'swift', monaco: 'swift', label: 'Swift' },
  { value: 'kotlin', hljs: 'kotlin', monaco: 'kotlin', label: 'Kotlin' },
  { value: 'csharp', hljs: 'csharp', monaco: 'csharp', label: 'C#' },
  { value: 'vue', hljs: 'xml', monaco: 'html', label: 'Vue' },
  { value: 'jsx', hljs: 'javascript', monaco: 'javascript', label: 'React (JSX)' },
  { value: 'tsx', hljs: 'typescript', monaco: 'typescript', label: 'React (TSX)' },
  { value: 'abap', hljs: 'abap', monaco: 'abap', label: 'ABAP' },
  { value: 'apex', hljs: 'apex', monaco: 'apex', label: 'Apex' },
  { value: 'azcli', hljs: 'shell', monaco: 'azcli', label: 'Azure CLI' },
  { value: 'bat', hljs: 'batch', monaco: 'bat', label: 'Batch' },
  { value: 'bicep', hljs: 'bicep', monaco: 'bicep', label: 'Bicep' },
  { value: 'cameligo', hljs: 'ocaml', monaco: 'cameligo', label: 'Cameligo' },
  { value: 'clojure', hljs: 'clojure', monaco: 'clojure', label: 'Clojure' },
  { value: 'coffee', hljs: 'coffeescript', monaco: 'coffee', label: 'CoffeeScript' },
  { value: 'csp', hljs: 'csp', monaco: 'csp', label: 'CSP' },
  { value: 'cypher', hljs: 'cypher', monaco: 'cypher', label: 'Cypher' },
  { value: 'dart', hljs: 'dart', monaco: 'dart', label: 'Dart' },
  { value: 'dockerfile', hljs: 'dockerfile', monaco: 'dockerfile', label: 'Dockerfile' },
  { value: 'ecl', hljs: 'ecl', monaco: 'ecl', label: 'ECL' },
  { value: 'elixir', hljs: 'elixir', monaco: 'elixir', label: 'Elixir' },
  { value: 'flow9', hljs: 'javascript', monaco: 'flow9', label: 'Flow9' },
  { value: 'fsharp', hljs: 'fsharp', monaco: 'fsharp', label: 'F#' },
  { value: 'freemarker2', hljs: 'freemarker', monaco: 'freemarker2', label: 'FreeMarker 2' },
  { value: 'graphql', hljs: 'graphql', monaco: 'graphql', label: 'GraphQL' },
  { value: 'handlebars', hljs: 'handlebars', monaco: 'handlebars', label: 'Handlebars' },
  { value: 'hcl', hljs: 'hcl', monaco: 'hcl', label: 'HCL' },
  { value: 'ini', hljs: 'ini', monaco: 'ini', label: 'INI' },
  { value: 'julia', hljs: 'julia', monaco: 'julia', label: 'Julia' },
  { value: 'lexon', hljs: 'lexon', monaco: 'lexon', label: 'Lexon' },
  { value: 'less', hljs: 'less', monaco: 'less', label: 'LESS' },
  { value: 'liquid', hljs: 'liquid', monaco: 'liquid', label: 'Liquid' },
  { value: 'lua', hljs: 'lua', monaco: 'lua', label: 'Lua' },
  { value: 'm3', hljs: 'm3', monaco: 'm3', label: 'M3' },
  { value: 'mdx', hljs: 'markdown', monaco: 'mdx', label: 'MDX' },
  { value: 'mips', hljs: 'mips', monaco: 'mips', label: 'MIPS' },
  { value: 'msdax', hljs: 'dax', monaco: 'msdax', label: 'MSDAX' },
  { value: 'mysql', hljs: 'sql', monaco: 'mysql', label: 'MySQL' },
  { value: 'objective-c', hljs: 'objc', monaco: 'objective-c', label: 'Objective-C' },
  { value: 'pascal', hljs: 'pascal', monaco: 'pascal', label: 'Pascal' },
  { value: 'pascaligo', hljs: 'ocaml', monaco: 'pascaligo', label: 'Pascaligo' },
  { value: 'perl', hljs: 'perl', monaco: 'perl', label: 'Perl' },
  { value: 'pgsql', hljs: 'sql', monaco: 'pgsql', label: 'PostgreSQL' },
  { value: 'pla', hljs: 'pla', monaco: 'pla', label: 'PLA' },
  { value: 'postiats', hljs: 'postiats', monaco: 'postiats', label: 'Postiats' },
  { value: 'powershell', hljs: 'powershell', monaco: 'powershell', label: 'PowerShell' },
  { value: 'powerquery', hljs: 'powerquery', monaco: 'powerquery', label: 'PowerQuery' },
  { value: 'protobuf', hljs: 'protobuf', monaco: 'protobuf', label: 'Protobuf' },
  { value: 'pug', hljs: 'pug', monaco: 'pug', label: 'Pug' },
  { value: 'qsharp', hljs: 'qsharp', monaco: 'qsharp', label: 'Q#' },
  { value: 'razor', hljs: 'cshtml', monaco: 'razor', label: 'Razor' },
  { value: 'r', hljs: 'r', monaco: 'r', label: 'R' },
  { value: 'redis', hljs: 'redis', monaco: 'redis', label: 'Redis' },
  { value: 'redshift', hljs: 'sql', monaco: 'redshift', label: 'Redshift' },
  { value: 'restructuredtext', hljs: 'rst', monaco: 'restructuredtext', label: 'reStructuredText' },
  { value: 'sb', hljs: 'sb', monaco: 'sb', label: 'SB' },
  { value: 'scala', hljs: 'scala', monaco: 'scala', label: 'Scala' },
  { value: 'scss', hljs: 'scss', monaco: 'scss', label: 'SCSS' },
  { value: 'scheme', hljs: 'scheme', monaco: 'scheme', label: 'Scheme' },
  { value: 'solidity', hljs: 'solidity', monaco: 'solidity', label: 'Solidity' },
  { value: 'sophia', hljs: 'sophia', monaco: 'sophia', label: 'Sophia' },
  { value: 'sparql', hljs: 'sparql', monaco: 'sparql', label: 'SPARQL' },
  { value: 'st', hljs: 'st', monaco: 'st', label: 'ST' },
  { value: 'systemverilog', hljs: 'systemverilog', monaco: 'systemverilog', label: 'SystemVerilog' },
  { value: 'tcl', hljs: 'tcl', monaco: 'tcl', label: 'Tcl' },
  { value: 'typespec', hljs: 'typescript', monaco: 'typespec', label: 'TypeSpec' },
  { value: 'twig', hljs: 'twig', monaco: 'twig', label: 'Twig' },
  { value: 'vb', hljs: 'vb', monaco: 'vb', label: 'Visual Basic' },
  { value: 'wgsl', hljs: 'wgsl', monaco: 'wgsl', label: 'WGSL' },
];

// hljs语言名 -> 用户选择value的映射（从LANGUAGES自动生成）
export const HLJS_TO_VALUE: Record<string, string> = Object.fromEntries(
  LANGUAGES.map(l => [l.hljs, l.value])
)

// 语言标识符 -> Monaco Editor 语言标识符的映射（从LANGUAGES自动生成）
export const VALUE_TO_MONACO: Record<string, string> = Object.fromEntries(
  LANGUAGES.map(l => [l.value, l.monaco])
)

/**
 * 将语言标识符转换为 Monaco Editor 使用的语言标识符
 * @param lang - 语言标识符
 * @returns Monaco Editor 语言标识符
 */
export function toMonacoLanguage(lang: string): string {
  return VALUE_TO_MONACO[lang.toLowerCase()] || lang.toLowerCase();
}

/**
 * Enhanced code formatter supporting multiple programming languages.
 */
export function formatCode(text: string, lang: string = 'auto'): string {
  if (!text || typeof text !== 'string') return text || ''

  const trimmed = text.trim()
  if (!trimmed) return text

  const baseOptions: beautifier.CoreBeautifyOptions = {
    indent_size: 2,
    indent_char: ' ',
    max_preserve_newlines: 2,
    preserve_newlines: true,
    end_with_newline: false,
    wrap_line_length: 0,
    indent_empty_lines: false
  }

  const jsOptions: beautifier.JSBeautifyOptions = {
    ...baseOptions,
    brace_style: 'collapse',
    keep_array_indentation: false,
    break_chained_methods: false,
    space_before_conditional: true,
    unescape_strings: false,
    jslint_happy: false,
    e4x: false,
    comma_first: false,
  }

  const htmlOptions: beautifier.HTMLBeautifyOptions = {
    ...baseOptions,
    indent_inner_html: false,
    indent_scripts: 'normal',
  }

  const cssOptions: beautifier.CSSBeautifyOptions = {
    ...baseOptions,
    newline_between_rules: true,
    selector_separator_newline: true,
  }

  const l = (lang || 'auto').toLowerCase()

  try {
    // 1. JSON (Strict)
    if (l === 'json' || (l === 'auto' && (trimmed.startsWith('{') || trimmed.startsWith('[')))) {
      try {
        const obj = JSON.parse(trimmed)
        return JSON.stringify(obj, null, 2)
      } catch (e) {
        if (l === 'json') return beautifier.js(text, jsOptions)
      }
    }

    // 2. Web Languages
    if (['html', 'xml', 'svg', 'vue'].includes(l)) {
      return beautifier.html(text, htmlOptions)
    }

    if (['css', 'scss', 'less'].includes(l)) {
      return beautifier.css(text, cssOptions)
    }

    if (['javascript', 'typescript', 'js', 'ts', 'jsx', 'tsx'].includes(l)) {
      return beautifier.js(text, jsOptions)
    }

    // 3. C-Style / Brace Languages
    if (['c', 'cpp', 'java', 'rust', 'go', 'cs', 'php', 'swift', 'kotlin'].includes(l)) {
      return beautifier.js(text, {
        ...jsOptions,
        brace_style: 'expand',
      })
    }

    // 4. SQL
    if (l === 'sql') {
      return formatSql(text)
    }

    // 5. YAML
    if (l === 'yaml' || l === 'yml') {
      return formatYaml(text)
    }

    // Heuristic detection
    if (l === 'auto') {
      if (trimmed.startsWith('<')) return beautifier.html(text, htmlOptions)
      if (text.includes('{') && text.includes('}')) return beautifier.js(text, jsOptions)
      if (text.includes('SELECT ') && text.includes(' FROM ')) return formatSql(text)
    }

  } catch (err) {
    console.warn('Formatting failed:', err)
  }

  return text
}

/**
 * Detects the programming language of a given text using highlight.js.
 */
export function detectLanguage(text: string): string {
  if (!text || typeof text !== 'string') return 'text'
  const trimmed = text.trim()
  if (!trimmed) return 'text'

  try {
    const result = hljs.highlightAuto(trimmed)
    const language = result.language
    if (language) {
      return HLJS_TO_VALUE[language] || language
    }
  } catch (e) {
    console.warn('Language detection failed:', e)
  }

  return 'text'
}

function formatSql(sql: string): string {
  const keywords = [
    'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'GROUP BY', 'ORDER BY',
    'LIMIT', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
    'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'ON', 'HAVING', 'UNION'
  ]

  let result = sql.replace(/\s+/g, ' ').trim()
  keywords.forEach(key => {
    const regex = new RegExp(`\\b${key}\\b`, 'gi')
    result = result.replace(regex, (match) => `\n${match.toUpperCase()}`)
  })

  return result
    .split('\n')
    .map(line => line.trim())
    .filter(line => line)
    .join('\n')
}

function formatYaml(text: string): string {
  return text
    .split(/\r?\n/)
    .map(line => line.replace(/\s+$/, ''))
    .join('\n')
    .trim()
}
