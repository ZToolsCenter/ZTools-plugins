/**
 * OCR 服务工厂
 * 根据厂商配置创建相应的 OCR 服务实例
 */

import type { OcrService } from '../types'
import { createTencentService } from './tencent'
import { createBaiduService } from './baidu'
import { createAlibabaService } from './alibaba'

export { createTencentService } from './tencent'
export { createBaiduService } from './baidu'
export { createAlibabaService } from './alibaba'

export function createOcrService(
  vendorId: string,
  config: Record<string, any>
): OcrService {
  switch (vendorId) {
    case 'tencent':
      return createTencentService(
        config.secretId || '',
        config.secretKey || '',
        config.region || 'ap-guangzhou'
      )
    case 'baidu':
      return createBaiduService(
        config.apiKey || '',
        config.secretKey || ''
      )
    case 'alibaba':
      return createAlibabaService(
        config.accessKeyId || '',
        config.accessKeySecret || ''
      )
    default:
      throw new Error(`不支持的 OCR 厂商: ${vendorId}`)
  }
}

/**
 * 从完整的 OcrConfig 中创建当前选中厂商的服务
 */
export function createCurrentService(config: {
  selectedVendor: string
  vendors: Record<string, any>
}): OcrService {
  const vendorId = config.selectedVendor
  const vendorConfig = config.vendors[vendorId]
  if (!vendorConfig) {
    throw new Error(`厂商配置不存在: ${vendorId}`)
  }
  return createOcrService(vendorId, vendorConfig)
}
