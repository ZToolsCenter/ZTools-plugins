import { describe, expect, test } from 'bun:test'
import { isLoginOrAccessWallText } from '../../src/services/metadataFallback'

describe('isLoginOrAccessWallText', () => {
  test('detects login / sign-in copy', () => {
    expect(isLoginOrAccessWallText('Sign in to Claude, Anthropic\'s AI assistant')).toBe(true)
    expect(isLoginOrAccessWallText('请登录后继续')).toBe(true)
    expect(isLoginOrAccessWallText('Log in to continue')).toBe(true)
    expect(isLoginOrAccessWallText('需要登录')).toBe(true)
  })

  test('detects access wall / bot challenges', () => {
    expect(isLoginOrAccessWallText('Just a moment...')).toBe(true)
    expect(isLoginOrAccessWallText('Checking your browser before accessing')).toBe(true)
    expect(isLoginOrAccessWallText('Access Denied')).toBe(true)
  })

  test('allows normal product copy', () => {
    expect(isLoginOrAccessWallText('Claude')).toBe(false)
    expect(
      isLoginOrAccessWallText(
        'Claude is a series of large language models developed by Anthropic.'
      )
    ).toBe(false)
    expect(isLoginOrAccessWallText('Anthropic 的 AI 助手')).toBe(false)
  })

  test('empty is weak', () => {
    expect(isLoginOrAccessWallText('')).toBe(true)
    expect(isLoginOrAccessWallText(null)).toBe(true)
    expect(isLoginOrAccessWallText(undefined)).toBe(true)
  })
})
