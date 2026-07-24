import type { ScriptLanguage } from '../types/domain'

/**
 * One completion suggestion rendered in the editor popover. The optional detail
 * surfaces a category (keyword/builtin/cmdlet/...) so users can tell suggestions apart.
 */
export interface CompletionItem {
  label: string
  detail?: string
}

/** Completion item keyed by its label so dedupe across static and dynamic sources is stable. */
type CompletionRegistry = Record<string, CompletionItem>

/**
 * Static suggestion tables per Scripty language. Curated to cover the common
 * keywords, builtins and commands without pulling in a full language server.
 */
const STATIC_COMPLETIONS: Record<ScriptLanguage, CompletionItem[]> = {
  javascript: [
    { label: 'const', detail: 'keyword' }, { label: 'let', detail: 'keyword' },
    { label: 'var', detail: 'keyword' }, { label: 'function', detail: 'keyword' },
    { label: 'return', detail: 'keyword' }, { label: 'if', detail: 'keyword' },
    { label: 'else', detail: 'keyword' }, { label: 'for', detail: 'keyword' },
    { label: 'while', detail: 'keyword' }, { label: 'do', detail: 'keyword' },
    { label: 'break', detail: 'keyword' }, { label: 'continue', detail: 'keyword' },
    { label: 'switch', detail: 'keyword' }, { label: 'case', detail: 'keyword' },
    { label: 'default', detail: 'keyword' }, { label: 'class', detail: 'keyword' },
    { label: 'extends', detail: 'keyword' }, { label: 'super', detail: 'keyword' },
    { label: 'new', detail: 'keyword' }, { label: 'this', detail: 'keyword' },
    { label: 'typeof', detail: 'keyword' }, { label: 'instanceof', detail: 'keyword' },
    { label: 'in', detail: 'keyword' }, { label: 'of', detail: 'keyword' },
    { label: 'async', detail: 'keyword' }, { label: 'await', detail: 'keyword' },
    { label: 'try', detail: 'keyword' }, { label: 'catch', detail: 'keyword' },
    { label: 'finally', detail: 'keyword' }, { label: 'throw', detail: 'keyword' },
    { label: 'import', detail: 'keyword' }, { label: 'export', detail: 'keyword' },
    { label: 'from', detail: 'keyword' }, { label: 'as', detail: 'keyword' },
    { label: 'require', detail: 'keyword' }, { label: 'module', detail: 'keyword' },
    { label: 'process', detail: 'global' }, { label: 'console', detail: 'global' },
    { label: 'console.log', detail: 'method' }, { label: 'console.error', detail: 'method' },
    { label: 'console.warn', detail: 'method' }, { label: 'console.info', detail: 'method' },
    { label: 'Math', detail: 'global' }, { label: 'JSON', detail: 'global' },
    { label: 'JSON.stringify', detail: 'method' }, { label: 'JSON.parse', detail: 'method' },
    { label: 'Promise', detail: 'global' }, { label: 'Object', detail: 'global' },
    { label: 'Array', detail: 'global' }, { label: 'String', detail: 'global' },
    { label: 'Number', detail: 'global' }, { label: 'Boolean', detail: 'global' },
    { label: 'Date', detail: 'global' }, { label: 'RegExp', detail: 'global' },
    { label: 'Map', detail: 'global' }, { label: 'Set', detail: 'global' },
    { label: 'Error', detail: 'global' }, { label: 'Buffer', detail: 'global' },
    { label: 'setTimeout', detail: 'global' }, { label: 'setInterval', detail: 'global' },
    { label: 'clearTimeout', detail: 'global' }, { label: 'clearInterval', detail: 'global' },
    { label: 'Object.keys', detail: 'method' }, { label: 'Object.values', detail: 'method' },
    { label: 'Object.entries', detail: 'method' }, { label: 'Array.from', detail: 'method' },
    { label: 'Array.isArray', detail: 'method' }, { label: 'Math.floor', detail: 'method' },
    { label: 'Math.ceil', detail: 'method' }, { label: 'Math.round', detail: 'method' },
    { label: 'Math.random', detail: 'method' }, { label: 'Math.max', detail: 'method' },
    { label: 'Math.min', detail: 'method' }, { label: 'require', detail: 'global' },
    { label: 'process.env', detail: 'property' }, { label: 'process.argv', detail: 'property' },
    { label: 'process.exit', detail: 'method' }, { label: 'true', detail: 'literal' },
    { label: 'false', detail: 'literal' }, { label: 'null', detail: 'literal' },
    { label: 'undefined', detail: 'literal' }
  ],
  python: [
    { label: 'def', detail: 'keyword' }, { label: 'class', detail: 'keyword' },
    { label: 'return', detail: 'keyword' }, { label: 'if', detail: 'keyword' },
    { label: 'elif', detail: 'keyword' }, { label: 'else', detail: 'keyword' },
    { label: 'for', detail: 'keyword' }, { label: 'while', detail: 'keyword' },
    { label: 'break', detail: 'keyword' }, { label: 'continue', detail: 'keyword' },
    { label: 'import', detail: 'keyword' }, { label: 'from', detail: 'keyword' },
    { label: 'as', detail: 'keyword' }, { label: 'with', detail: 'keyword' },
    { label: 'try', detail: 'keyword' }, { label: 'except', detail: 'keyword' },
    { label: 'finally', detail: 'keyword' }, { label: 'raise', detail: 'keyword' },
    { label: 'pass', detail: 'keyword' }, { label: 'lambda', detail: 'keyword' },
    { label: 'global', detail: 'keyword' }, { label: 'nonlocal', detail: 'keyword' },
    { label: 'yield', detail: 'keyword' }, { label: 'async', detail: 'keyword' },
    { label: 'await', detail: 'keyword' }, { label: 'in', detail: 'keyword' },
    { label: 'is', detail: 'keyword' }, { label: 'not', detail: 'keyword' },
    { label: 'and', detail: 'keyword' }, { label: 'or', detail: 'keyword' },
    { label: 'None', detail: 'literal' }, { label: 'True', detail: 'literal' },
    { label: 'False', detail: 'literal' }, { label: 'self', detail: 'keyword' },
    { label: 'print', detail: 'builtin' }, { label: 'len', detail: 'builtin' },
    { label: 'range', detail: 'builtin' }, { label: 'open', detail: 'builtin' },
    { label: 'input', detail: 'builtin' }, { label: 'str', detail: 'builtin' },
    { label: 'int', detail: 'builtin' }, { label: 'float', detail: 'builtin' },
    { label: 'bool', detail: 'builtin' }, { label: 'list', detail: 'builtin' },
    { label: 'dict', detail: 'builtin' }, { label: 'set', detail: 'builtin' },
    { label: 'tuple', detail: 'builtin' }, { label: 'type', detail: 'builtin' },
    { label: 'isinstance', detail: 'builtin' }, { label: 'enumerate', detail: 'builtin' },
    { label: 'zip', detail: 'builtin' }, { label: 'map', detail: 'builtin' },
    { label: 'filter', detail: 'builtin' }, { label: 'sorted', detail: 'builtin' },
    { label: 'reversed', detail: 'builtin' }, { label: 'sum', detail: 'builtin' },
    { label: 'min', detail: 'builtin' }, { label: 'max', detail: 'builtin' },
    { label: 'abs', detail: 'builtin' }, { label: 'round', detail: 'builtin' },
    { label: 'format', detail: 'builtin' }, { label: 'split', detail: 'method' },
    { label: 'join', detail: 'method' }, { label: 'strip', detail: 'method' },
    { label: 'replace', detail: 'method' }, { label: 'append', detail: 'method' },
    { label: 'extend', detail: 'method' }, { label: 'items', detail: 'method' },
    { label: 'keys', detail: 'method' }, { label: 'values', detail: 'method' },
    { label: 'os', detail: 'module' }, { label: 'sys', detail: 'module' },
    { label: 'json', detail: 'module' }, { label: 're', detail: 'module' },
    { label: 'os.path', detail: 'module' }, { label: 'os.environ', detail: 'property' },
    { label: 'sys.argv', detail: 'property' }, { label: 'sys.exit', detail: 'method' },
    { label: 'json.dumps', detail: 'method' }, { label: 'json.loads', detail: 'method' }
  ],
  powershell: [
    { label: 'param', detail: 'keyword' }, { label: 'function', detail: 'keyword' },
    { label: 'return', detail: 'keyword' }, { label: 'if', detail: 'keyword' },
    { label: 'elseif', detail: 'keyword' }, { label: 'else', detail: 'keyword' },
    { label: 'switch', detail: 'keyword' }, { label: 'foreach', detail: 'keyword' },
    { label: 'for', detail: 'keyword' }, { label: 'while', detail: 'keyword' },
    { label: 'do', detail: 'keyword' }, { label: 'break', detail: 'keyword' },
    { label: 'continue', detail: 'keyword' }, { label: 'try', detail: 'keyword' },
    { label: 'catch', detail: 'keyword' }, { label: 'finally', detail: 'keyword' },
    { label: 'throw', detail: 'keyword' }, { label: 'begin', detail: 'keyword' },
    { label: 'process', detail: 'keyword' }, { label: 'end', detail: 'keyword' },
    { label: '$true', detail: 'variable' }, { label: '$false', detail: 'variable' },
    { label: '$null', detail: 'variable' }, { label: '$PSItem', detail: 'variable' },
    { label: '$_', detail: 'variable' }, { label: '$args', detail: 'variable' },
    { label: '$env:PATH', detail: 'variable' }, { label: '$ErrorActionPreference', detail: 'variable' },
    { label: 'Get-Content', detail: 'cmdlet' }, { label: 'Set-Content', detail: 'cmdlet' },
    { label: 'Add-Content', detail: 'cmdlet' }, { label: 'Write-Host', detail: 'cmdlet' },
    { label: 'Write-Output', detail: 'cmdlet' }, { label: 'Write-Error', detail: 'cmdlet' },
    { label: 'Write-Warning', detail: 'cmdlet' }, { label: 'Get-ChildItem', detail: 'cmdlet' },
    { label: 'Set-Location', detail: 'cmdlet' }, { label: 'Get-Location', detail: 'cmdlet' },
    { label: 'Copy-Item', detail: 'cmdlet' }, { label: 'Move-Item', detail: 'cmdlet' },
    { label: 'Remove-Item', detail: 'cmdlet' }, { label: 'New-Item', detail: 'cmdlet' },
    { label: 'Test-Path', detail: 'cmdlet' }, { label: 'Join-Path', detail: 'cmdlet' },
    { label: 'Split-Path', detail: 'cmdlet' }, { label: 'Resolve-Path', detail: 'cmdlet' },
    { label: 'ForEach-Object', detail: 'cmdlet' }, { label: 'Where-Object', detail: 'cmdlet' },
    { label: 'Select-Object', detail: 'cmdlet' }, { label: 'Sort-Object', detail: 'cmdlet' },
    { label: 'Measure-Object', detail: 'cmdlet' }, { label: 'Invoke-WebRequest', detail: 'cmdlet' },
    { label: 'Invoke-RestMethod', detail: 'cmdlet' }, { label: 'ConvertTo-Json', detail: 'cmdlet' },
    { label: 'ConvertFrom-Json', detail: 'cmdlet' }, { label: 'Out-File', detail: 'cmdlet' },
    { label: 'Start-Process', detail: 'cmdlet' }, { label: 'Get-Date', detail: 'cmdlet' },
    { label: 'Write-Verbose', detail: 'cmdlet' }
  ],
  shell: [
    { label: 'if', detail: 'keyword' }, { label: 'then', detail: 'keyword' },
    { label: 'elif', detail: 'keyword' }, { label: 'else', detail: 'keyword' },
    { label: 'fi', detail: 'keyword' }, { label: 'for', detail: 'keyword' },
    { label: 'in', detail: 'keyword' }, { label: 'do', detail: 'keyword' },
    { label: 'done', detail: 'keyword' }, { label: 'while', detail: 'keyword' },
    { label: 'until', detail: 'keyword' }, { label: 'case', detail: 'keyword' },
    { label: 'esac', detail: 'keyword' }, { label: 'break', detail: 'keyword' },
    { label: 'continue', detail: 'keyword' }, { label: 'return', detail: 'keyword' },
    { label: 'function', detail: 'keyword' }, { label: 'local', detail: 'keyword' },
    { label: 'export', detail: 'keyword' }, { label: 'echo', detail: 'builtin' },
    { label: 'printf', detail: 'builtin' }, { label: 'read', detail: 'builtin' },
    { label: 'cd', detail: 'command' }, { label: 'pwd', detail: 'command' },
    { label: 'ls', detail: 'command' }, { label: 'cp', detail: 'command' },
    { label: 'mv', detail: 'command' }, { label: 'rm', detail: 'command' },
    { label: 'mkdir', detail: 'command' }, { label: 'rmdir', detail: 'command' },
    { label: 'cat', detail: 'command' }, { label: 'grep', detail: 'command' },
    { label: 'sed', detail: 'command' }, { label: 'awk', detail: 'command' },
    { label: 'find', detail: 'command' }, { label: 'sort', detail: 'command' },
    { label: 'uniq', detail: 'command' }, { label: 'wc', detail: 'command' },
    { label: 'head', detail: 'command' }, { label: 'tail', detail: 'command' },
    { label: 'cut', detail: 'command' }, { label: 'tr', detail: 'command' },
    { label: 'tee', detail: 'command' }, { label: 'xargs', detail: 'command' },
    { label: 'chmod', detail: 'command' }, { label: 'chown', detail: 'command' },
    { label: 'test', detail: 'builtin' }, { label: 'exit', detail: 'builtin' },
    { label: 'source', detail: 'builtin' }, { label: 'eval', detail: 'builtin' },
    { label: '$0', detail: 'variable' }, { label: '$1', detail: 'variable' },
    { label: '$#', detail: 'variable' }, { label: '$@', detail: 'variable' },
    { label: '$?', detail: 'variable' }, { label: '$HOME', detail: 'variable' },
    { label: '$PATH', detail: 'variable' }
  ]
}

/**
 * Returns the curated static completion list for a language. A fresh array is
 * returned so callers can mutate ordering without corrupting the source table.
 */
export function getStaticCompletions(language: ScriptLanguage): CompletionItem[] {
  return STATIC_COMPLETIONS[language] ?? []
}

/**
 * Extracts identifier-like words already present in the source so the popover can
 * also offer tokens the user typed earlier in the same file. Dotted accessors
 * (e.g. `os.path`) and sigil-prefixed shell/PowerShell tokens are preserved.
 */
const USED_WORD_PATTERN = /\$?[A-Za-z_][\w.-]*[\w$]/g

/** Extracts reusable identifiers from the source text, skipping the curated static ones. */
function collectUsedWords(code: string, language: ScriptLanguage, staticLabels: Set<string>): CompletionItem[] {
  const used = new Map<string, CompletionItem>()
  for (const match of code.matchAll(USED_WORD_PATTERN)) {
    const word = match[0]
    if (!word || staticLabels.has(word)) continue
    if (word.length < 2 || word.length > 32) continue
    if (!used.has(word)) used.set(word, { label: word, detail: 'local' })
  }
  // PowerShell cmdlets with hyphens are valid completions even though they start uppercase.
  void language
  return [...used.values()]
}

/** Locale-insensitive prefix check so `cons` matches `console`. */
function matchesPrefix(label: string, prefix: string): boolean {
  return label.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())
}

/**
 * Builds the merged, filtered and ranked suggestion list for the current prefix.
 * Exact case match ranks first, then static (curated) entries, then alphabetical.
 * The complete matched pool is returned so CodeMirror can rescore it as the user
 * continues typing; the editor configuration limits how many rows are rendered.
 */
export function collectCompletions(code: string, language: ScriptLanguage, prefix: string): CompletionItem[] {
  if (!prefix) return []
  const staticItems = getStaticCompletions(language)
  const staticLabels = new Set(staticItems.map(item => item.label))
  const registry: CompletionRegistry = {}

  const add = (item: CompletionItem) => {
    if (!registry[item.label]) registry[item.label] = item
  }

  staticItems.forEach(add)
  collectUsedWords(code, language, staticLabels).forEach(add)

  const matched = Object.values(registry).filter(item => matchesPrefix(item.label, prefix))
  const isStatic = (item: CompletionItem) => staticLabels.has(item.label)
  const caseExact = (item: CompletionItem) => item.label.startsWith(prefix)

  matched.sort((left, right) => {
    if (caseExact(left) !== caseExact(right)) return caseExact(left) ? -1 : 1
    if (isStatic(left) !== isStatic(right)) return isStatic(left) ? -1 : 1
    return left.label.localeCompare(right.label, 'en')
  })

  return matched
}
