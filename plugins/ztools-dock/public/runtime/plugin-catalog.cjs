'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const PERMISSIONS = ['internal:get-plugins', 'internal:get-disabled-plugins'];

// Electron's isolated preload can reject Node's cross-realm fileURLToPath
// implementation. Decode the Windows file URL without crossing VM realms.
function windowsIconPath(value) {
  const url = new URL(value);
  if (url.protocol !== 'file:' || /%2f|%5c/i.test(url.pathname)) throw new Error('插件图标路径无效');
  const pathname = decodeURIComponent(url.pathname).replaceAll('/', '\\');
  if (url.hostname && url.hostname !== 'localhost') return `\\\\${url.hostname}${pathname}`;
  if (!/^\\[a-z]:\\/i.test(pathname)) throw new Error('插件图标路径无效');
  return pathname.slice(1);
}

async function permission(api) {
  if (!api.getInternalApiPermissions || !api.internal?.getPlugins || !api.internal?.getDisabledPlugins) throw new Error('当前 ZTools 不支持插件选择，请升级宿主');
  const state = await api.getInternalApiPermissions();
  return state.fullAccess || PERMISSIONS.every(key => state.granted?.includes(key));
}
function normalizePlugins(plugins, disabled = []) {
  const rows = plugins.filter(p => p && typeof p.title === 'string' && p.title.trim() && typeof p.name === 'string' && p.name !== 'ztools-dock');
  const counts = new Map();
  rows.forEach(p => counts.set(p.title, (counts.get(p.title) || 0) + 1));
  return rows.map(p => ({
    id: p.name, title: p.title,
    commands: [...new Set((p.features || []).flatMap(f => Array.isArray(f.cmds) ? f.cmds.filter(c => typeof c === 'string' && c.trim()) : []))],
    unavailable: disabled.includes(p.path) || disabled.includes(p.name) ? '已停用' : counts.get(p.title) > 1 ? '同名插件无法区分' : ''
  })).sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
}
async function pluginCatalog(api) {
  if (!await permission(api)) return { authorized: false, plugins: [] };
  const [plugins, disabled] = await Promise.all([api.internal.getPlugins(), api.internal.getDisabledPlugins()]);
  return { authorized: true, plugins: normalizePlugins(plugins, disabled) };
}
async function requestCatalog(api) {
  if (await permission(api)) return true;
  const result = await api.requestInternalApiPermissions(PERMISSIONS, '选择已安装插件及其指令，并读取所选插件的图标，用于添加程序坞入口。');
  if (!result?.success) throw new Error(result?.error || '无法申请插件列表权限');
  return result.status === 'granted';
}
async function pluginIcon(api, id) {
  if (typeof id !== 'string' || !await permission(api)) throw new Error('请先授权读取插件列表');
  const plugins = await api.internal.getPlugins();
  const plugin = plugins.find(p => p.name === id);
  if (!plugin) throw new Error('插件已卸载，请刷新列表');
  const logo = plugin.logo;
  if (typeof logo !== 'string') return null;
  if (/^data:image\/(png|jpeg|webp|gif|svg\+xml|x-icon);base64,/.test(logo)) return logo.length <= 2800000 ? logo : null;
  if (/^https?:\/\//.test(logo)) {
    const { download } = require('./website-icon.cjs');
    const image = await download(logo, AbortSignal.timeout(8000), 2 * 1024 * 1024);
    if (!/^image\/(png|jpeg|webp|gif|svg\+xml|x-icon|vnd.microsoft.icon)$/.test(image.mime)) return null;
    return `data:${image.mime};base64,${image.bytes.toString('base64')}`;
  }
  if (!logo.startsWith('file:') || !plugin.path) return null;
  const filename = await fs.realpath(windowsIconPath(logo));
  const root = await fs.realpath(plugin.path);
  const relative = path.relative(root, filename);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const mime = { '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp', '.gif': 'gif', '.svg': 'svg+xml', '.ico': 'x-icon' }[path.extname(filename).toLowerCase()];
  if (!mime || (await fs.stat(filename)).size > 2 * 1024 * 1024) return null;
  return `data:image/${mime};base64,${(await fs.readFile(filename)).toString('base64')}`;
}
module.exports = { PERMISSIONS, windowsIconPath, normalizePlugins, pluginCatalog, requestCatalog, pluginIcon };
