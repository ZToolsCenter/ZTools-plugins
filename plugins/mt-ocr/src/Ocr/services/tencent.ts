/**
 * 腾讯云 OCR 适配器
 * API: https://cloud.tencent.com/document/api/866/33526
 * 签名: TC3-HMAC-SHA256
 */

import type { OcrResult, OcrService, VendorId } from '../types'

// ---- Web Crypto 工具函数 ----

async function sha256(message: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder()
  return crypto.subtle.digest('SHA-256', encoder.encode(message))
}

async function sha256Hex(message: string): Promise<string> {
  const hash = await sha256(message)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

async function hmacSha256(key: ArrayBuffer | string, message: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder()
  let keyData: BufferSource
  if (typeof key === 'string') {
    keyData = encoder.encode(key)
  } else {
    keyData = key
  }
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  )
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message))
}

async function hmacSha256Hex(key: ArrayBuffer | string, message: string): Promise<string> {
  const sig = await hmacSha256(key, message)
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// ---- TC3-HMAC-SHA256 签名 ----

interface TencentAuth {
  authorization: string
  timestamp: string
  host: string
}

async function generateAuthorization(
  secretId: string,
  secretKey: string,
  service: string,
  host: string,
  action: string,
  payload: string,
  region: string
): Promise<TencentAuth> {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const date = new Date(parseInt(timestamp) * 1000).toISOString().substring(0, 10)

  // Step 1: 构造规范请求串
  const httpMethod = 'POST'
  const canonicalUri = '/'
  const canonicalQueryString = ''
  const canonicalHeaders = `content-type:application/json\nhost:${host}\n`
  const signedHeaders = 'content-type;host'
  const hashedPayload = await sha256Hex(payload)
  const canonicalRequest =
    `${httpMethod}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`

  // Step 2: 构造待签名字符串
  const algorithm = 'TC3-HMAC-SHA256'
  const credentialScope = `${date}/${service}/tc3_request`
  const hashedCanonicalRequest = await sha256Hex(canonicalRequest)
  const stringToSign = `${algorithm}\n${timestamp}\n${credentialScope}\n${hashedCanonicalRequest}`

  // Step 3: 计算签名
  const secretDate = await hmacSha256('TC3' + secretKey, date)
  const secretService = await hmacSha256(secretDate, service)
  const secretSigning = await hmacSha256(secretService, 'tc3_request')
  const signature = await hmacSha256Hex(secretSigning, stringToSign)

  // Step 4: 构造 Authorization
  const authorization =
    `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  return { authorization, timestamp, host }
}

// ---- Tencent OCR Service ----

export function createTencentService(secretId: string, secretKey: string, region: string = 'ap-guangzhou'): OcrService {
  const HOST = 'ocr.tencentcloudapi.com'
  const SERVICE = 'ocr'
  const VERSION = '2018-11-19'
  const ACTION = 'GeneralBasicOCR'

  return {
    vendorId: 'tencent' as VendorId,

    async recognize(base64Image: string): Promise<OcrResult> {
      if (!secretId || !secretKey) {
        throw new Error('请先配置腾讯云 SecretId 和 SecretKey')
      }

      const payload = JSON.stringify({
        ImageBase64: base64Image
      })

      const auth = await generateAuthorization(
        secretId, secretKey, SERVICE, HOST, ACTION, payload, region
      )

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Host': HOST,
        'X-TC-Action': ACTION,
        'X-TC-Version': VERSION,
        'X-TC-Timestamp': auth.timestamp,
        'X-TC-Region': region,
        'Authorization': auth.authorization
      }

      const response = await fetch(`https://${HOST}`, {
        method: 'POST',
        headers,
        body: payload
      })

      const data = await response.json()

      if (data.Response?.Error) {
        throw new Error(`腾讯云 OCR 错误: ${data.Response.Error.Code} - ${data.Response.Error.Message}`)
      }

      const detections: any[] = data.Response?.TextDetections || []
      const words = detections.map((d: any) => ({
        text: d.DetectedText || '',
        confidence: (d.Confidence || 0) / 100,
        position: d.Polygon ? {
          x: d.Polygon[0]?.X || 0,
          y: d.Polygon[0]?.Y || 0,
          width: (d.Polygon[2]?.X || 0) - (d.Polygon[0]?.X || 0),
          height: (d.Polygon[2]?.Y || 0) - (d.Polygon[0]?.Y || 0)
        } : undefined
      }))

      return {
        text: words.map(w => w.text).filter(Boolean).join('\n'),
        words,
        raw: data.Response
      }
    }
  }
}
