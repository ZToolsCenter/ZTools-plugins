import type { FileItem, ReplaceRule } from './session'

type Segment = { start: number; end: number }

function selectedRange(value: string, rule: ReplaceRule): Segment | null {
  const { mode, find, start, count } = rule
  if (mode === 'first' || mode === 'last') {
    if (!Number.isInteger(count) || count < 1 || count > value.length) return null
    return mode === 'first'
      ? { start: 0, end: count }
      : { start: value.length - count, end: value.length }
  }
  if (mode === 'range') {
    if (!Number.isInteger(start) || start < 1 || !Number.isInteger(count) || count < 1) return null
    const offset = start - 1
    return offset + count <= value.length ? { start: offset, end: offset + count } : null
  }
  if (!find) return null
  const at = value.indexOf(find)
  if (at < 0) return null
  if (mode === 'after') return { start: at + find.length, end: value.length }
  if (mode === 'before') return { start: 0, end: at }
  if (!Number.isInteger(count) || count < 1) return null
  if (mode === 'after-n') {
    const from = at + find.length
    return from + count <= value.length ? { start: from, end: from + count } : null
  }
  if (mode === 'before-n') return at >= count ? { start: at - count, end: at } : null
  return null
}

function applyRule(name: string, rule: ReplaceRule): string {
  if (rule.mode === 'text') {
    if (!rule.find) return name
    return name.replaceAll(rule.find, rule.replacement)
  }
  const range = selectedRange(name, rule)
  if (!range) return name
  return name.slice(0, range.start) + rule.replacement + name.slice(range.end)
}

function splitExtension(name: string): { base: string; extension: string } {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return { base: name, extension: '' }
  return { base: name.slice(0, dot), extension: name.slice(dot) }
}

export function applyReplaceRules(file: FileItem, rules: ReplaceRule[]): string {
  let name = file.currentName
  for (const rule of rules) {
    if (rule.includeExtension) {
      name = applyRule(name, rule)
      continue
    }
    const { base, extension } = splitExtension(name)
    name = applyRule(base, rule) + extension
  }
  return name
}
