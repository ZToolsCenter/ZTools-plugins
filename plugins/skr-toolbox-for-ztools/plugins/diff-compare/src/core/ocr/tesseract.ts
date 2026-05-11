import type { IOcrEngine, OcrTextItem } from './types';

/**
 * Tesseract.js OCR引擎 (v7+)
 * 纯前端JavaScript实现的OCR引擎
 */
export class TesseractOcrEngine implements IOcrEngine {
  name = 'tesseract';
  private ready = false;
  private worker: any = null;
  private language: string;

  constructor(language: string = 'eng+chi_sim') {
    // 语言代码转换
    this.language = language.replace('chi_sim+eng', 'eng+chi_sim');
  }

  async init(): Promise<void> {
    try {
      // 动态导入Tesseract.js
      const Tesseract = await import('tesseract.js');


      // Tesseract.js v7 API
      this.worker = await Tesseract.createWorker(this.language, 1, {
        logger: (m: any) => {
          // 过滤掉参数警告，只显示关键状态
          if (m.status === 'loading tesseract core') {
          } else if (m.status === 'initializing tesseract') {
          } else if (m.status === 'loading language traineddata') {
          } else if (m.status === 'initializing api') {
          } else if (m.status === 'recognizing text') {
          }
        },
      });

      this.ready = true;
    } catch (error) {
      console.error('[Tesseract] Failed to initialize:', error);
      throw error;
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  async recognize(image: ImageData | HTMLCanvasElement | string): Promise<OcrTextItem[]> {
    if (!this.worker) {
      await this.init();
    }


    try {
      const result = await this.worker.recognize(image);
      const items: OcrTextItem[] = [];


      if (result.data) {

        // Tesseract.js v7: 尝试多种方式获取文本块
        let textBlocks: any[] = [];

        // 方式1: 使用words
        if (result.data.words && result.data.words.length > 0) {
          textBlocks = result.data.words;
        }
        // 方式2: 使用lines
        else if (result.data.lines && result.data.lines.length > 0) {
          textBlocks = result.data.lines;
        }
        // 方式3: 使用paragraphs
        else if (result.data.paragraphs && result.data.paragraphs.length > 0) {
          textBlocks = result.data.paragraphs;
        }
        // 方式4: 使用symbols (字符级别)
        else if (result.data.symbols && result.data.symbols.length > 0) {
          textBlocks = result.data.symbols;
        }
        // 方式5: 从纯文本创建虚拟块
        else if (result.data.text && result.data.text.trim()) {
          const lines = result.data.text.split('\n').filter((l: string) => l.trim());
          let y = 50; // 从页面顶部50像素开始
          lines.forEach((line: string, index: number) => {
            textBlocks.push({
              text: line,
              bbox: {
                x0: 50,           // 左边距50像素
                y0: y,
                x1: 50 + line.length * 12,  // 估算宽度
                y1: y + 24        // 行高24像素
              },
              confidence: 80,
            });
            y += 30; // 行间距30像素
          });
        }

        textBlocks.forEach((block: any, index: number) => {
          const text = (block.text || block.value || '').trim();
          if (text) {
            // bbox格式可能是 {x0, y0, x1, y1} 或 {x, y, width, height}
            let bbox: { x: number; y: number; width: number; height: number };

            if (block.bbox) {
              if ('x0' in block.bbox) {
                bbox = {
                  x: block.bbox.x0,
                  y: block.bbox.y0,
                  width: (block.bbox.x1 || 0) - (block.bbox.x0 || 0),
                  height: (block.bbox.y1 || 0) - (block.bbox.y0 || 0),
                };
              } else if ('x' in block.bbox) {
                bbox = block.bbox;
              } else {
                bbox = { x: 0, y: 0, width: 100, height: 20 };
              }
            } else {
              // 没有bbox，使用默认值
              bbox = { x: 0, y: index * 25, width: text.length * 10, height: 20 };
            }

            // 确保尺寸有效
            if (bbox.width <= 0) bbox.width = text.length * 10;
            if (bbox.height <= 0) bbox.height = 20;

            items.push({
              text,
              confidence: (block.confidence || 80) / 100,
              bbox,
              pageNum: 1,
              index,
            });
          }
        });
      }

      return items;
    } catch (error) {
      console.error('[Tesseract] Recognition failed:', error);
      throw error;
    }
  }

  async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.ready = false;
    }
  }
}
