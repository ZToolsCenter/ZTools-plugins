import { describe, it, expect } from 'vitest'
import { parseSearch } from '../../src/lib/search-parser'

describe('parseSearch', () => {
  it('parses single free-text token', () => {
    expect(parseSearch('spring-core')).toEqual({
      kind: 'freeText',
      freeText: 'spring-core',
    })
  })

  it('parses g:a scoped query', () => {
    expect(parseSearch('org.springframework:spring-core')).toEqual({
      kind: 'scoped',
      g: 'org.springframework',
      a: 'spring-core',
    })
  })

  it('parses g:a:v fully scoped query', () => {
    expect(parseSearch('org.springframework:spring-core:6.0.0')).toEqual({
      kind: 'scoped',
      g: 'org.springframework',
      a: 'spring-core',
      v: '6.0.0',
    })
  })

  it('parses g: only prefix', () => {
    expect(parseSearch('g:org.springframework')).toEqual({
      kind: 'scoped',
      g: 'org.springframework',
    })
  })

  it('treats a: as artifactId prefix', () => {
    expect(parseSearch('a:spring-core')).toEqual({
      kind: 'scoped',
      a: 'spring-core',
    })
  })

  it('treats v: as version prefix', () => {
    expect(parseSearch('v:6.0.0')).toEqual({
      kind: 'scoped',
      v: '6.0.0',
    })
  })

  it('uses rawQuery when AND/OR/NOT is present (whole string)', () => {
    expect(
      parseSearch('g:org.springframework AND a:spring-core OR a:spring-test')
    ).toEqual({
      kind: 'rawQuery',
      rawQuery: 'g:org.springframework AND a:spring-core OR a:spring-test',
    })
  })

  it('uses rawQuery when parentheses are present', () => {
    expect(parseSearch('(g:org.springframework AND a:spring) OR a:other')).toEqual({
      kind: 'rawQuery',
      rawQuery: '(g:org.springframework AND a:spring) OR a:other',
    })
  })

  it('AND case-insensitive', () => {
    expect(parseSearch('foo and bar')).toEqual({
      kind: 'rawQuery',
      rawQuery: 'foo and bar',
    })
  })

  it('trims whitespace around tokens', () => {
    expect(parseSearch('  spring-core  ')).toEqual({
      kind: 'freeText',
      freeText: 'spring-core',
    })
  })

  it('returns empty freeText for empty input', () => {
    expect(parseSearch('')).toEqual({
      kind: 'freeText',
      freeText: '',
    })
  })

  it('returns empty freeText for whitespace-only input', () => {
    expect(parseSearch('   ')).toEqual({
      kind: 'freeText',
      freeText: '',
    })
  })

  it('does not lowercase groupId (case-sensitive)', () => {
    expect(parseSearch('Org.SpringFramework:spring-core')).toEqual({
      kind: 'scoped',
      g: 'Org.SpringFramework',
      a: 'spring-core',
    })
  })

  it('handles multiple colons in version segment', () => {
    expect(parseSearch('g:a:b:c')).toEqual({
      kind: 'scoped',
      g: 'g',
      a: 'a',
      v: 'b:c',
    })
  })
})
