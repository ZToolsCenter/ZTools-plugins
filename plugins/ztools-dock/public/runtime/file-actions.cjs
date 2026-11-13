'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { validateConfig, MAX_CONFIG_BYTES } = require('./core.cjs');
const { websiteIcon } = require('./website-icon.cjs');
const FILE_ACTIONS = new Set(['describe', 'pick', 'icon', 'import', 'export', 'website-icon']);

/** Derive a shortcut entry from a file explicitly selected or dropped by the user. */
function describeFile(filename, api) {
  if (typeof filename !== 'string' || filename.length > 4096) throw new Error('文件路径无效');
  const stat = fs.statSync(filename);
  const type = stat.isDirectory() ? 'folder' : /\.(exe|lnk|link|com|bat|cmd|msi|appref-ms)$/i.test(filename) ? 'app' : 'file';
  let image;
  try { image = api.getFileIcon(filename); } catch { /* Generic icon is sufficient when system extraction fails. */ }
  if (typeof image !== 'string' || image.length > 400000 || !/^data:image\/(png|jpeg|webp);base64,/.test(image)) image = undefined;
  return { name: type === 'app' ? path.basename(filename, path.extname(filename)) : path.basename(filename), target: filename, type, icon: type === 'folder' ? 'Folder' : type === 'app' ? 'AppWindow' : 'FileText', ...(image ? { image } : {}) };
}

/** Dialogs belong to the visible settings window, including focus restoration. */
async function fileAction(op, payload, api, getConfig) {
  switch (op) {
    case 'website-icon': return websiteIcon(payload);
    case 'describe':
      if (!Array.isArray(payload) || payload.length > 100) throw new Error('一次最多添加 100 个文件');
      return payload.map(filename => describeFile(filename, api));
    case 'pick': {
      const selected = api.showOpenDialog({ title: payload === 'folder' ? '选择文件夹' : '选择应用或文件', properties: [payload === 'folder' ? 'openDirectory' : 'openFile'] });
      return selected?.[0] ? describeFile(selected[0], api) : null;
    }
    case 'icon': {
      const selected = api.showOpenDialog({ title: '选择图标', properties: ['openFile'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
      if (!selected?.[0]) return null;
      const filename = selected[0]; if (fs.statSync(filename).size > 280000) throw new Error('图标请小于 280 KB');
      const ext = path.extname(filename).slice(1).toLowerCase();
      if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext)) throw new Error('请选择 PNG、JPG 或 WebP 图片');
      return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${fs.readFileSync(filename).toString('base64')}`;
    }
    case 'import': {
      const selected = api.showOpenDialog({ title: '导入程序坞配置', properties: ['openFile'], filters: [{ name: 'JSON 配置', extensions: ['json'] }] });
      if (!selected?.[0]) return null;
      if (fs.statSync(selected[0]).size > MAX_CONFIG_BYTES) throw new Error('配置文件过大，最大支持 8 MB');
      return validateConfig(JSON.parse(fs.readFileSync(selected[0], 'utf8').replace(/^\uFEFF/, '')));
    }
    case 'export': {
      const filename = api.showSaveDialog({ title: '导出程序坞配置', defaultPath: '程序坞配置.json', filters: [{ name: 'JSON 配置', extensions: ['json'] }] });
      if (!filename) return null;
      fs.writeFileSync(filename, JSON.stringify((await getConfig()), null, 2), 'utf8'); return true;
    }
    default: throw new Error('不支持的文件操作');
  }
}
module.exports = { FILE_ACTIONS, fileAction, describeFile };
