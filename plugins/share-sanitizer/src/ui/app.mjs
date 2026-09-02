import { detectSensitive, imageExportDecision, redactText } from '../core/sanitize.mjs';

const $ = (id) => document.getElementById(id);
const input = $('input');
const status = $('status');
const findings = $('findings');
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
const imageInput = $('image');
let masks = [];
let image = null;
let dragging = null;
let imageObjectUrl = null;
let imageLoadEpoch = 0;
let stopEntry = null;
let unloading = false;

const typeLabels = Object.freeze({ email: '邮箱', phone_cn: '中国大陆手机号', ipv4: 'IPv4 地址', win_path: 'Windows 路径', posix_path: 'POSIX 路径', bearer: 'Bearer 凭据', api_key: 'API 密钥', jwt: 'JWT', id_cn: '中国大陆身份证号' });
const allowed = () => $('whitelist').value.split('\n').map((value) => value.trim()).filter(Boolean);

function scan() {
  const result = detectSensitive(input.value, { whitelist: allowed() });
  findings.replaceChildren();
  for (const item of result) {
    const li = document.createElement('li');
    li.textContent = `${typeLabels[item.type] || item.type} · ${item.value}`;
    findings.append(li);
  }
  $('summary').textContent = result.truncated ? `至少有 ${result.length} 项需要检查；当前展示前 ${result.length} 项。` : `有 ${result.length} 项需要检查。`;
  status.textContent = result.length ? (result.truncated ? '需要检查 · 预览已截断' : '需要检查') : '未匹配到敏感数据';
  return result;
}

function releaseImageObjectUrl() {
  if (!imageObjectUrl) return;
  const objectUrl = imageObjectUrl;
  imageObjectUrl = null;
  try { URL.revokeObjectURL(objectUrl); } catch {}
}

function clearImageState(clearFileInput = true) {
  imageLoadEpoch += 1;
  if (image) {
    image.onload = null;
    image.onerror = null;
    try { image.src = ''; } catch {}
  }
  image = null;
  masks = [];
  dragging = null;
  releaseImageObjectUrl();
  canvas.width = 0;
  canvas.height = 0;
  ctx.clearRect(0, 0, 0, 0);
  $('imageDesk').hidden = true;
  $('ocr').textContent = '';
  if (clearFileInput) imageInput.value = '';
}

function resetSensitiveState() {
  input.value = '';
  $('whitelist').value = '';
  findings.replaceChildren();
  $('summary').textContent = '尚未发现风险。';
  clearImageState(true);
  status.textContent = '已在退出时清除敏感内容';
}

$('scan').addEventListener('click', () => { try { scan(); } catch (error) { status.textContent = error.message; } });
$('redact').addEventListener('click', () => {
  try {
    const result = redactText(input.value, { whitelist: allowed(), replacement: '【已脱敏】' });
    input.value = result.text;
    scan();
    status.textContent = `已脱敏 ${result.findings.length} 项`;
  } catch (error) { status.textContent = error.message; }
});
$('copy').addEventListener('click', async () => {
  try {
    const current = detectSensitive(input.value, { whitelist: allowed() });
    if (current.length) { scan(); status.textContent = '仍有敏感内容，请先应用脱敏再复制。'; return; }
    if (globalThis.shareSanitizer?.copyText) await globalThis.shareSanitizer.copyText(input.value);
    else await navigator.clipboard.writeText(input.value);
    status.textContent = '已复制安全文本';
  } catch (error) { status.textContent = error.message || '当前环境无法复制'; }
});

function draw() {
  if (!image) return;
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  ctx.drawImage(image, 0, 0);
  ctx.fillStyle = '#ef5c5c';
  for (const mask of masks) ctx.fillRect(mask.x, mask.y, mask.w, mask.h);
}

function loadImageSource(source, objectUrl = null) {
  clearImageState(false);
  const loadEpoch = imageLoadEpoch;
  imageObjectUrl = objectUrl;
  const nextImage = new Image();
  image = nextImage;
  nextImage.onload = () => {
    if (loadEpoch !== imageLoadEpoch || image !== nextImage) return;
    if (nextImage.naturalWidth * nextImage.naturalHeight > 40_000_000) {
      clearImageState(false);
      status.textContent = '图片超过 4000 万像素安全上限。';
      return;
    }
    masks = [];
    $('imageDesk').hidden = false;
    draw();
    releaseImageObjectUrl();
  };
  nextImage.onerror = () => {
    if (loadEpoch !== imageLoadEpoch || image !== nextImage) return;
    clearImageState(false);
    status.textContent = '图片解码失败，未进行任何修改。';
  };
  nextImage.src = source;
  $('ocr').textContent = 'TextDetector' in globalThis ? '当前浏览器支持文字检测，但不会自动运行。' : '当前环境不支持 OCR，请手动添加遮罩。';
}

function loadImage(file) {
  if (!file || !/^image\/(?:png|jpeg|webp)$/i.test(file.type) || file.size > 20 * 1024 * 1024) {
    status.textContent = '仅支持不超过 20 MiB 的 PNG、JPEG 或 WebP 图片。';
    return;
  }
  const objectUrl = URL.createObjectURL(file);
  loadImageSource(objectUrl, objectUrl);
}

function loadImageDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > 28 * 1024 * 1024 || !/^data:image\/(?:png|jpeg|webp);base64,/i.test(dataUrl)) {
    status.textContent = '所选图片数据无效或过大。';
    return;
  }
  loadImageSource(dataUrl);
}

imageInput.addEventListener('change', (event) => loadImage(event.target.files?.[0]));

function pos(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height };
}

canvas.addEventListener('pointerdown', (event) => { if (!image) return; dragging = pos(event); canvas.setPointerCapture(event.pointerId); });
canvas.addEventListener('pointerup', (event) => {
  if (!dragging || !image) return;
  const end = pos(event);
  masks.push({ x: Math.min(dragging.x, end.x), y: Math.min(dragging.y, end.y), w: Math.abs(end.x - dragging.x), h: Math.abs(end.y - dragging.y) });
  dragging = null;
  draw();
});
canvas.addEventListener('pointercancel', () => { dragging = null; });
$('clearMasks').addEventListener('click', () => { masks = []; draw(); });
$('exportImage').addEventListener('click', async () => {
  try {
    let decision = imageExportDecision(masks.length);
    if (!decision.ok) {
      if (!confirm('尚未添加手动遮罩。是否仅移除元数据后导出，不视为完成视觉脱敏？')) { status.textContent = '已取消图片导出；请添加遮罩后再导出视觉脱敏图片。'; return; }
      decision = imageExportDecision(masks.length, true);
    }
    const data = canvas.toDataURL('image/png');
    if (globalThis.shareSanitizer?.copyImage) await globalThis.shareSanitizer.copyImage(data);
    else { const anchor = document.createElement('a'); anchor.href = data; anchor.download = '已脱敏.png'; anchor.click(); }
    status.textContent = decision.mode === 'metadata-only' ? '仅移除元数据的图片已导出，未应用视觉脱敏。' : '已导出脱敏图片';
  } catch { status.textContent = '当前环境无法导出图片'; }
});

function consumeEntry(entry) {
  if (entry?.kind === 'reset') {
    resetSensitiveState();
    return;
  }
  if (entry?.kind === 'text') { input.value = entry.text; scan(); return; }
  if (entry?.kind === 'image') { loadImageDataUrl(entry.dataUrl); return; }
  if (entry?.kind === 'error') status.textContent = entry.message;
}

function subscribeEntry() {
  if (unloading) return;
  if (stopEntry) return;
  stopEntry = globalThis.shareSanitizer?.onEntry?.(consumeEntry) || null;
}

subscribeEntry();
globalThis.addEventListener?.('pagehide', () => {
  unloading = true;
  stopEntry?.();
  stopEntry = null;
  resetSensitiveState();
});
