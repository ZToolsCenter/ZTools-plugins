/**
 * 百度云 OCR 适配器
 * API: https://ai.baidu.com/ai-doc/OCR/zk3h7xz52
 * 认证: OAuth2.0 Client Credentials Grant
 */

import type { OcrResult, OcrService, VendorId } from '../types'

async function getAccessToken(apiKey: string, secretKey: string): Promise<string> {
  const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${encodeURIComponent(apiKey)}&client_secret=${encodeURIComponent(secretKey)}`

  const response = await fetch(url, { method: 'POST' })
  const data = await response.json()

  if (data.error) {
    throw new Error(`百度云认证失败: ${data.error} - ${data.error_description}`)
  }

  return data.access_token
}

// 缓存 token，避免每次请求都重新获取
let cachedToken: string | null = null
let cachedApiKey: string | null = null
let cachedSecretKey: string | null = null
let tokenExpireTime = 0

async function ensureAccessToken(apiKey: string, secretKey: string): Promise<string> {
  const now = Date.now()
  if (
    cachedToken &&
    now < tokenExpireTime &&
    apiKey === cachedApiKey &&
    secretKey === cachedSecretKey
  ) {
    return cachedToken
  }
  cachedToken = await getAccessToken(apiKey, secretKey)
  tokenExpireTime = now + 25 * 24 * 60 * 60 * 1000 // token 有效期约30天，提前5天刷新
  cachedApiKey = apiKey
  cachedSecretKey = secretKey
  return cachedToken
}

export function createBaiduService(apiKey: string, secretKey: string): OcrService {
  return {
    vendorId: 'baidu' as VendorId,

    async recognize(base64Image: string): Promise<OcrResult> {
      if (!apiKey || !secretKey) {
        throw new Error('请先配置百度云 API Key 和 Secret Key')
      }

      const token = await ensureAccessToken(apiKey, secretKey)

      const formData = new URLSearchParams()
      formData.append('image', base64Image)
      formData.append('language_type', 'CHN_ENG')
      formData.append('detect_direction', 'true')
      formData.append('paragraph', 'true')
      formData.append('probability', 'true')

      const response = await fetch(
        `https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic?access_token=${token}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formData.toString()
        }
      )

      const data = await response.json()

      if (data.error_code) {
        cachedToken = null // token 可能过期，清除缓存
        throw new Error(`百度云 OCR 错误: ${data.error_code} - ${data.error_msg}`)
      }

      const words = (data.words_result || []).map((w: any) => ({
        text: w.words || '',
        confidence: (w.probability?.average || 0) / 100 || 0,
        position: w.location ? {
          x: w.location.left || 0,
          y: w.location.top || 0,
          width: w.location.width || 0,
          height: w.location.height || 0
        } : undefined
      }))

      return {
        text: words.map(w => w.text).filter(Boolean).join('\n'),
        words,
        raw: data
      }
    }
  }
}
