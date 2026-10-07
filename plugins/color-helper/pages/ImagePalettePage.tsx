import React, { Component, createRef, useState, useMemo, useEffect, useRef, useCallback } from 'react';
import Card from '@mui/material/Card';
import Tooltip from '@mui/material/Tooltip';
import Fab from '@mui/material/Fab';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import CircularProgress from '@mui/material/CircularProgress';
import CloseIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import ClearIcon from '@mui/icons-material/Clear';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import CropIcon from '@mui/icons-material/Crop';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import chroma from 'chroma-js';
import { isDarkColor } from '../utils/color';
import { quantize } from '../utils/quantize';
import { screenCapture, aiChat, isAIAvailable } from '../utils/platform';

// 导入模板封面图
import cover01 from '../assets/color-card-01.jpg';
import cover02 from '../assets/color-card-02.jpg';
import cover03 from '../assets/color-card-03.jpg';
import cover04 from '../assets/color-card-04.jpg';

/**
 * ImagePalettePage - 图片取色页面
 * 
 * 核心功能:
 * - 从图片中提取主色和配色方案(基于 Median Cut 量化算法)
 * - 生成 AI 色卡(多种模板、AI 命名、导出图片)
 * - 支持文件选择和屏幕截图两种图片来源
 */

/** RGB 数组 → HEX 字符串 */
function rgbToHex(rgb: number[]): string {
  return '#' + rgb.map(v => {
    const hex = v.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

/** 创建 canvas 获取图片像素数据 */
function getImageData(img: HTMLImageElement): ImageData {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * 像素过滤函数
 * 过滤规则: alpha < 125 的跳过(透明像素), RGB 均 > 250 的跳过(接近白色)
 * @param quality 采样间隔，值越大采样越稀疏
 */
function filterPixels(data: Uint8ClampedArray, totalPixels: number, quality: number): number[][] {
  const pixels: number[][] = [];
  for (let i = 0; i < totalPixels; i += quality) {
    const offset = 4 * i;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const a = data[offset + 3];
    // alpha 检查: undefined 或 >= 125
    if (a !== undefined && a < 125) continue;
    // 跳过接近白色的像素
    if (r > 250 && g > 250 && b > 250) continue;
    pixels.push([r, g, b]);
  }
  return pixels;
}

/** 提取图片主色(取配色方案的第一项) */
function getColor(img: HTMLImageElement, quality: number = 10): number[] | null {
  const palette = getPalette(img, 5, quality);
  return palette ? palette[0] : null;
}

/**
 * 提取图片配色方案
 * @param colorCount 颜色数量(2-20)，默认10
 * @param quality 采样间隔，默认10
 */
function getPalette(img: HTMLImageElement, colorCount?: number, quality?: number): number[][] | null {
  let count = colorCount;
  let q = quality;
  if (count !== undefined && Number.isInteger(count)) {
    if (count === 1) throw new Error('colorCount should be between 2 and 20');
    count = Math.max(count, 2);
    count = Math.min(count, 20);
  } else {
    count = 10;
  }
  if (q === undefined || !Number.isInteger(q) || q < 1) {
    q = 10;
  }

  const imageData = getImageData(img);
  const pixels = filterPixels(imageData.data, imageData.width * imageData.height, q);
  const cmap = quantize(pixels, count);
  return cmap ? cmap.palette() : null;
}

/**
 * 从图片中提取主色和配色
 * 主色: 取样粗一些(quality 10)取 5 色的首个, 作为整图的代表色
 * 配色: 取样细一些取 10 色, 排除主色后的列表
 */
function extractColorsFromImage(img: HTMLImageElement): { mainColor: string; paletteColors: string[] } | null {
  try {
    const mainRgb = getColor(img, 10);
    const paletteRgbs = getPalette(img);

    if (!mainRgb) return null;

    const mainColor = rgbToHex(mainRgb);
    const paletteColors = paletteRgbs
      ? paletteRgbs.map(rgb => rgbToHex(rgb)).filter(c => c !== mainColor)
      : [];

    return { mainColor, paletteColors };
  } catch {
    return null;
  }
}

/** AI 名称缓存，避免重复调用 */
const nameCache = new Map<string, string>();

/**
 * AI 色卡名称生成 Hook
 * 调用 AI 根据颜色值生成文艺名称，支持缓存和自动生成
 * @param color 颜色 HEX 值
 * @param style 命名风格，默认"文艺优雅"
 * @param nameLength 名称字数，默认4
 * @param autoGenerate 是否在挂载时自动生成
 *
 * status 表示名字是否已经有定论: idle 是"还没开始", loading 中,
 * done / error 都算"有定论了" —— 调用方要等它落定再开始画图,
 * 否则会先画一版占位名。
 */
type NameStatus = 'idle' | 'loading' | 'done' | 'error';

function useGenerateName(color: string, style: string = '文艺优雅', nameLength: number = 4, autoGenerate: boolean = false) {
  const [name, setName] = useState('');
  const [status, setStatus] = useState<NameStatus>('idle');
  const [error, setError] = useState('');

  const cacheKey = useMemo(() => color + style + nameLength, [color, style, nameLength]);
  const isMounted = useRef(true);
  const latestCacheKey = useRef(cacheKey);

  useEffect(() => {
    isMounted.current = true;
    latestCacheKey.current = cacheKey;
    return () => {
      isMounted.current = false;
    };
  }, [cacheKey]);

  const generateName = useCallback((excludeName?: string) => {
    const ai = isAIAvailable();
    if (!ai) {
      setError('当前版本不支持 AI 功能');
      setStatus('error');
      return;
    }

    const systemPrompt = `
# 角色
你是颜色命名大师，给颜色起好听的名字。

# 任务
给用户给出的颜色起一个名字，要求：
- 名字恰好 ${nameLength} 个汉字
- 风格${style}
${excludeName ? `- 不能是${excludeName}\n` : ''}
# 输出格式
只输出名字本身，不要引号、标点、解释或代码块标记。

# 示例
暮色青岚
`;

    // 记下发起时的 key, 回调里对比它判断这次结果是否已经过期
    const target = cacheKey;
    setStatus('loading');
    setName('');
    setError('');

    aiChat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `颜色: ${color}` },
    ]).then(result => {
      if (!isMounted.current || target !== latestCacheKey.current) return;
      // ai() 返回的 content 是可选字段, 缺失时按空串处理
      const next = result.content ?? '';
      setName(next);
      setStatus('done');
      // 只在非"重新生成"时写缓存, 否则换过的名字会污染下次打开弹窗的命中结果
      if (!excludeName) nameCache.set(target, next);
    }).catch(() => {
      if (!isMounted.current || target !== latestCacheKey.current) return;
      setError('AI 调用异常');
      setStatus('error');
    });
  }, [style, nameLength, color, cacheKey]);

  // 自动生成
  useEffect(() => {
    if (!autoGenerate || !color) return;

    const cached = nameCache.get(cacheKey);
    if (cached !== undefined) {
      setName(cached);
      setStatus('done');
      return;
    }

    generateName();
  }, [cacheKey, color, autoGenerate, generateName]);

  return { name, status, error, generateName };
}

/** 色卡模板定义: id/尺寸/封面图 */
interface TemplateDef {
  id: string;
  sizes: number | [number, number];
  cover: string;
}

const TEMPLATES: TemplateDef[] = [
  { id: '01', sizes: 1200, cover: cover01 },
  { id: '02', sizes: 1200, cover: cover02 },
  { id: '03', sizes: [1200 * 3 / 4, 1200], cover: cover03 },
  { id: '04', sizes: [1800 * 9 / 16, 1800], cover: cover04 },
];

/** 获取模板的画布尺寸 [宽, 高] */
function getTemplateSize(template: TemplateDef): [number, number] {
  if (Array.isArray(template.sizes)) {
    const [w = 1200, h = w] = template.sizes;
    return [w, h];
  }
  return [template.sizes, template.sizes];
}

/**
 * 色卡 Canvas 渲染
 * 四个模板分别对应一种版式: 01 右下横向色块 / 02 底部全宽等分 / 03 左上竖排圆形 / 04 白底内缩留白, 上 3/4 图片 + 下方居左名称与色块
 * 背景图一律 cover: 01-03 铺满整张卡片, 04 只铺内容区上 3/4
 * 主色铺底兜住没有背景图的情况, 04 用白底
 *
 * withText=false 时只画背景与色块(供 UI 里的占位预览用), 不画任何文字
 */
function renderColorCard(
  canvas: HTMLCanvasElement,
  options: {
    bgImage: HTMLImageElement | null;
    primaryColor: string;
    paletteColors: string[];
    name: string;
    templateId: string;
    withText?: boolean;
  }
) {
  const { bgImage, primaryColor, paletteColors, name, templateId, withText = true } = options;
  const template = TEMPLATES.find(t => t.id === templateId) || TEMPLATES[0];
  const [w, h] = getTemplateSize(template);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // 所有尺寸按卡片宽度的百分比取(q = 1cqw), 换画布比例时元素占比不变
  const q = (v: number) => (w * v) / 100;

  /** 把背景图 cover 画进指定矩形, 超出部分裁掉 */
  const drawCover = (x: number, y: number, boxW: number, boxH: number) => {
    if (!bgImage) return;
    const scale = Math.max(boxW / bgImage.width, boxH / bgImage.height);
    const dw = bgImage.width * scale;
    const dh = bgImage.height * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, boxW, boxH);
    ctx.clip();
    ctx.drawImage(bgImage, x + (boxW - dw) / 2, y + (boxH - dh) / 2, dw, dh);
    ctx.restore();
  };

  // 通用渲染：背景色填充, 04 是白底
  ctx.fillStyle = templateId === '04' ? '#fff' : primaryColor;
  ctx.fillRect(0, 0, w, h);

  // 背景图（如果有）
  if (bgImage) {
    if (templateId === '01') {
      // 01: 图片整幅 cover 铺满
      const scale = Math.max(w / bgImage.width, h / bgImage.height);
      const dw = bgImage.width * scale;
      const dh = bgImage.height * scale;
      ctx.drawImage(bgImage, (w - dw) / 2, (h - dh) / 2, dw, dh);

      // 底部 1/4 纯色阻挡, 上缘一小段渐变过渡
      const bandTop = (h * 3) / 4;
      const grad = ctx.createLinearGradient(0, bandTop, 0, bandTop + h * 0.08);
      grad.addColorStop(0, chroma(primaryColor).alpha(0.01).hex());
      grad.addColorStop(0.1, chroma(primaryColor).alpha(0.5).hex());
      grad.addColorStop(0.25, primaryColor);
      grad.addColorStop(1, primaryColor);
      ctx.fillStyle = grad;
      ctx.fillRect(0, bandTop, w, h - bandTop);
    } else if (templateId === '02') {
      // 02: 图片整幅 cover 铺满
      const scale = Math.max(w / bgImage.width, h / bgImage.height);
      const dw = bgImage.width * scale;
      const dh = bgImage.height * scale;
      ctx.drawImage(bgImage, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } else if (templateId === '03') {
      // 图片 cover 填充
      const scale = Math.max(w / bgImage.width, h / bgImage.height);
      const dw = bgImage.width * scale;
      const dh = bgImage.height * scale;
      ctx.drawImage(bgImage, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } else if (templateId === '04') {
      // 04: 内容整体内缩留白, 图片铺满内容区上方 3/4
      const inset = q(6);
      const contentW = w - inset * 2;
      const contentH = h - inset * 2;
      drawCover(inset, inset, contentW, contentH * 0.75);
    }
  }

  // 配色色块。四个模板版式不同, 文字统一走 label(),
  // 占位预览(withText=false)时只出色块
  const label = (value: string, x: number, y: number) => {
    if (withText) ctx.fillText(value, x, y);
  };
  /** 该模板要显示的色: 主色在前, 再补配色; 配色为空时只显示主色 */
  const pick = (n: number) => [primaryColor, ...paletteColors].slice(0, n);

  /** 色块内色值的颜色: 深色块用白字, 浅色块用深字 */
  const hexOn = (color: string) => (isDarkColor(color) ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.75)');

  // 字号一律由它要放的槽位反推, 保证"字号变大 + 槽位固定"时文字还能缩回去
  // 文本框按 'M' 量, 比按平均字宽估更保守
  let measureCtx: CanvasRenderingContext2D | null = null;
  const textW = (text: string, font: string): number => {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')!;
    measureCtx.font = font;
    return measureCtx.measureText(text).width;
  };
  /** 在 [min,max] 内找能塞进 maxW 的最大字号; 连 min 都放不下时返回 0, 由调用方跳过不写 */
  const fitFont = (text: string, weight: string, maxW: number, min: number, max: number): number => {
    if (maxW <= 0) return 0;
    const fontAt = (size: number) => weight ? `${weight} ${size}px sans-serif` : `${size}px sans-serif`;
    if (textW(text, fontAt(max)) <= maxW) return max;
    let lo = 0;
    let hi = max;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (textW(text, fontAt(mid)) <= maxW) lo = mid;
      else hi = mid;
    }
    return lo >= min ? lo : 0;
  };

  const shadowOn = () => {
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = q(1);
  };
  const shadowOff = () => { ctx.shadowBlur = 0; };

  if (templateId === '01') {
    // 01 右下角矩形色块组, 整组对齐右下角
    // 名称在左侧、顶部与色块组齐平
    const colors = pick(5);
    const gap = q(1);
    const blockH = q(16);
    const margin = q(4);
    const widths = colors.map((_, i) => (i === 0 ? q(12) : q(9)));
    const totalW = widths.reduce((a, b) => a + b, 0) + gap * (colors.length - 1);
    const groupX = w - margin - totalW;
    const groupY = h - margin - blockH;

    let x = groupX;
    colors.forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.fillRect(x, groupY, widths[i], blockH);
      // 主色块不写色号, 只让配色块带自己的值
      if (i > 0) {
        const text = color.toUpperCase();
        const size = fitFont(text, '', widths[i] - q(1.2), q(0.5), q(2.5));
        if (size > 0) {
          ctx.fillStyle = hexOn(color);
          ctx.font = `${size}px sans-serif`;
          ctx.textAlign = 'center';
          label(text, x + widths[i] / 2, groupY + blockH / 2 + size / 3);
        }
      }
      x += widths[i] + gap;
    });

    if (withText) {
      const nameText = name || '配色方案';
      const nameMax = groupX - margin - q(2);
      const nameSize = fitFont(nameText, 'bold', nameMax, q(1.6), q(3.2));
      if (nameSize > 0) {
        shadowOn();
        ctx.textAlign = 'left';
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${nameSize}px sans-serif`;
        ctx.fillText(nameText, margin, groupY + nameSize * 0.8);

        // 主色号跟在名称下面
        const hexSize = fitFont(primaryColor.toUpperCase(), '', nameMax, q(0.8), nameSize * 0.5);
        if (hexSize > 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.75)';
          ctx.font = `${hexSize}px sans-serif`;
          ctx.fillText(primaryColor.toUpperCase(), margin, groupY + nameSize * 0.8 + hexSize * 1.6);
        }
        shadowOff();
      }
    }
  } else if (templateId === '02') {
    // 02 底部全宽等分矩形: 色值内嵌居中, 名称左上角
    const colors = pick(6);
    const blockH = q(10);
    const blockW = w / colors.length;
    const blockY = h - blockH;

    colors.forEach((color, i) => {
      const text = color.toUpperCase();
      const x = i * blockW;
      const size = fitFont(text, '', blockW - q(1.2), q(0.5), q(2.5));
      ctx.fillStyle = color;
      ctx.fillRect(x, blockY, blockW, blockH);
      if (size > 0) {
        ctx.fillStyle = '#fff';
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = q(0.2);
        ctx.font = `${size}px sans-serif`;
        ctx.textAlign = 'center';
        label(text, x + blockW / 2, blockY + blockH / 2 + size / 3);
        shadowOff();
      }
    });

    if (withText) {
      const nameText = name || '配色方案';
      const nameSize = fitFont(nameText, 'bold', w - q(8), q(1.4), q(2.5));
      shadowOn();
      ctx.fillStyle = '#fff';
      if (nameSize > 0) {
        ctx.font = `bold ${nameSize}px sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText(nameText, q(4), q(4) + nameSize);
      }
      shadowOff();
    }
  } else if (templateId === '03') {
    // 03 左上竖排圆形: 色值内嵌圆中, 名称在左下角
    // 圆组的顶部距离与名称的底部距离取同一个值, 上下对称
    const colors = pick(3);
    const gap = q(3);
    const d = q(9.6);
    const step = d + gap;
    const margin = q(6);
    const cx = q(4) + d / 2;
    const hexSize = q(2);

    colors.forEach((color, i) => {
      const cy = margin + d / 2 + i * step;
      ctx.beginPath();
      ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      // 圆内一行, 宽度按圆心处的弦长收一点余量
      const text = color.toUpperCase();
      const size = fitFont(text, '', d * 0.8, q(0.6), hexSize);
      if (size > 0) {
        ctx.fillStyle = hexOn(color);
        ctx.font = `${size}px sans-serif`;
        ctx.textAlign = 'center';
        label(text, cx, cy + size / 3);
      }
    });

    if (withText) {
      const nameText = name || '配色方案';
      const nameSize = fitFont(nameText, 'bold', w - q(8), q(1.8), q(3));
      if (nameSize > 0) {
        shadowOn();
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${nameSize}px sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText(nameText, q(4), h - margin);
        shadowOff();
      }
    }
  } else if (templateId === '04') {
    // 04 白底卡片: 内容整体内缩留出白边, 上 3/4 图片, 下方名称居左、色块横排
    const inset = q(6);
    const contentW = w - inset * 2;
    const contentH = h - inset * 2;
    const imageH = contentH * 0.75;
    const bottom = inset + contentH;
    const colors = pick(5);
    const gap = q(1.5);
    const d = q(12);
    const step = d + gap;
    const hexSize = q(2.2);
    const gapLabel = q(1);

    const zoneLeft = inset;
    const zoneRight = inset + contentW;

    const nameText = name || '配色方案';
    const nameSize = fitFont(nameText, 'bold', zoneRight - zoneLeft, q(2), q(3.6));

    // 名称行 + 色块行整体在图片下缘与内容区下缘之间居中
    const gapV = q(3);
    const blockH = nameSize + gapV + d + gapLabel + hexSize;
    const top = inset + imageH + Math.max(q(2), (bottom - inset - imageH - blockH) / 2);

    if (withText && nameSize > 0) {
      ctx.fillStyle = '#212121';
      ctx.font = `bold ${nameSize}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(nameText, zoneLeft, top + nameSize);
    }

    const cy = top + nameSize + gapV + d / 2;
    const totalW = colors.length * step - gap;
    const startX = (zoneRight - zoneLeft > totalW
      ? zoneLeft + (zoneRight - zoneLeft - totalW) / 2
      : zoneLeft) + d / 2;

    colors.forEach((color, i) => {
      const cx = startX + i * step;
      ctx.beginPath();
      ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      const text = color.toUpperCase();
      const maxW = Math.min(step * 1.6, (zoneRight - cx) * 2);
      const size = fitFont(text, '', maxW, q(0.6), hexSize);
      if (size > 0) {
        ctx.fillStyle = '#666';
        ctx.font = `${size}px sans-serif`;
        ctx.textAlign = 'center';
        label(text, cx, cy + d / 2 + gapLabel + size * 0.8);
      }
    });
  }
}

/** 色卡预览弹窗 - 模板切换/描述输入/导出图片 */
interface ColorCardDialogProps {
  open: boolean;
  onClose: () => void;
  bgImage: string;
  primaryColor: string;
  paletteColors: string[];
}

function ColorCardDialog({ open, onClose, bgImage, primaryColor, paletteColors }: ColorCardDialogProps) {
  const [previewUrl, setPreviewUrl] = useState('');
  const [description, setDescription] = useState('');
  const [templateId, setTemplateId] = useState('01');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgImgRef = useRef<HTMLImageElement | null>(null);
  const drawSeq = useRef(0);

  // AI 名称生成
  const { name: aiName, status: nameStatus, error: nameError, generateName } = useGenerateName(
    primaryColor, '文艺优雅', 4, open
  );

  // 色卡名称: 用户输入的描述优先, 其次 AI 名称, 都还没有时留空
  const cardName = description || aiName;

  // 名字没落定之前不画图 —— 否则会先用占位名画一版,
  // 用户在这期间导出拿到的是占位名色卡
  const nameSettled = nameStatus === 'done' || nameStatus === 'error';

  // 预加载背景图
  useEffect(() => {
    if (bgImage) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { bgImgRef.current = img; };
      img.src = bgImage;
    }
  }, [bgImage]);

  // 画一版到 canvas 并刷新预览。withText=false 先只出色块占位,
  // 等 AI 名称落定后再画带名称的完整版
  const drawCard = useCallback((withText: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderColorCard(canvas, {
      bgImage: bgImgRef.current,
      primaryColor,
      paletteColors,
      name: withText ? cardName : '',
      templateId,
      withText,
    });
    setPreviewUrl(canvas.toDataURL('image/png'));
  }, [primaryColor, paletteColors, cardName, templateId]);

  // 重绘的唯一入口: 打开 / 模板 / 描述 / 名称是否落定 变化都会走到这里。
  // 不在这里 setPreviewUrl(''), 否则每敲一个字都会闪一次 loading。
  useEffect(() => {
    if (!open) {
      setPreviewUrl('');
      return;
    }

    const seq = ++drawSeq.current;
    const timer = setTimeout(() => {
      if (seq !== drawSeq.current) return;
      drawCard(nameSettled);
    }, 300);

    return () => { clearTimeout(timer); };
  }, [open, nameSettled, drawCard]);

  // 关闭时复位
  useEffect(() => {
    if (open) return;
    setPreviewUrl('');
    setDescription('');
    setTemplateId('01');
  }, [open]);

  // 导出色卡: 按当前参数重画一版带名称的, 不复用可能还是占位版的预览
  const handleExport = () => {
    const canvas = canvasRef.current;
    if (!canvas || !nameSettled) return;
    renderColorCard(canvas, {
      bgImage: bgImgRef.current,
      primaryColor,
      paletteColors,
      name: cardName || '配色方案',
      templateId,
    });
    const dataUrl = canvas.toDataURL('image/png');
    if (window.services?.saveColorCard) {
      const binary = atob(dataUrl.split(',')[1]);
      const buffer = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
      window.services.saveColorCard(buffer.buffer);
    } else {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'color-card.png';
      a.click();
    }
  };

  // 预览尺寸交给 flex 算: 预览区是 flex 列, 由它自己的高宽反推出"能占多少",
  // 不用 vw 换算 —— 换不换算得出准确值, 也就不用担心描述框/右侧面板把它挤小
  const previewRatio = useMemo((): number => {
    const template = TEMPLATES.find(t => t.id === templateId) || TEMPLATES[0];
    const [tw, th] = getTemplateSize(template);
    return tw / th;
  }, [templateId]);

  return (
    <Dialog fullScreen open={open} onClose={(_, reason) => {
      if (reason === 'escapeKeyDown') onClose();
    }}>
      <div style={{ position: 'absolute', display: 'flex', inset: 0, userSelect: 'none', backgroundColor: '#212121' }}>
        {/* 关闭按钮 */}
        <IconButton
          sx={{ position: 'absolute', top: 10, left: 10, color: '#fff', zIndex: 1000 }}
          onClick={onClose}
        >
          <CloseIcon sx={{ fontSize: 28 }} />
        </IconButton>

        {/* 中间区域：色卡预览 + 描述输入 */}
        <Stack flex={1} minWidth={0} minHeight={0} justifyContent="center" alignItems="center" px={8} py={3} gap={3}>
          {/* 色卡预览: 撑满剩余空间, 宽高出多少就缩多少, 不用 vw 硬算 */}
          <Stack flex={1} minHeight={0} width="100%" justifyContent="center" alignItems="center">
            {previewUrl ? (
              <img
                draggable="false"
                alt="preview"
                src={previewUrl}
                style={{ maxWidth: '100%', maxHeight: '100%', aspectRatio: String(previewRatio), objectFit: 'contain' }}
              />
            ) : (
              <Stack alignItems="center" justifyContent="center" gap={1} sx={{ aspectRatio: String(previewRatio), maxWidth: '100%', maxHeight: '100%' }}>
                <CircularProgress size="3rem" sx={{ color: '#666' }} />
                {!nameSettled && <Typography color="#888" fontSize={13}>AI 正在起名</Typography>}
              </Stack>
            )}
          </Stack>

          {/* 描述输入 + 重新生成 */}
          <Stack width="100%" flexShrink={0} height={75} bgcolor="#fff" overflow="hidden" borderRadius="10px" px={1.5} py={1} boxSizing="border-box">
            <TextField
              placeholder={aiName || '描述画面主体，可调整色卡名称'}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              variant="standard"
              fullWidth
              sx={{ '& .MuiInput-root': { fontSize: 14, paddingRight: 0 } }}
              InputProps={{
                endAdornment: description ? (
                  <IconButton size="small" onClick={() => setDescription('')} sx={{ p: 0.3 }}>
                    <ClearIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                ) : null,
              }}
            />
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              {nameError ? (
                <Typography color="error" fontSize={12}>{nameError}</Typography>
              ) : <span />}
              <Tooltip title="重新生成">
                <IconButton
                  size="small"
                  disabled={nameStatus === 'loading'}
                  onClick={() => { generateName(aiName || undefined); }}
                >
                  <RefreshIcon />
                </IconButton>
              </Tooltip>
            </Stack>
          </Stack>
        </Stack>

        {/* 右侧面板：模板选择 + 导出按钮 */}
        <Stack width={168} bgcolor="#000" boxSizing="border-box" flexShrink={0} position="relative" sx={{ overflow: 'hidden', overflowY: 'auto' }}>
          <Typography bgcolor="#000" color="#fff" py={2} position="sticky" top={0} px={3}>模板</Typography>
          <Stack flex={1} gap={1} alignItems="center" px={3}>
            {TEMPLATES.map(t => (
              <Stack
                key={t.id}
                width={110}
                height={110}
                bgcolor="#aaa"
                borderRadius={2}
                boxSizing="border-box"
                overflow="hidden"
                position="relative"
                onClick={() => setTemplateId(t.id)}
                sx={{ cursor: 'pointer' }}
              >
                <img src={t.cover} alt="cover" draggable="false" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                <Stack borderRadius={2} position="absolute" sx={{
                  inset: 0,
                  border: `5px solid ${t.id === templateId ? '#1976d2' : 'transparent'}`,
                  transition: 'border-color 0.08s ease-in-out',
                }} />
              </Stack>
            ))}
          </Stack>
          <Stack boxSizing="border-box" py={2} px={3} position="sticky" bottom={0} bgcolor="#000" width="100%">
            <Button
              fullWidth
              disabled={!previewUrl}
              variant="contained"
              onClick={handleExport}
            >
              导出色卡
            </Button>
          </Stack>
        </Stack>
      </div>

      {/* 隐藏的 Canvas 用于渲染色卡 */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </Dialog>
  );
}

/** 生成 AI 色卡按钮 + 弹窗入口 */
interface ColorCardButtonProps {
  bgImage: string;
  primaryColor: string;
  paletteColors: string[];
}

function ColorCardButton({ bgImage, primaryColor, paletteColors }: ColorCardButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <Typography mx={1} mt="auto" mb={1}>
        <Button
          disabled={dialogOpen}
          sx={{
            '&.MuiButtonBase-root': {
              color: '#fff',
              background: 'linear-gradient(91deg, #B379F7 0%, #878DF9 99%)',
              boxShadow: 'none',
              '&:hover,&:active': {
                color: '#fff',
                background: 'linear-gradient(91deg, #B379F7 0%, #878DF9 99%)',
                boxShadow: 'none',
              },
              '&:disabled': { opacity: 0.5 },
              '.MuiSvgIcon-root': { fontSize: 12 },
            },
          }}
          variant="contained"
          color="inherit"
          fullWidth
          onClick={() => setDialogOpen(true)}
          startIcon={<AutoAwesomeIcon />}
        >
          生成 AI 色卡
        </Button>
      </Typography>
      <ColorCardDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        bgImage={bgImage}
        primaryColor={primaryColor}
        paletteColors={paletteColors}
      />
    </>
  );
}

interface ImagePaletteProps {
  onColorClick: (e: any) => void;
  showMessage?: (msg: string) => void;
  /** 平台入口传入的图片: type=img 时为 base64/dataURL, type=files 时为文件路径 */
  initialImage?: string | null;
}

interface ImagePaletteState {
  imageUrl: string | null;
  primaryColor: string | null;
  paletteColors: string[] | null;
}

class ImagePalettePage extends Component<ImagePaletteProps, ImagePaletteState> {
  private fileInputRef = createRef<HTMLInputElement>();

  state: ImagePaletteState = {
    imageUrl: null,
    primaryColor: null,
    paletteColors: null,
  };

  componentDidMount() {
    if (this.props.initialImage) {
      this.setState({ imageUrl: this.props.initialImage, primaryColor: null, paletteColors: null });
    }
  }

  componentDidUpdate(prevProps: ImagePaletteProps) {
    if (prevProps.initialImage !== this.props.initialImage && this.props.initialImage) {
      this.setState({ imageUrl: this.props.initialImage, primaryColor: null, paletteColors: null });
    }
  }

  handleImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    try {
      const img = e.currentTarget;
      const result = extractColorsFromImage(img);
      if (result) {
        this.setState({ primaryColor: result.mainColor, paletteColors: result.paletteColors });
      }
    } catch { /* ignore */ }
  };

  handleDialogSelectImage = () => {
    this.fileInputRef.current?.click();
  };

  handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const url = ev.target?.result as string;
        this.setState({ imageUrl: url, primaryColor: null, paletteColors: null });
      };
      reader.readAsDataURL(file);
    }
  };

  handleScreenCapture = () => {
    // 回调给的是 base64 data URL(data:image/png;base64,...), 不是文件路径
    screenCapture((imgBase64) => {
      this.setState({ imageUrl: imgBase64, primaryColor: null, paletteColors: null });
    });
  };

  render() {
    const { imageUrl, primaryColor, paletteColors } = this.state;

    return (
      <div className="image-body" style={{ backgroundColor: primaryColor || undefined }}>
        {imageUrl ? (
          <div className="image-content">
            <div>
              <img onLoad={this.handleImgLoad} src={imageUrl} alt="" />
            </div>
            {primaryColor && (
              <div className="image-colors">
                <Card variant="outlined" className="image-colors-card">
                  <Stack height="100%">
                    <div>
                      <div className="image-colors-label">主色</div>
                      <div className="image-main-color">
                        <div
                          onClick={this.props.onColorClick}
                          style={{ backgroundColor: primaryColor }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="image-colors-label">配色</div>
                      <div className="image-palette">
                        {paletteColors?.slice(0, 14).map((color, i) => (
                          <div
                            key={i}
                            onClick={this.props.onColorClick}
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                    </div>
                    <ColorCardButton
                      bgImage={imageUrl}
                      primaryColor={primaryColor}
                      paletteColors={paletteColors?.filter(c => c !== primaryColor) || []}
                    />
                  </Stack>
                </Card>
              </div>
            )}
          </div>
        ) : (
          <div className="image-empty">左下角选择图片或屏幕截图</div>
        )}
        <div className={`image-from-btns${imageUrl ? ' image-selected' : ''}`}>
          <Tooltip disableFocusListener placement="top" title="选择图片文件">
            <Fab onClick={this.handleDialogSelectImage} disableFocusRipple color="primary" size="small">
              <FolderOpenIcon />
            </Fab>
          </Tooltip>
          <Tooltip disableFocusListener placement="top" title="屏幕截图">
            <Fab onClick={this.handleScreenCapture} disableFocusRipple color="primary" size="small">
              <CropIcon />
            </Fab>
          </Tooltip>
        </div>
        <input
          ref={this.fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={this.handleFileChange}
        />
      </div>
    );
  }
}

export default ImagePalettePage;
