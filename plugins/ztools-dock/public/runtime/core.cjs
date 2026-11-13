'use strict';
const SYSTEM_KEYS = ['home', 'desktop', 'downloads', 'documents', 'pictures', 'music', 'videos'];
const COLOR = /^#[0-9a-f]{6}$/i;
const MAX_CONFIG_BYTES = 8 * 1024 * 1024;
const cleanText = (value, max = 200) => typeof value === 'string' && value.length <= max && !/[\x00-\x08\x0b-\x1f]/.test(value);

/** Create portable defaults without machine-specific absolute paths. */
function defaults() {
  const categories = [
    ['folders', '文件夹', 'Folder', '#087fe7'], ['tools', '常用工具', 'BriefcaseBusiness', '#ef9309'],
    ['files', '文件处理', 'FilePenLine', '#6475e8'], ['dev', '开发工具', 'CodeXml', '#855ce7'],
    ['ai', 'AI 工具', 'Bot', '#08a7cd'], ['system', '系统', 'SlidersHorizontal', '#0c9c83'],
    ['quick', '快捷操作', 'Zap', '#e64960']
  ].map(([id, name, icon, color]) => ({ id, name, icon, color }));
  const entries = [
    ['home', '用户目录', 'House'], ['desktop', '桌面', 'Monitor'], ['downloads', '下载', 'Download'],
    ['documents', '文档', 'FileText'], ['pictures', '图片', 'Image'], ['music', '音乐', 'Music'], ['videos', '视频', 'Video']
  ].map(([target, name, icon], i) => ({ id: `system-${target}`, categoryId: 'folders', name, type: 'system', target, icon, color: ['#087fe7', '#0c9c83', '#08a7cd'][i % 3] }));
  return { version: 1, settings: { enabled: true, searchEnabled: false, displayId: 'primary', openDelay: 180, closeDelay: 450, triggerWidth: 80, triggerHeight: 5, triggerOpacity: 0.75, accent: '#087fe7', columns: 3, cardSize: 100, theme: 'system', lastCategoryId: 'folders' }, categories, entries };
}

/** Validate an entire import before any state is mutated; retain only known fields. */
function validateConfig(input) {
  if (!input || input.version !== 1) throw new Error('不支持此配置版本，请使用程序坞导出的 JSON 文件');
  const s = input.settings && { ...input.settings, searchEnabled: input.settings.searchEnabled ?? false };
  if (!s || typeof s.enabled !== 'boolean' || !cleanText(s.displayId, 80)) throw new Error('基本设置不完整');
  if (typeof s.searchEnabled !== 'boolean') throw new Error('搜索设置无效');
  for (const [key, min, max, label] of [['openDelay', 0, 2000, '展开延迟'], ['closeDelay', 100, 3000, '收起延迟'], ['triggerWidth', 24, 400, '触发条宽度'], ['triggerHeight', 3, 16, '触发条高度'], ['columns', 2, 6, '列数'], ['cardSize', 76, 144, '卡片大小']]) {
    if (!Number.isInteger(s[key]) || s[key] < min || s[key] > max) throw new Error(`${label}超出允许范围`);
  }
  if (typeof s.triggerOpacity !== 'number' || s.triggerOpacity < 0.1 || s.triggerOpacity > 1 || !Number.isFinite(s.triggerOpacity)) throw new Error('透明度超出允许范围');
  if (!COLOR.test(s.accent) || !['light', 'dark', 'system'].includes(s.theme) || !cleanText(s.lastCategoryId, 100)) throw new Error('外观设置无效');
  if (!Array.isArray(input.categories) || input.categories.length < 1 || input.categories.length > 40) throw new Error('分类数量应为 1–40 个');
  const ids = new Set();
  function identity(item, label) {
    if (!item || !cleanText(item.id, 100) || !item.id || ids.has(item.id)) throw new Error(`${label} ID 缺失或重复`);
    if (!cleanText(item.name, 60) || !item.name.trim()) throw new Error(`${label}名称应为 1–60 个字符`);
    if (!cleanText(item.icon, 80) || !COLOR.test(item.color)) throw new Error(`${label}图标或颜色无效`);
    ids.add(item.id);
    const result = { id: item.id, name: item.name.trim(), icon: item.icon, color: item.color };
    if (item.image) {
      if (typeof item.image !== 'string' || item.image.length > 400000 || !/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(item.image)) throw new Error('自定义图标无效或过大');
      result.image = item.image;
    }
    return result;
  }
  const categories = input.categories.map(c => identity(c, '分类'));
  if (!Array.isArray(input.entries) || input.entries.length > 2000) throw new Error('入口数量不能超过 2000 个');
  const entries = input.entries.map(e => {
    const item = identity(e, '入口');
    if (!categories.some(c => c.id === e.categoryId)) throw new Error('入口所属分类不存在');
    if (!['app', 'folder', 'file', 'url', 'plugin', 'system'].includes(e.type) || !cleanText(e.target, 4096) || !e.target.trim()) throw new Error('入口目标或类型无效');
    if (e.type === 'url') validUrl(e.target);
    if (e.type === 'system' && !SYSTEM_KEYS.includes(e.target)) throw new Error('系统目录无效');
    if (e.type === 'plugin' && (!cleanText(e.plugin, 100) || !e.plugin.trim())) throw new Error('请填写插件名称');
    if (['app', 'folder', 'file'].includes(e.type) && !/^(?:[a-z]:[\\/]|\\\\)/i.test(e.target)) throw new Error('请选择完整的本地文件或文件夹路径');
    return { ...item, categoryId: e.categoryId, type: e.type, target: e.target.trim(), ...(e.type === 'plugin' ? { plugin: e.plugin.trim() } : {}) };
  });
  const settings = Object.fromEntries(Object.keys(defaults().settings).map(k => [k, s[k]]));
  const result = { version: 1, settings, categories, entries };
  if (Buffer.byteLength(JSON.stringify(result, null, 2), 'utf8') > MAX_CONFIG_BYTES) throw new Error('配置总大小不能超过 8 MB，请缩小自定义图标或减少入口后重试');
  return result;
}

/** Allow ordinary browser URLs only; executable and shell protocols are not launch targets. */
function validUrl(target) {
  let parsed;
  try { parsed = new URL(target); } catch { throw new Error('网址无效，请填写完整的 https:// 或 http:// 地址'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) throw new Error('网址仅支持不含账号密码的 HTTP / HTTPS 地址');
  return target;
}

/** Resolve a validated entry without executing it. */
function resolveEntry(entry, paths) {
  if (entry.type === 'url') return { kind: 'url', target: validUrl(entry.target) };
  if (entry.type === 'plugin') {
    if (!entry.plugin?.trim() || !entry.target?.trim()) throw new Error('插件名称和指令不能为空');
    return { kind: 'plugin', target: [entry.plugin.trim(), entry.target.trim()] };
  }
  if (entry.type === 'system') {
    if (!SYSTEM_KEYS.includes(entry.target) || !paths[entry.target]) throw new Error('系统目录不可用');
    return { kind: 'path', target: paths[entry.target] };
  }
  if (!['app', 'folder', 'file'].includes(entry.type)) throw new Error('不支持的入口类型');
  return { kind: 'path', target: entry.target };
}

/** Lay out windows in Electron DIP coordinates, including negative monitor origins. */
function geometry(settings, displays, primary, categoryCount = 7) {
  const display = displays.find(d => String(d.id) === settings.displayId) || primary || displays[0];
  if (!display) throw new Error('未找到可用显示器');
  const area = display.workArea || display.bounds;
  const trayWidth = settings.columns * 128 + 8;
  const barWidth = Math.max(160, categoryCount * 100 + 32);
  // The dropdown is centred under the active category, including the first and last tabs.
  const width = Math.min(Math.max(trayWidth, barWidth + Math.max(0, trayWidth - 100)) + 32, Math.max(240, area.width - 24));
  const height = Math.min(820, Math.max(180, area.height - settings.triggerHeight - 12));
  return {
    displayId: String(display.id),
    trigger: { x: Math.round(area.x + (area.width - settings.triggerWidth) / 2), y: area.y, width: Math.min(settings.triggerWidth, area.width), height: settings.triggerHeight },
    panel: { x: Math.round(area.x + (area.width - width) / 2), y: area.y + settings.triggerHeight, width, height }
  };
}
module.exports = { defaults, validateConfig, geometry, resolveEntry, SYSTEM_KEYS, MAX_CONFIG_BYTES, validUrl };
