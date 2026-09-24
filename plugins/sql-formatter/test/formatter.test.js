import { describe, expect, it } from 'vitest'
import { extractSqlFromAction, formatSql } from '../src/formatter.js'

describe('formatSql', () => {
  it('formats SQL with uppercase keywords', () => {
    const result = formatSql('select id,name from users where active=1', {
      language: 'sql',
      keywordCase: 'upper',
      tabWidth: 2
    })

    expect(result).toContain('SELECT')
    expect(result).toMatch(/FROM\s+users/)
    expect(result).toMatch(/WHERE\s+active = 1/)
  })

  it('supports MySQL syntax', () => {
    const result = formatSql('select `id` from `users` limit 10', {
      language: 'mysql',
      keywordCase: 'upper'
    })

    expect(result).toContain('`id`')
    expect(result).toMatch(/LIMIT\s+10/)
  })

  it('preserves keyword case by default', () => {
    const result = formatSql('select id FROM users Where active=1')

    expect(result).toContain('select')
    expect(result).toContain('FROM')
    expect(result).toContain('Where')
  })

  it('rejects empty input', () => {
    expect(() => formatSql('   ')).toThrow('请先输入 SQL')
  })
})

describe('extractSqlFromAction', () => {
  it('extracts regex command payloads', () => {
    expect(extractSqlFromAction({ type: 'regex', payload: ' select 1 ' })).toBe('select 1')
  })

  it('does not treat named command text as SQL', () => {
    expect(extractSqlFromAction({ type: 'text', payload: 'SQL 格式化' })).toBe('')
  })
})
