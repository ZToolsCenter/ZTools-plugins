/**
 * @fileoverview OCR 模块入口
 * @module core/ocr/index
 * @description 提供 OCR（光学字符识别）功能的入口模块，支持 Tesseract.js 引擎
 */

export * from './types';
export { TesseractOcrEngine } from './tesseract';

import type { IOcrEngine, OcrConfig } from './types';
import { TesseractOcrEngine } from './tesseract';

/**
 * 创建 OCR 引擎实例
 * @function createOcrEngine
 * @description 根据配置创建对应的 OCR 引擎实例
 * @param {OcrConfig} config - OCR 引擎配置
 * @param {OcrConfig.engine} config.engine - 引擎类型，目前仅支持 'tesseract'
 * @param {string} [config.language] - 识别语言代码，如 'chi_sim+eng'
 * @returns {IOcrEngine} OCR 引擎实例
 * @throws {Error} 当指定的引擎类型不存在时抛出错误
 * @example
 * ```typescript
 * const engine = createOcrEngine({
 *   engine: 'tesseract',
 *   language: 'chi_sim+eng'
 * });
 * ```
 */
export function createOcrEngine(config: OcrConfig): IOcrEngine {
  switch (config.engine) {
    case 'tesseract':
      return new TesseractOcrEngine(config.language);

    default:
      throw new Error(`Unknown OCR engine: ${config.engine}`);
  }
}
