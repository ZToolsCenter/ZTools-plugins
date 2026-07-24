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
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import CloseIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import ClearIcon from '@mui/icons-material/Clear';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import CropIcon from '@mui/icons-material/Crop';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import chroma from 'chroma-js';
import { quantize } from '../utils/quantize';
import { isDarkColor, textColorFor, dimColor } from '../utils/color';
import { screenCapture, copyText, hideMainWindow, aiChat, isAIAvailable } from '../utils/platform';

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
  // 参数校验 -
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
  return cmap && cmap !== false ? cmap.palette() : null;
}

/**
 * 从图片中提取主色和配色
 * 主色: getColor 提取5色中的第一个
 * 配色: getPalette 提取10色，排除主色后的列表
 */
// 原始: const o = new Uu; s = a4(o.getColor(n.target)); c = o.getPalette(n.target).map(u => a4(u))
function extractColorsFromImage(img: HTMLImageElement): { mainColor: string; paletteColors: string[] } | null {
  try {
    const mainRgb = getColor(img, 10);  // getColor(target, 10) → getPalette(target, 5, 10)[0]
    const paletteRgbs = getPalette(img);  // getPalette(target) → colorCount=10, quality=10

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

/**
 * AI 色卡名称生成 Hook
 * 调用 AI 根据颜色值生成文艺名称，支持缓存和自动生成
 * @param color 颜色 HEX 值
 * @param style 命名风格，默认"文艺优雅"
 * @param nameLength 名称字数，默认4
 * @param autoGenerate 是否在挂载时自动生成
 */
/** AI 名称缓存，避免重复调用 */
const nameCache = new Map<string, string>();

function useGenerateName(color: string, style: string = '文艺优雅', nameLength: number = 4, autoGenerate: boolean = false) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
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

  const generateName = useCallback((targetCacheKey: string, excludeName?: string) => {
    const ai = isAIAvailable();
    if (!ai) {
      setError('当前版本不支持 AI 功能');
      return null;
    }

    const systemPrompt = `
# Role
你是一个颜色命名大师
## Skills
- 读取用户输入的颜色值
- 给读取的颜色起一个好听的名字，名字风格${style}
## Actions
- 根据用户输入的颜色起一个名字
- 你直接输出名字，不再额外输出其他内容
- 名字必须是${nameLength}个汉字组成
${excludeName ? `- 名字不能是${excludeName}` : ''}
## Input
输入：{颜色值}
## 输出
{名字}
`;

    setLoading(true);
    setName('');
    setError('');

    const promise = aiChat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `输入: ${color}` },
    ]);

    promise.then(result => {
      if (!isMounted.current || targetCacheKey !== latestCacheKey.current) return;
      setLoading(false);
      setName(result.content);
      nameCache.set(targetCacheKey, result.content);
    }).catch(() => {
      if (!isMounted.current || targetCacheKey !== latestCacheKey.current) return;
      setLoading(false);
      setError('AI 调用异常');
    });

    return promise;
  }, [style, nameLength, color]);

  // 自动生成
  useEffect(() => {
    if (!autoGenerate || !color) return;

    const key = color + style + nameLength;
    if (nameCache.has(key)) {
      setName(nameCache.get(key)!);
      return;
    }

    generateName(key);
  }, [color, style, nameLength, generateName, autoGenerate]);

  return [name, { loading, error, generateName, cacheKey }] as const;
}

/** 画面场景选项(用于 AI 色卡描述) */
const SCENE_OPTIONS = ["明星影视", "游戏动漫", "生活家居", "文旅出行", "时尚美妆", "体育赛事", "科技数码", "汽车交通", "艺术设计"];

/** 画面场景选择器 - 下拉菜单选择场景标签 */
interface SceneSelectorProps {
  data: string[];
  value: string | null;
  disabled?: boolean;
  onChange: (value: string | null) => void;
}

function SceneSelector({ data, value, disabled, onChange }: SceneSelectorProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  if (value) {
    return (
      <Stack direction="row" gap={0.5} alignItems="center" border="#aaa solid 1px" borderRadius={999} py={0.3} px={0.8} sx={{
        '.MuiSvgIcon-root': { fontSize: 16, cursor: 'pointer' },
        fontSize: 12, opacity: disabled ? 0.5 : 1,
      }}>
        {value}
        <CloseIcon onClick={() => { if (!disabled) onChange(null); }} />
      </Stack>
    );
  }

  return (
    <>
      <Stack direction="row" gap={0.5} alignItems="center" border="#aaa solid 1px" borderRadius={999} py={0.3} px={0.8} sx={{
        '.MuiSvgIcon-root': { fontSize: 16 },
        fontSize: 12, cursor: 'pointer', opacity: disabled ? 0.5 : 1,
      }} onClick={(e) => { if (!disabled) setAnchorEl(e.currentTarget); }}>
        <AutoAwesomeIcon />
        画面
      </Stack>
      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)}
        MenuListProps={{ dense: true, disablePadding: true }}>
        {data.map(item => (
          <MenuItem key={item} selected={item === value} onClick={() => { onChange(item); setAnchorEl(null); }}>
            {item}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

/** 色卡模板定义: id/尺寸/封面图/名称字数 */
interface TemplateDef {
  id: string;
  sizes: number | [number, number];
  cover: string;
  nameLength: number;
}

const TEMPLATES: TemplateDef[] = [
  { id: '01', sizes: 1200, cover: cover01, nameLength: 4 },
  { id: '02', sizes: 1200, cover: cover02, nameLength: 4 },
  { id: '03', sizes: [1200 * 3 / 4, 1200], cover: cover03, nameLength: 4 },
  { id: '04', sizes: [1800 * 9 / 16, 1800], cover: cover04, nameLength: 4 },
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
 * 根据模板类型在 Canvas 上绘制色卡: 背景色/图片 + 名称 + 配色色块
 * 支持4种模板: 01(渐变遮罩)/02(模糊大背景)/03(cover填充)/04(底部横条)
 */
function renderColorCard(
  canvas: HTMLCanvasElement,
  options: {
    bgImage: HTMLImageElement | null;
    primaryColor: string;
    paletteColors: string[];
    name: string;
    templateId: string;
  }
) {
  const { bgImage, primaryColor, paletteColors, name, templateId } = options;
  const template = TEMPLATES.find(t => t.id === templateId) || TEMPLATES[0];
  const [w, h] = getTemplateSize(template);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const dark = isDarkColor(primaryColor);
  const textCol = dark ? '#fff' : '#000';
  const dimCol = dimColor(primaryColor, 0.3);
  const semiCol = dimColor(primaryColor, 0.6);

  // 通用渲染：背景色填充
  ctx.fillStyle = primaryColor;
  ctx.fillRect(0, 0, w, h);

  // 背景图（如果有）
  if (bgImage) {
    const coverFit = (cw: number, ch: number) => {
      const scale = Math.max(cw / bgImage.width, ch / bgImage.height) * 1.8;
      const dw = bgImage.width * scale;
      const dh = bgImage.height * scale;
      return { dx: (cw - dw) / 2, dy: 0, dw, dh };
    };

    if (templateId === '01') {
      // 01: 图片居中上半部分，下半渐变遮罩
      const scale = Math.min(w / bgImage.width, h / bgImage.height);
      const dw = bgImage.width * scale;
      const dh = bgImage.height * scale;
      ctx.drawImage(bgImage, (w - dw) / 2, 0, dw, dh);

      // 下半渐变遮罩
      const grad = ctx.createLinearGradient(0, h * 0.5, 0, h * 0.65);
      grad.addColorStop(0, chroma(primaryColor).alpha(0.01).hex());
      grad.addColorStop(0.1, chroma(primaryColor).alpha(0.5).hex());
      grad.addColorStop(0.25, primaryColor);
      grad.addColorStop(1, primaryColor);
      ctx.fillStyle = grad;
      ctx.fillRect(0, h * 0.5, w, h * 0.5);
    } else if (templateId === '02') {
      // 002: 图片模糊大背景 + 居中裁剪
      const { dx, dy, dw, dh } = coverFit(w, h);
      ctx.globalAlpha = 0.3;
      ctx.filter = 'blur(40px)';
      ctx.drawImage(bgImage, dx, dy, dw, dh);
      ctx.filter = 'none';
      ctx.globalAlpha = 1;

      // 居中裁剪图
      const scale2 = Math.min(w * 0.95 / bgImage.width, h * 0.95 / bgImage.height);
      const dw2 = bgImage.width * scale2;
      const dh2 = bgImage.height * scale2;
      ctx.drawImage(bgImage, (w - dw2) / 2, (h - dh2) / 2, dw2, dh2);
    } else if (templateId === '03') {
      // 003: 图片 cover 填充
      const scale = Math.max(w / bgImage.width, h / bgImage.height);
      const dw = bgImage.width * scale;
      const dh = bgImage.height * scale;
      ctx.drawImage(bgImage, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } else if (templateId === '04') {
      // 004: 图片 cover 填充
      const scale = Math.max(w / bgImage.width, h / bgImage.height);
      const dw = bgImage.width * scale;
      const dh = bgImage.height * scale;
      ctx.drawImage(bgImage, (w - dw) / 2, (h - dh) / 2, dw, dh);
    }
  }

  // 文字和配色色块
  if (templateId === '01') {
    // 01 模板：下半部分文字 + 配色
    const baseY = h * 2.1 / 3;
    ctx.fillStyle = semiCol;
    ctx.font = `bold ${w / 9}px serif`;
    ctx.textAlign = 'left';
    ctx.fillText(name || '配色方案', w / 20, baseY);

    // 主色圆 + 色值
    const circleR = w / 50;
    const circleY = baseY + h / 6;
    ctx.beginPath();
    ctx.arc(w / 20 + circleR, circleY, circleR, 0, Math.PI * 2);
    ctx.fillStyle = semiCol;
    ctx.fill();
    ctx.fillStyle = semiCol;
    ctx.font = `bold ${w / 30}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(primaryColor, w / 20 + circleR * 2 + w / 30, circleY + w / 80);

    // 配色色块
    const colors = paletteColors.slice(0, 4);
    const blockSize = w / 7;
    const startX = w / 2;
    colors.forEach((color, i) => {
      const y = circleY + w / 60 + i * (blockSize + w / 60);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(startX, y, blockSize, blockSize, 8);
      ctx.fill();
      ctx.fillStyle = textColorFor(color);
      ctx.font = `${w / 38}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(color, startX + blockSize / 2, y + blockSize / 2 + w / 76);
    });

    // 签名
    // ctx.fillStyle = dimCol;
    // ctx.font = `${w / 32}px sans-serif`;
    // ctx.textAlign = 'left';
    // ctx.fillText('色卡', w / 20, baseY + h / 6 + w / 20);
  } else if (templateId === '02') {
    // 002 模板：底部配色横排
    const allColors = [primaryColor, ...paletteColors.slice(0, 5)];
    const blockSize = w / 6;
    const startX = w / 20;
    const startY = h - h / 4;

    allColors.forEach((color, i) => {
      const x = startX + i * (blockSize + w / 60);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, startY, blockSize, blockSize, 8);
      ctx.fill();
      ctx.fillStyle = textColorFor(color);
      ctx.font = `${w / 38}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(color, x + blockSize / 2, startY + blockSize / 2 + w / 76);
    });

    // 签名
    ctx.fillStyle = dimColor(primaryColor, 0.6);
    ctx.font = `${w / 35}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(name || '配色方案', startX, startY + blockSize + w / 20);
  } else if (templateId === '03') {
    // 003 模板：左上圆环 + 右下标题
    const circleR = w / 12;
    const allColors = [primaryColor, ...paletteColors.slice(0, 2)];
    allColors.forEach((color, i) => {
      const y = w / 18 + i * (circleR * 2 + w / 20);
      ctx.beginPath();
      ctx.arc(w / 20 + circleR, y + circleR, circleR, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = textCol;
      ctx.lineWidth = w / 250;
      ctx.stroke();
      ctx.fillStyle = textColorFor(color);
      ctx.font = `${w / 38}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(color, w / 20 + circleR, y + circleR + w / 76);
    });

    // 标题
    ctx.fillStyle = textCol;
    ctx.font = `bold ${w / 10}px serif`;
    ctx.textAlign = 'left';
    ctx.fillText(name || '配色方案', w / 20, h - h / 4.8);

    // ctx.fillStyle = dimColor(primaryColor, 0.5);
    // ctx.font = `${w / 32}px sans-serif`;
    // ctx.fillText('色卡', w / 20, h - h / 4.8 + w / 7.5);
  } else if (templateId === '04') {
    // 004 模板：底部横条配色
    const barH = h * 0.18;
    const barY = h - barH - h * 0.05;
    const barX = w * 0.1;
    const barW = w * 0.8;
    const allColors = [primaryColor, ...paletteColors.slice(0, 5)];
    const colW = barW / allColors.length;

    allColors.forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(barX + i * colW + 2, barY, colW - 4, barH, 8);
      ctx.fill();
      ctx.fillStyle = textColorFor(color);
      ctx.font = `${w / 30}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(color, barX + i * colW + colW / 2, barY + barH / 2 + w / 60);
    });

    // 标题
    ctx.fillStyle = textCol;
    ctx.font = `bold ${w / 8}px serif`;
    ctx.textAlign = 'left';
    ctx.fillText(name || '配色方案', w / 20, barY - h * 0.05);
  }
}

/** 色卡预览弹窗 - 模板切换/描述输入/导出图片 */
interface ColorCardDialogProps {
  open: boolean;
  onClose: () => void;
  bgImage: string;
  primaryColor: string;
  paletteColors: string[];
  showMessage: (msg: string) => void;
}

function ColorCardDialog({ open, onClose, bgImage, primaryColor, paletteColors, showMessage }: ColorCardDialogProps) {
  const [previewUrl, setPreviewUrl] = useState('');
  const [generating, setGenerating] = useState(false);
  const [description, setDescription] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [scene, setScene] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState('01');
  const [rerender, setRerender] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgImgRef = useRef<HTMLImageElement | null>(null);

  // AI 名称生成
  const [aiName, { loading: aiLoading, error: aiError, generateName }] = useGenerateName(
    primaryColor, '文艺优雅', 4, open
  );

  // 色卡名称: AI 生成的名称优先，用户可手动修改
  const cardName = description || aiName || '配色方案';

  // 预加载背景图
  useEffect(() => {
    if (bgImage) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { bgImgRef.current = img; };
      img.src = bgImage;
    }
  }, [bgImage]);

  // 生成色卡预览
  const generatePreview = useCallback(() => {
    setGenerating(true);
    setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) { setGenerating(false); return; }

      renderColorCard(canvas, {
        bgImage: bgImgRef.current,
        primaryColor,
        paletteColors,
        name: cardName,
        templateId,
      });

      setPreviewUrl(canvas.toDataURL('image/png'));
      setGenerating(false);
    }, 500);
  }, [primaryColor, paletteColors, cardName, templateId]);

  // 打开时自动生成
  useEffect(() => {
    if (open) {
      generatePreview();
    } else {
      setPreviewUrl('');
      setTemplateId('01');
      setDescription('');
      setDescriptionDraft('');
      setScene(null);
    }
  }, [open]);

  // 模板/AI名称变化时重新生成
  useEffect(() => {
    if (open) {
      generatePreview();
    }
  }, [templateId, aiName]);

  // 用户手动修改描述时重新生成
  useEffect(() => {
    if (open && description !== undefined) {
      generatePreview();
    }
  }, [description]);

  // 切换模板
  const handleTemplateChange = (id: string) => {
    if (id !== templateId) {
      setTemplateId(id);
      setRerender(true);
    }
  };

  // 导出色卡
  const handleExport = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    if (window.services?.saveColorCard) {
      const buffer = Uint8Array.from(atob(dataUrl.split(',')[1]), c => c.charCodeAt(0));
      window.services.saveColorCard(Array.from(buffer));
    } else {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'color-card.png';
      a.click();
    }
  };

  // 预览图尺寸计算
  const previewSize = useMemo((): [string, string] => {
    const template = TEMPLATES.find(t => t.id === templateId) || TEMPLATES[0];
    const [tw, th] = getTemplateSize(template);
    if (tw === th) return ['50vw', '50vw'];
    const ratio = tw / th;
    if (ratio > 1) return ['50vw', `${50 / ratio}vw`];
    return [`${50 * ratio}vw`, '50vw'];
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
        <Stack flex={1} display="flex" justifyContent="center" alignItems="center" px={8} gap={3}>
          {/* 色卡预览图 */}
          <Stack>
            {previewUrl && !generating ? (
              <img
                draggable="false"
                alt="preview"
                src={previewUrl}
                style={{ width: previewSize[0], height: previewSize[1], objectFit: 'contain' }}
              />
            ) : (
              <Stack alignItems="center" justifyContent="center" width={previewSize[0]} height={previewSize[1]}>
                <CircularProgress size="3rem" sx={{ color: '#666' }} />
              </Stack>
            )}
          </Stack>

          {/* 描述输入 + 画面选择 + 重新生成 */}
          <Stack width="100%" height={75} bgcolor="#fff" overflow="hidden" borderRadius="10px" px={1.5} py={1} boxSizing="border-box">
            <TextField
              disabled={generating || aiLoading}
              placeholder={aiName || "描述画面主体，可调整色卡名称"}
              value={descriptionDraft}
              onChange={(e) => setDescriptionDraft(e.target.value)}
              onBlur={() => { if (descriptionDraft !== description) setDescription(descriptionDraft); }}
              variant="standard"
              fullWidth
              sx={{ '& .MuiInput-root': { fontSize: 14, paddingRight: 0 } }}
              InputProps={{
                endAdornment: descriptionDraft ? (
                  <IconButton size="small" onClick={() => { setDescription(''); setDescriptionDraft(''); }} sx={{ p: 0.3 }}>
                    <ClearIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                ) : null,
              }}
            />
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <SceneSelector
                disabled={generating || aiLoading}
                data={SCENE_OPTIONS}
                value={scene}
                onChange={setScene}
              />
              <Tooltip title="重新生成">
                <IconButton
                  size="small"
                  disabled={generating || aiLoading}
                  onClick={() => {
                    // 重新调用 AI 生成名称（排除当前名称）
                    const key = primaryColor + '文艺优雅' + 4;
                    generateName(key, aiName || undefined);
                    generatePreview();
                  }}
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
                onClick={() => handleTemplateChange(t.id)}
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
              disabled={generating || !previewUrl}
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
  onColorClick: (e: any) => void;
  showMessage: (msg: string) => void;
}

function ColorCardButton({ bgImage, primaryColor, paletteColors, onColorClick, showMessage }: ColorCardButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [generating, setGenerating] = useState(false);

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
          onClick={() => { setDialogOpen(true); setGenerating(true); }}
          startIcon={<AutoAwesomeIcon />}
        >
          生成 AI 色卡
        </Button>
      </Typography>
      <ColorCardDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setGenerating(false); }}
        bgImage={bgImage}
        primaryColor={primaryColor}
        paletteColors={paletteColors}
        showMessage={showMessage}
      />
    </>
  );
}

// 图片取色主页面
interface ImagePaletteState {
  imageUrl: string | null;
  primaryColor: string | null;
  paletteColors: string[] | null;
}

class ImagePalettePage extends Component<{ onColorClick: (e: any) => void; showMessage?: (msg: string) => void }, ImagePaletteState> {
  private fileInputRef = createRef<HTMLInputElement>();

  state: ImagePaletteState = {
    imageUrl: null,
    primaryColor: null,
    paletteColors: null,
  };

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
    screenCapture((imagePath) => {
      this.setState({ imageUrl: imagePath, primaryColor: null, paletteColors: null });
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
                      onColorClick={this.props.onColorClick}
                      showMessage={this.props.showMessage || (() => {})}
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
