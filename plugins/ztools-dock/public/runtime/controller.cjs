'use strict';
const { defaults, validateConfig, geometry, resolveEntry, SYSTEM_KEYS } = require('./core.cjs');
const { supportsMaterials, roundedRegions } = require('./appearance.cjs');
const { createMaterialSurfaces } = require('./material-surfaces.cjs');
const { validateTriggerImage } = require('./file-actions.cjs');
const nativeTimers = require('node:timers');
const { randomUUID } = require('node:crypto');

/** Own the dock windows and configuration; persistence succeeds before the visible state changes. */
function createController(api, options = {}) {
  const timers = options.timers || nativeTimers;
  const exists = options.exists || require('node:fs').existsSync;
  let config = defaults(), error = '', expanded = false, trayVisible = false, pinned = false, disposed = false;
  let trigger = null, panel = null, editor = null, openTimer = null, closeTimer = null, pollTimer = null, topmostTimer = null;
  const materialsSupported = options.materialsSupported ?? supportsMaterials();
  let panelMaterial = 'solid';
  const materialSurfaces = createMaterialSurfaces(api);
  const effectiveMaterial = () => materialsSupported ? config.settings.material : 'solid';
  let bounds = null, lastLayout = '', triggerOffset = { x: 0, y: 0 };
  let panelRegions = [], lastPanelShape = '';
  let generation = 0;
  let addition = null, additionId = '';
  let monitorSignature = '', displayCache = [], primaryDisplay, displayInfo = [], maintenanceTicks = 0;
  let dark = Boolean(api.isDarkColors());
  try { const stored = api.dbStorage.getItem('dock-config-v1'); if (stored) { const valid = validateConfig(stored); validateTriggerImage(valid.settings); config = valid; } }
  catch (e) { error = `配置读取失败：${e.message}。可从设置导入备份或恢复默认。`; config.settings.enabled = false; }

  function live(win) { return win && !win.isDestroyed(); }
  function displays() { if (!displayCache.length) refreshDisplays(); return displayCache; }
  function refreshDisplays() {
    const next = api.getAllDisplays(), primary = api.getPrimaryDisplay();
    const signature = JSON.stringify([primary?.id, next.map(d => [d.id, d.label, d.bounds, d.workArea, d.scaleFactor])]);
    if (signature === monitorSignature) return false;
    monitorSignature = signature; displayCache = next; primaryDisplay = primary;
    displayInfo = next.map(d => ({ id: String(d.id), label: d.label || `显示器 ${d.id}`, width: d.bounds.width, height: d.bounds.height, scaleFactor: d.scaleFactor || 1 }));
    return true;
  }
  function runtimeState() { displays(); return { triggerOffset, materialsSupported, material: effectiveMaterial(), expanded, trayVisible, pinned, additionId, error, dark, displays: displayInfo, bounds }; }
  function snapshot() { return { config: structuredClone(config), ...runtimeState() }; }
  function notify(mode = 'full') {
    dark = Boolean(api.isDarkColors());
    // Runtime changes must not re-send all entries and embedded icons to every renderer.
    const state = mode === 'full' ? snapshot() : { ...runtimeState(), ...(mode === 'settings' ? { settings: { ...config.settings } } : {}) };
    options.onChange?.(state);
    for (const win of windows()) { try { win.webContents.send('dock:state', state); } catch { /* Closing windows may race a state update. */ } }
  }
  function clear(name) {
    if (name === 'open' && openTimer !== null) { timers.clearTimeout(openTimer); openTimer = null; }
    if (name === 'close' && closeTimer !== null) { timers.clearTimeout(closeTimer); closeTimer = null; }
    if (name === 'poll' && pollTimer !== null) { timers.clearInterval(pollTimer); pollTimer = null; }
    if (name === 'topmost' && topmostTimer !== null) { timers.clearInterval(topmostTimer); topmostTimer = null; }
  }
  function maintainTopmost() {
    if (disposed || !config.settings.enabled) return;
    // A peer topmost window can cover an existing topmost window on Windows.
    // Reassert the level and z-order without showing hidden windows or taking keyboard focus.
    // Visibility is owned here; do not query the hidden panel on every maintenance tick.
    if (expanded) materialSurfaces.raise();
    for (const win of expanded ? [panel, trigger] : [trigger]) if (live(win)) {
      win.setAlwaysOnTop(true, 'screen-saver');
      win.moveTop();
    }
  }
  function clipTrigger() {
    const actual = trigger.getBounds();
    triggerOffset = { x: bounds.triggerArt.x-actual.x, y: bounds.triggerArt.y-actual.y };
    trigger.setShape([{ x: Math.max(0,bounds.trigger.x-actual.x), y: Math.max(0,bounds.trigger.y-actual.y), width: bounds.trigger.width, height: bounds.trigger.height }]);
  }
  function layout() {
    const occupied = new Set(config.entries.map(entry => entry.categoryId));
    bounds = geometry(config.settings, displays(), primaryDisplay, config.categories.filter(category => occupied.has(category.id)).length);
    const signature = JSON.stringify(bounds);
    if (signature !== lastLayout) {
      if (live(trigger)) { trigger.setBounds(bounds.triggerWindow); clipTrigger(); }
      if (live(panel)) panel.setBounds(bounds.panel);
      materialSurfaces.layout(panelRegions,bounds.panel,expanded,trayVisible);
      lastLayout = signature;
    }
  }
  function resetPanelShape() {
    panelRegions = []; lastPanelShape = '';
    // Do not expose a full-width native backdrop before the renderer reports its visible regions.
    panel.setShape(panelMaterial === 'solid' ? [{ x: 0, y: 0, width: bounds.panel.width, height: Math.min(84, bounds.panel.height) }] : [{ x: 0, y: 0, width: 1, height: 1 }]);
  }
  function panelLayout(rects) {
    if (!bounds || !Array.isArray(rects) || rects.length < 1 || rects.length > 3) throw new Error('面板区域无效');
    const regions = rects.map(r => {
      if (!r || !['x','y','width','height'].every(k => Number.isFinite(r[k])) || r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0 || r.x + r.width > bounds.panel.width + 2 || r.y + r.height > bounds.panel.height + 2) throw new Error('面板区域超出窗口');
      const x = Math.floor(r.x), y = Math.floor(r.y);
      return { x, y, width: Math.min(Math.ceil(r.x + r.width), bounds.panel.width) - x, height: Math.min(Math.ceil(r.y + r.height), bounds.panel.height) - y };
    });
    const signature = JSON.stringify(regions);
    if (signature !== lastPanelShape && live(panel)) {
      panel.setShape(panelMaterial === 'solid' ? regions : roundedRegions(regions)); panelRegions = regions; lastPanelShape = signature;
    }
    materialSurfaces.layout(regions, bounds.panel, expanded, trayVisible);
    maintainTopmost();
    return true;
  }
  function ensureWindows() {
    if (disposed || !config.settings.enabled) return;
    if (topmostTimer === null) refreshDisplays();
    layout();
    const common = { frame: false, thickFrame: false, minWidth: 1, minHeight: 1, show: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, title: '程序坞', webPreferences: { preload: 'child-preload.cjs', backgroundThrottling: true } };
    if (!live(trigger)) {
      trigger = api.createBrowserWindow('index.html?surface=trigger', { ...common, ...bounds.triggerWindow, transparent: true, hasShadow: false, focusable: false });
      // Windows enforces a native minimum height; clip both painting and hit testing.
      clipTrigger();
      trigger.showInactive(); maintainTopmost();
    }
    const material = effectiveMaterial();
    panelMaterial = material;
    if (!live(panel)) {
      panel = api.createBrowserWindow('index.html?surface=panel', { ...common, ...bounds.panel, transparent: true, backgroundColor: '#00000000', hasShadow: false });
      resetPanelShape();
    }
    if (materialSurfaces.setMaterial(material,common)) { panelRegions=[];lastPanelShape=''; }
    if (topmostTimer === null) topmostTimer = timers.setInterval(() => {
      try {
        maintainTopmost();
        if (++maintenanceTicks % 5 === 0 && refreshDisplays()) { layout(); notify('runtime'); }
      } catch (e) { report(e); }
    }, 500);
  }
  function persist(valid) {
    api.dbStorage.setItem('dock-config-v1', valid);
    if (JSON.stringify(api.dbStorage.getItem('dock-config-v1')) !== JSON.stringify(valid)) throw new Error('配置未能保存，请检查磁盘空间后重试');
  }
  function save(next) {
    const valid = validateConfig(next);
    if (valid.settings.triggerImage !== config.settings.triggerImage) validateTriggerImage(valid.settings);
    persist(valid);
    config = valid; error = '';
    if (config.settings.enabled) ensureWindows(); else stopWindows();
    notify(); return true;
  }
  function start() {
    disposed = false;
    if (!config.settings.enabled) { const next = structuredClone(config); next.settings.enabled = true; save(next); }
    else { ensureWindows(); notify(); }
    return true;
  }
  function stopWindows() {
    generation++;
    ['open', 'close', 'poll', 'topmost'].forEach(clear); maintenanceTicks = 0;
    expanded = false; trayVisible = false; pinned = false;
    for (const win of [panel, trigger]) if (live(win)) win.destroy();
    materialSurfaces.dispose();
    trigger = panel = null; lastLayout = ''; panelRegions = []; lastPanelShape = '';
  }
  function pause() { const next = structuredClone(config); next.settings.enabled = false; return save(next); }
  function resetAppearance() {
    return save({ ...config, settings: { ...defaults().settings, enabled: config.settings.enabled, lastCategoryId: config.settings.lastCategoryId } });
  }
  function collapse(force = true) {
    generation++;
    clear('open'); clear('close'); clear('poll');
    if (!expanded && !pinned) return;
    trayVisible = false;
    if (!force && pinned) { materialSurfaces.layout(panelRegions, bounds.panel, true, false); notify('runtime'); return; }
    expanded = false; if (force) pinned = false;
    if (live(panel)) panel.hide(); if (bounds) materialSurfaces.layout(panelRegions, bounds.panel, false, false); notify('runtime');
  }
  function inside(point, rect) { return rect && point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height; }
  function expand() {
    generation++;
    clear('open'); clear('close');
    if (expanded && live(panel)) {
      if (!trayVisible) { trayVisible = true; materialSurfaces.layout(panelRegions,bounds.panel,true,true); maintainTopmost(); startCursorPolling(); notify('runtime'); }
      return true;
    }
    if (!config.settings.enabled || disposed) start(); else ensureWindows();
    expanded = true; trayVisible = true;
    panel.showInactive();
    materialSurfaces.layout(panelRegions,bounds.panel,true,true);
    maintainTopmost();
    startCursorPolling();
    notify('runtime'); return true;
  }
  function startCursorPolling() {
    if (!expanded || (pinned && !trayVisible)) return;
    if (pollTimer === null) pollTimer = timers.setInterval(() => {
      try {
        const point = api.getCursorScreenPoint();
        const overPanel = inside(point, bounds.panel) && (!panelRegions.length || panelRegions.some(r => inside(point, { ...r, x: bounds.panel.x + r.x, y: bounds.panel.y + r.y })));
        if (overPanel || inside(point, bounds.trigger)) clear('close');
        else if (closeTimer === null) closeTimer = timers.setTimeout(() => { closeTimer = null; collapse(false); }, config.settings.closeDelay);
      } catch (e) { report(e); }
    }, 100);
  }
  function hover(active) {
    clear('open');
    if (active && !expanded && config.settings.enabled) openTimer = timers.setTimeout(() => { openTimer = null; expand(); }, config.settings.openDelay);
  }
  function pin() { pinned = !pinned; clear('close'); startCursorPolling(); notify('runtime'); return true; }
  function select(id) {
    if (!config.categories.some(c => c.id === id)) throw new Error('分类不存在');
    if (id !== config.settings.lastCategoryId) {
      const next = { ...config, settings: { ...config.settings, lastCategoryId: id } };
      persist(next); config = next; error = ''; notify('settings');
    }
    return true;
  }
  async function run(id, draft) {
    const entry = draft ? validateConfig({ ...config, entries: [draft] }).entries[0] : config.entries.find(e => e.id === id);
    if (!entry) throw new Error('入口不存在，请重新选择');
    const paths = Object.fromEntries(SYSTEM_KEYS.map(key => { try { return [key, api.getPath(key)]; } catch { return [key, '']; } }));
    const action = resolveEntry(entry, paths);
    if (action.kind === 'path' && !exists(action.target)) throw new Error('文件或文件夹不存在，请编辑入口更新路径');
    const wasExpanded = expanded;
    // Hide before transferring focus so the launch target remains the foreground application.
    collapse(false);
    const launchGeneration = generation;
    try {
      const result = await (action.kind === 'plugin' ? api.redirect(action.target) : action.kind === 'url' ? api.shellOpenExternal(action.target) : api.shellOpenPath(action.target));
      if (result === false || result?.success === false || (typeof result === 'string' && result)) throw new Error(action.kind === 'plugin' ? '未找到插件指令，请检查插件是否已安装、名称和指令是否一致' : result?.error || result || '打开失败');
      // redirect's boolean only acknowledges dispatch; target resolution belongs to the host.
      return action.kind === 'plugin' ? { submitted: true } : { success: true };
    } catch (e) { if (wasExpanded && !disposed && config.settings.enabled && generation === launchGeneration) expand(); if (!disposed) report(e); throw e; }
  }
  function report(e) { const message = e.message || String(e); if (error !== message) { error = message; notify('runtime'); } }
  function dispose() { disposed = true; stopWindows(); if (live(editor)) editor.destroy(); editor = null; }
  async function settings() {
    if (disposed) return false;
    collapse(false);
    if (!live(editor)) {
      if (refreshDisplays()) layout();
      const display = displays().find(d => String(d.id) === config.settings.displayId) || primaryDisplay;
      const area = display.workArea || display.bounds;
      const width = Math.min(920, area.width), height = Math.min(720, area.height);
      editor = api.createBrowserWindow('index.html?surface=settings', {
        title: '程序坞设置', frame: true, transparent: false, show: false, resizable: true,
        minWidth: Math.min(560, area.width), minHeight: Math.min(420, area.height),
        width, height, x: area.x + Math.floor((area.width - width) / 2), y: area.y + Math.floor((area.height - height) / 2),
        backgroundColor: '#f4f7fa', autoHideMenuBar: true,
        webPreferences: { preload: 'child-preload.cjs', backgroundThrottling: true }
      });
    }
    // Await hiding the launcher before focusing the editor; otherwise focus restoration wins the race.
    await api.hideMainWindow();
    if (disposed || !live(editor)) return false;
    if (editor.isMinimized()) editor.restore();
    editor.show(); editor.focus(); notify('runtime'); return true;
  }
  function focus() { if (live(panel)) { panel.show(); panel.focus(); } }
  function windows() { return [trigger, panel, editor].filter(live); }
  function isSettingsSender(id) { return live(editor) && editor.webContents.id === id; }
  function isPanelSender(id) { return live(panel) && panel.webContents.id === id; }
  function queueAddition(value) { addition=value;additionId=randomUUID();notify('runtime'); }
  function takeAddition() { const value=addition;addition=null;additionId='';notify('runtime');return value; }
  function init() { if (config.settings.enabled) ensureWindows(); notify(); }
  return { init, snapshot, save, start, pause, resetAppearance, expand, collapse, hover, pin, select, run, dispose, settings, focus, windows, isSettingsSender, isPanelSender, panelLayout, queueAddition, takeAddition, report, notify };
}
module.exports = { createController };
