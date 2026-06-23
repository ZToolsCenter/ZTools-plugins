/**
 * LayerStore — 纯数据图层模型
 *
 * 零 DOM、零 fabric、零平台依赖。
 * 图层用 engineId 关联渲染引擎对象，不保存任何引擎对象引用。
 *
 * @example
 * const store = new LayerStore({ eventBus });
 * store.addLayer({ engineId: 'obj_1', type: 'brush', name: '画笔' });
 * store.getLayers(); // [{ id: 1, engineId: 'obj_1', ... }]
 */
let _globalIdCounter = 0;

export default class LayerStore {
  /**
   * @param {object} options
   * @param {import('./EventBus.js').EventBus} [options.eventBus]
   */
  constructor({ eventBus = null } = {}) {
    this._eventBus = eventBus;
    this._layers = [];
    this._idCounter = 0;
  }

  // ── 查询 ──

  /** @returns {LayerModel[]} */
  getLayers() { return this._layers.slice(); }

  /** @returns {number} */
  getCount() { return this._layers.length; }

  /**
   * @param {number} layerId
   * @returns {LayerModel|null}
   */
  getById(layerId) {
    return this._layers.find(l => l.id === layerId) || null;
  }

  /**
   * @param {string} engineId
   * @returns {LayerModel|null}
   */
  getByEngineId(engineId) {
    return this._layers.find(l => l.engineId === engineId) || null;
  }

  /**
   * 获取非背景图层列表（面板用，顶层在前）。
   * @returns {LayerModel[]}
   */
  getOverlayLayers() {
    return this._layers.filter(l => !l.isBackground);
  }

  /**
   * 获取背景图层。
   * @returns {LayerModel|null}
   */
  getBackground() {
    return this._layers.find(l => l.isBackground) || null;
  }

  // ── 增删 ──

  /**
   * 添加图层。
   * @param {object} input - { engineId, type, name, visible, locked, opacity, metadata }
   * @returns {LayerModel}
   */
  addLayer(input) {
    const id = ++this._idCounter;
    const layer = {
      id,
      engineId: input.engineId || '',
      name: input.name || this._defaultName(input.type),
      type: input.type || 'image',
      visible: input.visible !== false,
      locked: !!input.locked,
      opacity: typeof input.opacity === 'number' ? input.opacity : 1,
      isBackground: !!input.isBackground,
      zIndex: 0,
      metadata: input.metadata ? { ...input.metadata } : {},
    };

    this._layers.push(layer);
    this._renumberZIndex();
    this._notify('layers:added', layer);
    return { ...layer };
  }

  /**
   * 删除图层。
   * @param {number} layerId
   * @returns {boolean}
   */
  removeLayer(layerId) {
    const idx = this._layers.findIndex(l => l.id === layerId);
    if (idx === -1) return false;

    const [removed] = this._layers.splice(idx, 1);
    this._renumberZIndex();
    this._notify('layers:removed', removed);
    return true;
  }

  // ── 修改 ──

  /**
   * 更新图层属性。
   * @param {number} layerId
   * @param {object} patch - { name?, visible?, locked?, opacity?, metadata? }
   * @returns {LayerModel|null}
   */
  updateLayer(layerId, patch) {
    const layer = this.getById(layerId);
    if (!layer) return null;

    if (patch.name !== undefined) layer.name = patch.name;
    if (patch.visible !== undefined) layer.visible = !!patch.visible;
    if (patch.locked !== undefined) layer.locked = !!patch.locked;
    if (patch.opacity !== undefined) layer.opacity = patch.opacity;
    if (patch.engineId !== undefined) layer.engineId = patch.engineId;
    if (patch.metadata !== undefined) {
      layer.metadata = { ...layer.metadata, ...patch.metadata };
    }

    this._notify('layers:updated', layer);
    return { ...layer };
  }

  /**
   * 切换可见性。
   * @param {number} layerId
   * @returns {LayerModel|null}
   */
  toggleVisibility(layerId) {
    const layer = this.getById(layerId);
    if (!layer) return null;
    return this.updateLayer(layerId, { visible: !layer.visible });
  }

  /**
   * 切换锁定。
   * @param {number} layerId
   * @returns {LayerModel|null}
   */
  toggleLock(layerId) {
    const layer = this.getById(layerId);
    if (!layer || layer.isBackground) return null;
    return this.updateLayer(layerId, { locked: !layer.locked });
  }

  // ── 排序 ──

  /**
   * 将图层移到目标面板位置（0 = 顶部，背景图层固定在底部）。
   * @param {number} layerId
   * @param {number} targetPanelIndex
   * @returns {boolean}
   */
  reorder(layerId, targetPanelIndex) {
    const layer = this.getById(layerId);
    if (!layer || layer.isBackground) return false;

    const overlays = this.getOverlayLayers();
    const fromIndex = overlays.findIndex(l => l.id === layerId);
    if (fromIndex === -1 || overlays.length < 2) return false;

    let insertIndex = Math.max(0, Math.min(targetPanelIndex, overlays.length));
    if (fromIndex < insertIndex) insertIndex -= 1;
    if (insertIndex === fromIndex) return false;

    // 从 _layers 中取出并插入
    const globalFrom = this._layers.indexOf(layer);
    this._layers.splice(globalFrom, 1);

    // 找到插入位置的全局索引
    const targetOverlay = overlays[insertIndex];
    const globalTo = targetOverlay
      ? this._layers.indexOf(targetOverlay)
      : this._layers.length;
    this._layers.splice(globalTo, 0, layer);

    this._renumberZIndex();
    this._notify('layers:reordered', { layer, fromIndex, toIndex: insertIndex });
    return true;
  }

  /**
   * 图层上移（向顶部方向）。
   * @param {number} layerId
   */
  moveUp(layerId) {
    const overlays = this.getOverlayLayers();
    const idx = overlays.findIndex(l => l.id === layerId);
    if (idx <= 0) return;
    this.reorder(layerId, idx - 1);
  }

  /**
   * 图层下移（向底部方向）。
   * @param {number} layerId
   */
  moveDown(layerId) {
    const overlays = this.getOverlayLayers();
    const idx = overlays.findIndex(l => l.id === layerId);
    if (idx === -1 || idx >= overlays.length - 1) return;
    this.reorder(layerId, idx + 2);
  }

  /**
   * 置顶。
   * @param {number} layerId
   */
  bringToFront(layerId) { this.reorder(layerId, 0); }

  /**
   * 置底（在背景之上）。
   * @param {number} layerId
   */
  sendToBack(layerId) {
    const overlays = this.getOverlayLayers();
    this.reorder(layerId, overlays.length - 1);
  }

  // ── 重命名 ──

  /**
   * @param {number} layerId
   * @param {string} newName
   * @returns {LayerModel|null}
   */
  rename(layerId, newName) {
    return this.updateLayer(layerId, { name: newName });
  }

  // ── 序列化 ──

  /**
   * 导出为纯数据。
   * @returns {LayerModel[]}
   */
  toJSON() {
    return this._layers.map(l => ({ ...l, metadata: { ...l.metadata } }));
  }

  /**
   * 从纯数据恢复。
   * @param {LayerModel[]} data
   */
  fromJSON(data) {
    if (!Array.isArray(data)) return;
    this._layers = data.map(l => ({
      ...l,
      metadata: l.metadata ? { ...l.metadata } : {},
    }));
    this._idCounter = this._layers.reduce((max, l) => Math.max(max, l.id || 0), 0);
    this._renumberZIndex();
    this._notify('layers:restored');
  }

  // ── 内部 ──

  _renumberZIndex() {
    let z = this._layers.length;
    for (const layer of this._layers) {
      layer.zIndex = z--;
    }
  }

  _defaultName(type) {
    const names = {
      background: '背景',
      image: '图片',
      text: '文字',
      brush: '画笔',
      mosaic: '马赛克',
      shape: '形状',
      group: '组合',
    };
    return names[type] || '图层';
  }

  _notify(event, ...args) {
    if (this._eventBus) {
      this._eventBus.emit(event, ...args);
      this._eventBus.emit('layers:changed', this._layers);
    }
  }
}
