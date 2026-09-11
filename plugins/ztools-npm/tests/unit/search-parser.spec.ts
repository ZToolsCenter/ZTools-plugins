import { describe, it, expect } from 'vitest'
import { parseSearch } from '../../src/lib/search-parser'

describe('parseSearch', () => {
  it('空输入 → freeText 空串', () => {
    expect(parseSearch('')).toEqual({ kind: 'freeText', text: '' })
    expect(parseSearch('   ')).toEqual({ kind: 'freeText', text: '' })
  })
  it('普通词 → freeText', () => {
    expect(parseSearch('vue')).toEqual({ kind: 'freeText', text: 'vue' })
    expect(parseSearch('  react hooks ')).toEqual({ kind: 'freeText', text: 'react hooks' })
  })
  it('scoped 包名（单个 @）→ package 且整串为包名', () => {
    expect(parseSearch('@vue/cli')).toEqual({ kind: 'package', name: '@vue/cli' })
  })
  it('name@version → package + versionPrefix', () => {
    expect(parseSearch('lodash@4')).toEqual({ kind: 'package', name: 'lodash', versionPrefix: '4' })
    expect(parseSearch('lodash@^4.0')).toEqual({ kind: 'package', name: 'lodash', versionPrefix: '^4.0' })
  })
  it('name@（空版本）→ 去掉版本前缀', () => {
    expect(parseSearch('lodash@')).toEqual({ kind: 'package', name: 'lodash' })
  })
  it('scoped + 版本（两个 @）→ 在最后一个 @ 处拆分', () => {
    expect(parseSearch('@vue/cli@5')).toEqual({ kind: 'package', name: '@vue/cli', versionPrefix: '5' })
  })
  it('多词含 @ → freeText（"typescript @types"）', () => {
    expect(parseSearch('typescript @types')).toEqual({ kind: 'freeText', text: 'typescript @types' })
  })
  it('空白包裹的 scoped 包名 → package', () => {
    expect(parseSearch('   @vue/cli   ')).toEqual({ kind: 'package', name: '@vue/cli' })
  })
  it('scoped + 空版本 → 去掉版本', () => {
    expect(parseSearch('@vue/cli@')).toEqual({ kind: 'package', name: '@vue/cli' })
  })
  it('裸 @ 前缀（无 /）→ freeText', () => {
    expect(parseSearch('@vue')).toEqual({ kind: 'freeText', text: '@vue' })
  })
})
