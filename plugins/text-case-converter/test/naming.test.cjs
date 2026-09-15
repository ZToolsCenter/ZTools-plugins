const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
  toTitleCase,
  toCamelCase,
  toPascalCase,
  toSnakeCase,
  toScreamingSnakeCase,
  hasConvertibleNaming,
} = require('../dist/naming.js')

describe('naming pure english', () => {
  it('clearIdleKillTimer round-trip styles', () => {
    const src = 'clearIdleKillTimer'
    assert.equal(toTitleCase(src), 'Clear Idle Kill Timer')
    assert.equal(toCamelCase(src), 'clearIdleKillTimer')
    assert.equal(toPascalCase(src), 'ClearIdleKillTimer')
    assert.equal(toSnakeCase(src), 'clear_idle_kill_timer')
    assert.equal(toScreamingSnakeCase(src), 'CLEAR_IDLE_KILL_TIMER')
  })

  it('IDLE_KILL_MS to title and camel', () => {
    assert.equal(toTitleCase('IDLE_KILL_MS'), 'Idle Kill Ms')
    assert.equal(toCamelCase('IDLE_KILL_MS'), 'idleKillMs')
    assert.equal(toPascalCase('IDLE_KILL_MS'), 'IdleKillMs')
    assert.equal(toSnakeCase('IDLE_KILL_MS'), 'idle_kill_ms')
  })

  it('title to camel', () => {
    assert.equal(toCamelCase('Clear Idle Kill Timer'), 'clearIdleKillTimer')
    assert.equal(toCamelCase('Text Case Converter'), 'textCaseConverter')
  })

  it('snake to pascal', () => {
    assert.equal(toPascalCase('text_case_converter'), 'TextCaseConverter')
  })

  it('XMLHttpRequest split', () => {
    assert.equal(toTitleCase('XMLHttpRequest'), 'Xml Http Request')
    assert.equal(toCamelCase('XMLHttpRequest'), 'xmlHttpRequest')
  })

  it('idempotent camel', () => {
    assert.equal(toCamelCase('textCaseConverter'), 'textCaseConverter')
  })

  it('preserves leading and trailing whitespace', () => {
    assert.equal(toCamelCase('  text_case_converter\n'), '  textCaseConverter\n')
    assert.equal(toSnakeCase('\tTextCaseConverter  '), '\ttext_case_converter  ')
    assert.equal(toTitleCase('\nclearIdleKillTimer\r\n'), '\nClear Idle Kill Timer\r\n')
  })
})

describe('naming separators and chinese', () => {
  it('outer symbol separators', () => {
    assert.equal(toCamelCase('user-name_info'), 'user-nameInfo')
    assert.equal(toTitleCase('user-name_info'), 'User-Name Info')
    assert.equal(toSnakeCase('foo.barBaz'), 'foo.bar_baz')
  })

  it('chinese as snake word', () => {
    assert.equal(toSnakeCase('user名称Name'), 'user_名称_name')
    assert.equal(toScreamingSnakeCase('user名称Name'), 'USER_名称_NAME')
    assert.equal(toSnakeCase('text转换Converter'), 'text_转换_converter')
  })

  it('chinese as camel-family separator', () => {
    assert.equal(toCamelCase('hello世界world'), 'hello世界world')
    assert.equal(toPascalCase('user名称Name'), 'User名称Name')
    assert.equal(toTitleCase('获取UserID'), '获取User Id')
  })
})

describe('naming guards', () => {
  it('hasConvertibleNaming', () => {
    assert.equal(hasConvertibleNaming('abc'), true)
    assert.equal(hasConvertibleNaming('中文'), true)
    assert.equal(hasConvertibleNaming('---'), false)
    assert.equal(hasConvertibleNaming(''), false)
  })
})
