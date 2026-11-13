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
  return { version: 1, settings: { enabled: true, searchEnabled: false, showCategoryNames: true, showEntryNames: true, dockEdge: 'top', positionMode: 'ratio', positionRatio: 50, positionDistance: 0, positionAnchor: 'start', triggerTheme: 'bar', triggerImage: '', triggerEdgeDistance: 0, iconSize: 'medium', material: 'solid', panelOpacity: 1, displayId: 'primary', openDelay: 180, closeDelay: 450, triggerWidth: 80, triggerHeight: 5, triggerOpacity: 0.75, accent: '#087fe7', columns: 3, cardSize: 100, theme: 'system', lastCategoryId: 'folders' }, categories, entries };
}

/** Validate an entire import before any state is mutated; retain only known fields. */
function validateConfig(input) {
  if (!input || input.version !== 1) throw new Error('不支持此配置版本，请使用程序坞导出的 JSON 文件');
  const s = input.settings && { ...input.settings, searchEnabled: input.settings.searchEnabled ?? false, showCategoryNames: input.settings.showCategoryNames === undefined ? true : input.settings.showCategoryNames, showEntryNames: input.settings.showEntryNames === undefined ? true : input.settings.showEntryNames, triggerTheme: input.settings.triggerTheme ?? 'bar', triggerImage: input.settings.triggerImage ?? '', triggerEdgeDistance: input.settings.triggerEdgeDistance ?? 0, iconSize: input.settings.iconSize ?? 'medium', material: input.settings.material ?? 'solid', panelOpacity: input.settings.panelOpacity ?? 1, dockEdge: input.settings.dockEdge ?? 'top', positionMode: input.settings.positionMode ?? 'ratio', positionRatio: input.settings.positionRatio ?? 50, positionDistance: input.settings.positionDistance ?? 0, positionAnchor: input.settings.positionAnchor ?? 'start' };
  if (!s || typeof s.enabled !== 'boolean' || !cleanText(s.displayId, 80)) throw new Error('基本设置不完整');
  if (!['bar', 'worm', 'snail', 'custom'].includes(s.triggerTheme) || !['small', 'medium', 'large'].includes(s.iconSize) || !['solid', 'mica', 'acrylic'].includes(s.material)) throw new Error('外观主题或材质无效');
  if (!Number.isInteger(s.triggerEdgeDistance) || s.triggerEdgeDistance < -400 || s.triggerEdgeDistance > 400) throw new Error('底部距离超出允许范围');
  if (typeof s.triggerImage !== 'string' || (s.triggerImage && !pngSize(s.triggerImage)) || (s.triggerTheme === 'custom' && !s.triggerImage)) throw new Error('请上传有效的PNG触发图案');
  if (typeof s.panelOpacity !== 'number' || !Number.isFinite(s.panelOpacity) || s.panelOpacity < 0.1 || s.panelOpacity > 1) throw new Error('面板不透明度超出允许范围');
  if (!['top','bottom','left','right'].includes(s.dockEdge) || !['ratio','distance'].includes(s.positionMode) || !['start','end'].includes(s.positionAnchor)) throw new Error('停靠位置设置无效');
  if (!Number.isFinite(s.positionRatio) || s.positionRatio < 0 || s.positionRatio > 100 || !Number.isInteger(s.positionDistance) || s.positionDistance < 0 || s.positionDistance > 20000) throw new Error('位置距离或比例超出允许范围');
  if (typeof s.showCategoryNames !== 'boolean' || typeof s.showEntryNames !== 'boolean') throw new Error('名称显示设置无效');
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

/** Normalized PNG data only; filesystem decoder verifies selected images before saving. */
function pngSize(value) {
  if (typeof value !== 'string' || value.length > 1400000 || !/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(value)) return null;
  const bytes=Buffer.from(value.slice(22),'base64');
  if(bytes.length<33 || bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a' || bytes.toString('ascii',12,16)!=='IHDR')return null;
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  return width>0&&height>0&&width<=512&&height<=512?{width,height}:null;
}

/** Lay out windows in Electron DIP coordinates, including negative monitor origins. */
function geometry(settings, displays, primary, categoryCount = 7) {
  const display = displays.find(d => String(d.id) === settings.displayId) || primary || displays[0];
  if (!display) throw new Error('未找到可用显示器');
  const area = display.workArea || display.bounds;
  const edge = settings.dockEdge || 'top', vertical = edge === 'left' || edge === 'right';
  const axisLength = vertical ? area.height : area.width;
  const length = Math.min(settings.triggerTheme && settings.triggerTheme !== 'bar' ? Math.max(64, settings.triggerWidth) : settings.triggerWidth, axisLength);
  const image=settings.triggerTheme==='custom'?pngSize(settings.triggerImage):null;
  const desiredThickness=image?Math.min(160,Math.max(1,Math.round(length*image.height/image.width))):settings.triggerTheme&&settings.triggerTheme!=='bar'?32:settings.triggerHeight;
  const thickness = Math.min(desiredThickness, vertical ? area.width : area.height);
  const travel = Math.max(0, axisLength - length);
  const clamp = (v, min, max) => Math.max(min, Math.min(Math.max(min, max), v));
  const distance = settings.positionMode === 'distance' ? (settings.positionAnchor === 'end' ? travel - settings.positionDistance : settings.positionDistance) : travel * (settings.positionRatio ?? 50) / 100;
  const offset = Math.round(clamp(distance, 0, travel));
  const inset=clamp(settings.triggerEdgeDistance??0,-thickness+1,Math.max(0,(vertical?area.width:area.height)-thickness-(vertical?360:180)));
  const triggerArt = vertical
    ? { x: edge === 'left' ? area.x+inset : area.x+area.width-inset-thickness, y: area.y+offset, width:thickness,height:length }
    : { x:area.x+offset,y:edge==='top'?area.y+inset:area.y+area.height-inset-thickness,width:length,height:thickness };
  const x=Math.max(area.x,triggerArt.x),y=Math.max(area.y,triggerArt.y);
  const trigger={x,y,width:Math.min(area.x+area.width,triggerArt.x+triggerArt.width)-x,height:Math.min(area.y+area.height,triggerArt.y+triggerArt.height)-y};
  // Keep the entire native backing on this monitor: Windows minimum window sizes
  // otherwise push a thin right/bottom trigger onto a neighbour with a different DPI.
  const backingWidth = Math.min(area.width, Math.max(128, trigger.width)), backingHeight = Math.min(area.height, Math.max(64, trigger.height));
  const triggerWindow = { x: Math.round(clamp(trigger.x - (backingWidth - trigger.width) / 2, area.x, area.x + area.width - backingWidth)), y: Math.round(clamp(trigger.y - (backingHeight - trigger.height) / 2, area.y, area.y + area.height - backingHeight)), width: backingWidth, height: backingHeight };
  const trayWidth = settings.columns * 128 + 8;
  const barWidth = Math.max(160, categoryCount * 100 + 32);
  const inward = edge==='left'?area.x+area.width-trigger.x-trigger.width:edge==='right'?trigger.x-area.x:edge==='top'?area.y+area.height-trigger.y-trigger.height:trigger.y-area.y;
  const width = vertical ? Math.min(100 + trayWidth + 32, Math.max(1, inward - 12)) : Math.min(Math.max(trayWidth, barWidth + Math.max(0, trayWidth - 100)) + 32, Math.max(1, area.width - 24));
  const height = Math.min(820, Math.max(1, vertical ? area.height - 24 : inward - 12));
  const centre = { x: trigger.x + trigger.width / 2, y: trigger.y + trigger.height / 2 };
  const panel = {
    x: vertical ? (edge === 'left' ? trigger.x + trigger.width : trigger.x - width) : Math.round(clamp(centre.x - width / 2, area.x, area.x + area.width - width)),
    y: vertical ? Math.round(clamp(centre.y - height / 2, area.y, area.y + area.height - height)) : (edge === 'top' ? trigger.y + trigger.height : trigger.y - height),
    width, height
  };
  return { displayId: String(display.id), trigger, triggerArt, triggerWindow, panel, anchor: { x: centre.x - panel.x, y: centre.y - panel.y } };
}
module.exports = { defaults, validateConfig, geometry, resolveEntry, SYSTEM_KEYS, MAX_CONFIG_BYTES, validUrl, pngSize };
