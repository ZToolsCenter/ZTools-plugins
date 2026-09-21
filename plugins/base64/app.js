'use strict';
const $ = id => document.getElementById(id);
const codec = window.Base64Codec;
let mode = 'encode';
let source = 'text';
let selected = null;
let result = null;
let sourceUrl = '';
let resultUrl = '';
let revision = 0;
let selectionRevision = 0;
let timer;
let toastTimer;
const drafts = { encode: '', decode: '' };

function sizeLabel(size) {
  return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(2)} MB`;
}
function notify(message) {
  $('status').textContent = message;
  $('status').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('status').classList.remove('visible'), 3000);
}
function revokeResult() {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = '';
  $('decoded-preview').removeAttribute('src');
}
function resetResult() {
  revision++;
  clearTimeout(timer);
  result = null;
  revokeResult();
  $('output').value = '';
  for (const id of ['output', 'image-result', 'error', 'save']) $(id).hidden = true;
  $('empty-result').hidden = false;
  $('copy').disabled = true;
  $('copy').textContent = '复制结果';
  $('output-count').textContent = '等待输入';
  $('result-type').textContent = mode === 'encode' ? 'BASE64' : '自动识别';
}
function renderMode() {
  const encode = mode === 'encode';
  const image = encode && source === 'image';
  for (const value of ['encode', 'decode']) {
    $(`${value}-mode`).classList.toggle('active', mode === value);
    $(`${value}-mode`).setAttribute('aria-pressed', String(mode === value));
  }
  for (const value of ['text', 'image']) {
    $(`${value}-source`).classList.toggle('active', source === value);
    $(`${value}-source`).setAttribute('aria-pressed', String(source === value));
  }
  $('source-controls').hidden = !encode;
  $('input').hidden = image;
  $('image-input').hidden = !image;
  $('output-options').hidden = !image;
  $('input-title').textContent = encode ? '原始内容' : 'Base64 内容';
  $('output-title').textContent = encode ? '编码结果' : '解码结果';
  $('input').placeholder = encode ? '在这里输入或粘贴文本…\n\n支持中文、Emoji 和多行文本。' : '在这里粘贴 Base64…\n\n支持纯 Base64 或 data:image/…;base64,…\n图片将自动显示预览。';
  $('input-help').textContent = image ? '保留原图格式与质量' : encode ? '文本使用 UTF-8 编码' : '自动忽略空格与换行';
  $('input-count').textContent = image ? selected ? sizeLabel(selected.bytes.length) : '未选择图片' : `${$('input').value.length.toLocaleString()} 字符`;
  $('pick-image').hidden = !!selected;
  $('selected-image').hidden = !selected;
}
function changeMode(next) {
  if (mode !== next) {
    drafts[mode] = $('input').value;
    mode = next;
    $('input').value = drafts[mode];
    selectionRevision++;
  }
  renderMode();
  convert();
}
function changeSource(next) {
  source = next;
  selectionRevision++;
  renderMode();
  convert();
}
function showError(error) {
  $('empty-result').hidden = true;
  $('error').hidden = false;
  $('error').textContent = error.message || '转换失败，请检查输入内容。';
  $('output-count').textContent = '请检查内容';
}
function convert() {
  resetResult();
  const current = revision;
  try {
    if (mode === 'encode') {
      if (source === 'image' && !selected || source === 'text' && !$('input').value) return;
      const text = source === 'image' ? ($('data-url').checked ? `data:${selected.mime};base64,` : '') + selected.base64 : codec.encodeText($('input').value);
      result = { kind: 'text', text };
      $('output').value = text;
      $('output').hidden = false;
      $('output-count').textContent = `${text.length.toLocaleString()} 字符`;
    } else {
      if (!$('input').value.trim()) return;
      result = codec.decode($('input').value);
      if (result.kind === 'image') {
        const imageResult = result;
        $('result-type').textContent = result.extension.toUpperCase();
        $('image-result').hidden = false;
        $('save').hidden = false;
        $('copy').textContent = '复制 Base64';
        $('output-count').textContent = sizeLabel(result.bytes.length);
        $('image-meta').textContent = `${result.mime} · 正在加载预览…`;
        const img = $('decoded-preview');
        img.onload = () => {
          if (current !== revision) return;
          $('image-meta').textContent = `${img.naturalWidth} × ${img.naturalHeight} px · ${imageResult.mime} · ${sizeLabel(imageResult.bytes.length)}`;
        };
        img.onerror = () => {
          if (current !== revision) return;
          $('image-meta').textContent = '图片数据已识别，但预览失败；可能文件损坏或当前环境不支持此格式。仍可保存原文件。';
        };
        resultUrl = URL.createObjectURL(new Blob([result.bytes], { type: result.mime }));
        img.src = resultUrl;
      } else {
        $('result-type').textContent = 'UTF-8';
        $('output').hidden = false;
        $('output').value = result.text;
        $('output-count').textContent = `${result.text.length.toLocaleString()} 字符 · ${sizeLabel(result.bytes.length)}`;
      }
    }
    $('empty-result').hidden = true;
    $('copy').disabled = false;
  } catch (error) { showError(error); }
}
async function selectImage(file) {
  if (!file) return;
  if (mode !== 'encode') changeMode('encode');
  source = 'image';
  const current = ++selectionRevision;
  selected = null;
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  sourceUrl = '';
  $('source-preview').removeAttribute('src');
  resetResult();
  renderMode();
  try {
    codec.checkSize(file.size);
    const bytes = new Uint8Array(typeof file.arrayBuffer === 'function' ? await file.arrayBuffer() : file.bytes);
    if (current !== selectionRevision) return;
    const mime = codec.imageMime(bytes);
    if (!mime) throw new Error('无法识别此图片，请选择 PNG、JPG、GIF、WebP、BMP、ICO、AVIF 或 SVG。');
    selected = { bytes, mime, base64: codec.encodeBytes(bytes) };
    sourceUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
    $('source-preview').src = sourceUrl;
    $('source-preview').onerror = () => { if (current === selectionRevision) notify('当前环境无法预览此图片，仍可编码和保存原始数据。'); };
    $('file-info').textContent = `${file.name || '粘贴的图片'} · ${sizeLabel(bytes.length)}`;
    renderMode();
    convert();
  } catch (error) { if (current === selectionRevision) showError(error); }
}
$('encode-mode').onclick = () => changeMode('encode');
$('decode-mode').onclick = () => changeMode('decode');
$('text-source').onclick = () => changeSource('text');
$('image-source').onclick = () => changeSource('image');
$('data-url').onchange = convert;
$('input').addEventListener('input', () => {
  drafts[mode] = $('input').value;
  renderMode();
  resetResult();
  timer = setTimeout(convert, 250);
});
$('clear').onclick = () => {
  selectionRevision++;
  $('input').value = '';
  drafts[mode] = '';
  if (mode === 'encode') {
    selected = null;
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    sourceUrl = '';
    $('source-preview').removeAttribute('src');
    $('file-input').value = '';
  }
  resetResult();
  renderMode();
};
async function pickImage() {
  // 网页预览使用 HTML file input；ZTools 必须走宿主的防失焦对话框。
  if (!window.ztools) {
    $('file-input').click();
    return;
  }
  const current = selectionRevision;
  const buttons = [$('pick-image'), $('replace-image')];
  buttons.forEach(button => { button.disabled = true; });
  try {
    if (!window.base64Native?.openImage) throw new Error('选图接口未加载，请重新加载插件后重试。');
    const image = await window.base64Native.openImage();
    if (current !== selectionRevision) return;
    if (image.canceled) return;
    await selectImage({ name: image.name, size: image.bytes.length, bytes: image.bytes });
  } catch (error) {
    if (current === selectionRevision) notify(`选图失败：${error.message}`);
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
}
for (const id of ['pick-image', 'replace-image']) $(id).onclick = pickImage;
$('file-input').onchange = event => {
  selectImage(event.target.files[0]);
  event.target.value = '';
};
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); convert(); }
});
document.addEventListener('paste', event => {
  if (mode !== 'encode') return;
  const image = [...(event.clipboardData?.items || [])].find(item => item.type.startsWith('image/'));
  if (image) { event.preventDefault(); selectImage(image.getAsFile()); }
});
const inputPanel = document.querySelector('.input-panel');
document.addEventListener('dragover', event => { event.preventDefault(); if (mode === 'encode') inputPanel.classList.add('dragging'); });
document.addEventListener('dragleave', event => { if (!event.relatedTarget) inputPanel.classList.remove('dragging'); });
document.addEventListener('drop', event => {
  event.preventDefault();
  inputPanel.classList.remove('dragging');
  if (mode === 'encode' && event.dataTransfer.files.length) selectImage(event.dataTransfer.files[0]);
});
$('copy').onclick = async () => {
  if (!result) return;
  const text = result.kind === 'image' ? `data:${result.mime};base64,${result.base64}` : result.text;
  try {
    if (window.ztools?.copyText) {
      if (await window.ztools.copyText(text) === false) throw new Error('复制失败，请重试。');
    } else await navigator.clipboard.writeText(text);
    notify('已复制到剪贴板');
  } catch (error) { notify(error.message || '复制失败，请手动选择结果复制。'); }
};
$('save').onclick = async () => {
  if (result?.kind !== 'image') return;
  const image = result;
  try {
    if (window.base64Native?.saveImage) {
      const saved = await window.base64Native.saveImage(image.base64);
      notify(saved.canceled ? '已取消保存' : '图片已保存');
    } else {
      const url = URL.createObjectURL(new Blob([image.bytes], { type: image.mime }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `base64-image.${image.extension}`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      notify('已发起图片下载');
    }
  } catch (error) { notify(`保存失败：${error.message}`); }
};
if (window.ztools?.onPluginEnter) {
  window.ztools.onPluginEnter(param => {
    if (param.code === 'decode' || param.code === 'encode') changeMode(param.code);
    if ((param.type === 'over' || param.type === 'regex') && typeof param.payload === 'string') {
      source = 'text';
      $('input').value = param.payload;
      drafts[mode] = param.payload;
      renderMode();
      convert();
    }
    if (!$('input').hidden) $('input').focus();
  });
}
renderMode();
resetResult();
