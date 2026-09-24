import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scss from 'highlight.js/lib/languages/scss'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

const LANGUAGE_DEFINITIONS = {
  bash,
  c,
  cpp,
  css,
  go,
  java,
  javascript,
  json,
  markdown,
  php,
  python,
  ruby,
  rust,
  scss,
  sql,
  typescript,
  xml,
  yaml,
}

const LANGUAGE_ALIASES = {
  sh: 'bash',
  shell: 'bash',
  html: 'xml',
  vue: 'xml',
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  md: 'markdown',
  py: 'python',
  rb: 'ruby',
  yml: 'yaml',
}

for (const [name, definition] of Object.entries(LANGUAGE_DEFINITIONS)) hljs.registerLanguage(name, definition)

/**
 * 使用按需加载的精简语言集合高亮代码。
 * @param {unknown} source 原始代码文本。
 * @param {unknown} language Markdown 或文件卡片提供的语言名称。
 * @returns {string|null} Highlight.js 生成的安全 HTML；语言未知时返回空值。
 */
export function highlightCode(source, language) {
  const requested = String(language || '').trim().toLowerCase()
  const normalized = LANGUAGE_ALIASES[requested] || requested
  if (!normalized || !hljs.getLanguage(normalized)) return null
  return hljs.highlight(String(source || ''), { language: normalized, ignoreIllegals: true }).value
}
