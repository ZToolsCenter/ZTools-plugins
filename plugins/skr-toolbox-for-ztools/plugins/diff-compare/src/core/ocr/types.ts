/**
 * @fileoverview OCR 类型定义
 * @module core/ocr/types
 * @description 定义 OCR 功能所需的接口和数据结构
 */

/**
 * OCR 文本项数据
 * @interface OcrTextItem
 * @description 表示从图像中识别出的单个文本块，包含内容和位置信息
 * @property text - 识别的文本内容
 * @property confidence - 识别置信度 (0-100)，越高表示越可靠
 * @property bbox - 文本块的边界框坐标
 * @property bbox.x - 左上角 X 坐标
 * @property bbox.y - 左上角 Y 坐标
 * @property bbox.width - 边界框宽度
 * @property bbox.height - 边界框高度
 * @property pageNum - 页码（多页文档）
 * @property index - 全局索引
 */
export interface OcrTextItem {
  text: string;
  confidence: number;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  pageNum: number;
  index: number;
}

/**
 * OCR 引擎接口
 * @interface IOcrEngine
 * @description 定义 OCR 引擎必须实现的方法
 * @property name - 引擎名称标识
 * @method recognize - 执行 OCR 识别
 * @method isReady - 检查引擎是否就绪
 * @method init - 可选的初始化方法
 */
export interface IOcrEngine {
  /** 引擎名称标识 */
  name: string;
  
  /**
   * 执行 OCR 识别
   * @param image - 待识别的图像数据
   * @returns 识别的文本项数组
   * @description 对输入图像进行 OCR 识别，返回所有识别的文本块
   */
  recognize(image: ImageData | HTMLCanvasElement | string): Promise<OcrTextItem[]>;
  
  /**
   * 检查引擎是否就绪
   * @returns 是否已完成初始化并可进行识别
   */
  isReady(): boolean;
  
  /**
   * 初始化引擎（可选）
   * @returns 初始化完成的 Promise
   * @description 某些引擎需要在首次使用前进行初始化（如加载语言模型）
   */
  init?(): Promise<void>;
}

/**
 * OCR 配置选项
 * @interface OcrConfig
 * @description 创建 OCR 引擎时的配置参数
 * @property engine - OCR 引擎类型
 * @property language - 识别语言代码（可选）
 * 
 * @example
 * ```typescript
 * const config: OcrConfig = {
 *   engine: 'tesseract',
 *   language: 'chi_sim+eng'
 * };
 * ```
 */
export interface OcrConfig {
  /** OCR 引擎类型：tesseract 或 pdfjs */
  engine: 'tesseract' | 'pdfjs';
  /** 
   * 识别语言代码
   * @description Tesseract 格式，如 'eng'、'chi_sim'、'chi_sim+eng'
   */
  language?: string;
}

/**
 * 渲染后的 PDF 页面信息
 * @interface RenderedPage
 * @description 包含渲染后的 Canvas 和页面元数据
 * @property pageNum - 页码
 * @property canvas - 渲染后的 Canvas 元素
 * @property width - 页面宽度（像素）
 * @property height - 页面高度（像素）
 */
export interface RenderedPage {
  pageNum: number;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}
