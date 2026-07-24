import chroma from 'chroma-js';
import type { ColorObject } from '../types';

/**
 * 解析颜色输入,转换为标准颜色对象
 */
export function parseColor(input: string): ColorObject | null {
  try {
    const color = chroma(input);
    // chroma.js 不验证无效颜色时会抛出异常或返回特殊值

    return {
      hex: color.hex(),
      rgb: {
        r: Math.round(color.rgb()[0]),
        g: Math.round(color.rgb()[1]),
        b: Math.round(color.rgb()[2])
      },
      hsl: {
        h: Math.round(color.hsl()[0]),
        s: Math.round(color.hsl()[1] * 100),
        l: Math.round(color.hsl()[2] * 100)
      },
      hsv: {
        h: Math.round(color.hsv()[0]),
        s: Math.round(color.hsv()[1] * 100),
        v: Math.round(color.hsv()[2] * 100)
      }
    };
  } catch {
    return null;
  }
}

/**
 * HEX转RGB
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const color = parseColor(hex);
  return color ? color.rgb : null;
}

/**
 * RGB转HEX
 */
export function rgbToHex(r: number, g: number, b: number): string {
  return chroma(r, g, b).hex();
}

/**
 * HSL转HEX
 */
export function hslToHex(h: number, s: number, l: number): string {
  try {
    return chroma.hsl(h, s / 100, l / 100).hex();
  } catch {
    return chroma.hsl(h % 360, Math.min(100, Math.max(0, s)) / 100, Math.min(100, Math.max(0, l)) / 100).hex();
  }
}

/**
 * 生成颜色的浅色变体
 */
export function lightenColor(color: string, amount: number = 0.2): string {
  return chroma(color).brighten(amount * 10).hex();
}

/**
 * 生成颜色的深色变体
 */
export function darkenColor(color: string, amount: number = 0.2): string {
  return chroma(color).darken(amount * 10).hex();
}

/**
 * 生成互补色
 */
export function getComplementaryColor(color: string): string {
  const h = chroma(color).hsl()[0];
  return chroma.hsl((h + 180) % 360, chroma(color).hsl()[1], chroma(color).hsl()[2]).hex();
}

/**
 * 生成 triadic 配色(三色)
 */
export function getTriadicColors(color: string): string[] {
  const base = chroma(color);
  const hsl = base.hsl();
  return [
    base.hex(),
    chroma.hsl((hsl[0] + 120) % 360, hsl[1], hsl[2]).hex(),
    chroma.hsl((hsl[0] + 240) % 360, hsl[1], hsl[2]).hex()
  ];
}

/**
 * 生成 analogous 配色(类似色)
 */
export function getAnalogousColors(color: string, count: number = 5): string[] {
  const base = chroma(color);
  const hsl = base.hsl();
  const colors: string[] = [base.hex()];
  
  for (let i = 1; i < count; i++) {
    colors.push(chroma.hsl((hsl[0] + i * 30) % 360, hsl[1], hsl[2]).hex());
  }
  
  return colors;
}

/**
 * 生成单色系
 */
export function getMonochromaticColors(color: string, count: number = 5): string[] {
  return chroma.scale([color, '#fff']).mode('lch').colors(count);
}

/**
 * 从图片中提取主色调(简化版,实际需要Canvas处理)
 */
export async function extractColorsFromImage(imageSrc: string, count: number = 5): Promise<string[]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        resolve(['#000000']);
        return;
      }

      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const colorMap: Record<string, number> = {};

      for (let i = 0; i < data.length; i += 4 * 10) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];

        if (a < 128) continue;

        const hex = chroma(r, g, b).hex();
        colorMap[hex] = (colorMap[hex] || 0) + 1;
      }

      const sortedColors = Object.entries(colorMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, count)
        .map(([color]) => color);

      resolve(sortedColors.length > 0 ? sortedColors : ['#000000']);
    };
    img.src = imageSrc;
  });
}

/**
 * 计算两个颜色的相似度(0-1)
 */
export function getColorSimilarity(color1: string, color2: string): number {
  const c1 = chroma(color1);
  const c2 = chroma(color2);
  return 1 - chroma.deltaE(c1, c2) / 100;
}

/**
 * 判断颜色是否适合白色文字
 */
export function isLightColor(color: string): boolean {
  return chroma(color).luminance() > 0.5;
}

/**
 * 判断颜色是否为深色(Lab 亮度 < 80)
 */
export function isDarkColor(hex: string): boolean {
  return chroma(hex).get('lab.l') < 80;
}

/**
 * 根据背景色深浅返回合适的文字颜色(黑/白)
 */
export function textColorFor(hex: string): string {
  return isDarkColor(hex) ? '#fff' : '#000';
}

/**
 * 生成半透明辅助色: 深色背景用白色、浅色背景用黑色
 */
export function dimColor(hex: string, alpha: number): string {
  return isDarkColor(hex)
    ? chroma('#fff').alpha(alpha).hex()
    : chroma('#000').alpha(alpha).hex();
}

/**
 * 获取对比色(用于文字)
 */
export function getContrastColor(color: string): string {
  return isLightColor(color) ? '#000000' : '#FFFFFF';
}

/**
 * 格式化CSS渐变字符串
 */
export function formatGradient(colors: string[], angle: number = 90, type: 'linear' | 'radial' = 'linear'): string {
  if (type === 'radial') {
    return `radial-gradient(circle, ${colors.join(', ')})`; 
  }
  return `linear-gradient(${angle}deg, ${colors.join(', ')})`;
}

/**
 * 从base64生成色卡图片
 */
export function generateColorCardImage(colors: string[], width: number = 540, height: number = 270): Promise<string> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) { resolve(''); return; }
    
    const segmentWidth = width / colors.length;
    colors.forEach((color, index) => {
      ctx.fillStyle = color;
      ctx.fillRect(index * segmentWidth, 0, segmentWidth, height);
    });
    
    resolve(canvas.toDataURL('image/png'));
  });
}

/**
 * 保存色卡图片 - 使用平台 API或浏览器下载
 */
export async function saveColorCard(colors: string[]): Promise<void> {
  const base64 = await generateColorCardImage(colors);
  
  if (window.services?.saveColorCard) {
    const buffer = base64ToArrayBuffer(base64);
    await window.services.saveColorCard(buffer);
  } else {
    // 浏览器降级: 使用下载方式
    const a = document.createElement('a');
    a.href = base64;
    a.download = 'color-card.png';
    a.click();
  }
}

/**
 * base64转ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64.split(',')[1]);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * 复制图片到剪贴板
 */
export async function copyImageToClipboard(base64: string): Promise<void> {
  try {
    const response = await fetch(base64);
    const blob = await response.blob();
    await navigator.clipboard.write([
      new ClipboardItem({ [blob.type]: blob })
    ]);
  } catch {
    // 降级处理
    console.warn('Failed to copy image to clipboard');
  }
}

/**
 * 读取剪贴板中的图片
 */
export async function readClipboardImage(): Promise<string | null> {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith('image/')) {
          const blob = await item.getType(type);
          return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}
