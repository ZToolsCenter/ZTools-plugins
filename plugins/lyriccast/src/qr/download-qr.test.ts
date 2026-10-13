import { describe, expect, it } from 'vitest'
import { APK_DOWNLOAD_URL, buildDownloadQrSvg } from './download-qr'

describe('APK_DOWNLOAD_URL', () => {
  it('指向 GitHub Releases 最新版的固定资产 LyricCast.apk(永久重定向,不随版本变化)', () => {
    expect(APK_DOWNLOAD_URL).toBe(
      'https://github.com/Particaly/LyricCast/releases/latest/download/LyricCast.apk'
    )
  })
})

describe('buildDownloadQrSvg', () => {
  it('默认按下载地址生成 SVG 二维码', () => {
    const svg = buildDownloadQrSvg()
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.length).toBeGreaterThan(100)
  })

  it('显式传入 payload 时按 payload 生成', () => {
    expect(buildDownloadQrSvg('https://example.com/app.apk')).toContain('<svg')
  })

  it('内容超长等异常时返回空串', () => {
    expect(buildDownloadQrSvg('x'.repeat(5000))).toBe('')
  })
})
