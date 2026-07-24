/**
 * 阿里云 OCR 适配器
 * API: https://help.aliyun.com/document_detail/294261.html
 * 签名: HMAC-SHA1 (签名版本 1.0)
 */

import type { OcrResult, OcrService, VendorId } from '../types'

// ---- Web Crypto 工具 ----

async function hmacSha1(key: string, message: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(key + '&') // 阿里云签名Key需加 &
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData,
    { name: 'HMAC', hash: 'SHA-1' },
    false, ['sign']
  )
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message))
}

async function hmacSha1Base64(key: string, message: string): Promise<string> {
  const sig = await hmacSha1(key, message)
  const bytes = new Uint8Array(sig)
  let binary = ''
  bytes.forEach(b => binary += String.fromCharCode(b))
  return btoa(binary)
}

// ---- 签名 V1 工具 ----

function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
    .replace(/\+/g, '%20')
    .replace(/%7E/g, '~')
}

function generateNonce(): string {
  return Math.random().toString(36).substring(2, 15)
}

function generateTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

async function generateAliyunSignature(
  accessKeyId: string,
  accessKeySecret: string,
  params: Record<string, string>
): Promise<{ signature: string; paramsWithSignature: Record<string, string> }> {
  // Step 1: 添加公共参数
  params['Format'] = 'JSON'
  params['Version'] = '2019-12-30'
  params['AccessKeyId'] = accessKeyId
  params['SignatureMethod'] = 'HMAC-SHA1'
  params['Timestamp'] = generateTimestamp()
  params['SignatureVersion'] = '1.0'
  params['SignatureNonce'] = generateNonce()

  // Step 2: 排序并构造规范化查询字符串
  const sortedKeys = Object.keys(params).sort()
  const canonicalizedQueryString = sortedKeys
    .map(key => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join('&')

  // Step 3: 构造待签名字符串
  const stringToSign = `POST&${percentEncode('/')}&${percentEncode(canonicalizedQueryString)}`

  // Step 4: 计算签名
  const signature = await hmacSha1Base64(accessKeySecret, stringToSign)

  return {
    signature: percentEncode(signature),
    paramsWithSignature: params
  }
}

// ---- Alibaba OCR Service ----

export function createAlibabaService(accessKeyId: string, accessKeySecret: string): OcrService {
  const HOST = 'ocr-api.cn-hangzhou.aliyuncs.com'

  return {
    vendorId: 'alibaba' as VendorId,

    async recognize(base64Image: string): Promise<OcrResult> {
      if (!accessKeyId || !accessKeySecret) {
        throw new Error('请先配置阿里云 AccessKeyId 和 AccessKeySecret')
      }

      const params: Record<string, string> = {
        'Action': 'RecognizeCharacter',
        'ImageContent': base64Image,
        'OutputCharInfo': 'true',
        'OutputProbability': 'true'
      }

      const { signature, paramsWithSignature } = await generateAliyunSignature(
        accessKeyId, accessKeySecret, params
      )

      paramsWithSignature['Signature'] = signature

      const sortedKeys = Object.keys(paramsWithSignature).sort()
      const queryString = sortedKeys
        .map(key => `${percentEncode(key)}=${percentEncode(paramsWithSignature[key])}`)
        .join('&')

      const response = await fetch(`https://${HOST}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: queryString
      })

      const data = await response.json()

      if (data.Code || data.Message) {
        throw new Error(`阿里云 OCR 错误: ${data.Code || 'UNKNOWN'} - ${data.Message || '未知错误'}`)
      }

      const resultData = data.Data || data
      const chars = resultData?.CharInfo || []
      const words = chars.map((c: any) => ({
        text: c.Char || '',
        confidence: (c.Probability || 0) / 100,
        position: c.Position ? {
          x: c.Position.X || 0,
          y: c.Position.Y || 0,
          width: c.Position.W || 0,
          height: c.Position.H || 0
        } : undefined
      }))

      // 尝试按行组织文字（先稳定按 Y 排序，再归行，最后每行按 X 排序）
      const sortedByY = [...words].sort((a, b) => (a.position?.y || 0) - (b.position?.y || 0))
      const linesOfWords: (typeof words)[] = []
      for (const w of sortedByY) {
        const y = w.position?.y || 0
        let added = false
        for (const line of linesOfWords) {
          const lineY = line[0].position?.y || 0
          if (Math.abs(y - lineY) <= 5) {
            line.push(w)
            added = true
            break
          }
        }
        if (!added) linesOfWords.push([w])
      }
      const lines: string[] = []
      for (const line of linesOfWords) {
        const sortedLine = line.sort((a, b) => (a.position?.x || 0) - (b.position?.x || 0))
        lines.push(sortedLine.map(w => w.text).join(''))
      }

      return {
        text: lines.join('\n') || words.map(w => w.text).join(''),
        words,
        raw: data
      }
    }
  }
}
