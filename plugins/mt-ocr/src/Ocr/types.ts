// ============ 厂商配置类型 ============

export type VendorId = 'tencent' | 'baidu' | 'alibaba'

export interface VendorInfo {
  id: VendorId
  name: string
  icon: string
}

export interface TencentConfig {
  secretId: string
  secretKey: string
  region: string
}

export interface BaiduConfig {
  apiKey: string
  secretKey: string
}

export interface AlibabaConfig {
  accessKeyId: string
  accessKeySecret: string
}

export interface OcrConfig {
  selectedVendor: VendorId
  vendors: {
    tencent: TencentConfig
    baidu: BaiduConfig
    alibaba: AlibabaConfig
  }
}

// ============ 识别结果类型 ============

export interface OcrWordItem {
  text: string
  confidence: number
  position?: {
    x: number
    y: number
    width: number
    height: number
  }
}

export interface OcrResult {
  text: string
  words: OcrWordItem[]
  raw?: any
}

// ============ 服务接口 ============

export interface OcrService {
  readonly vendorId: VendorId
  recognize(base64Image: string): Promise<OcrResult>
}

// ============ 默认配置 ============

export const VENDORS: VendorInfo[] = [
  { id: 'tencent', name: '腾讯云 OCR', icon: '🔷' },
  { id: 'baidu', name: '百度云 OCR', icon: '🔶' },
  { id: 'alibaba', name: '阿里云 OCR', icon: '🟠' }
]

export function getDefaultConfig(): OcrConfig {
  return {
    selectedVendor: 'tencent',
    vendors: {
      tencent: { secretId: '', secretKey: '', region: 'ap-guangzhou' },
      baidu: { apiKey: '', secretKey: '' },
      alibaba: { accessKeyId: '', accessKeySecret: '' }
    }
  }
}
