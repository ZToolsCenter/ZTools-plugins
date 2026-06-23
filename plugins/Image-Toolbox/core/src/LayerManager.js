import eventBus from './EventBus.js';

/**
 * 图层管理器 — 管理 Fabric.js 物件的 z-order、显隐、锁定
 * 每个 Fabric Object 即为一个"图层"
 */
class LayerManager {
  constructor(canvasManager) {
    this._cm = canvasManager;
    this._layers = [];           // 图层元数据 [{ id, name, visible, locked, fabricObj }]
    this._idCounter = 0;
  }

  /**
   * 同步图层列表（从画布物件重建）
   */
  syncLayers() {
    const canvas = this._cm.canvas;
    if (!canvas) return;

    const objects = canvas.getObjects();
    const oldLayers = this._layers;   // 保留旧列表用于查找已有元数据
    const currentObjects = new Set(objects);
    const newLayers = [];

    // 先处理非背景图层：从后往前（画布中后面的是上层 → 放在面板顶部）
    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i];
      // 背景图层单独处理
      if (obj === this._cm.originalImage) continue;

      // 跳过标记为不显示在图层面板的对象（如裁剪遮罩/裁剪框）
      if (obj.excludeFromLayer) continue;

      // 在旧列表中查找已有元数据（优先按对象引用，替换对象时再按稳定 id 匹配）
      let meta = oldLayers.find(l => l.fabricObj === obj) || null;
      if (!meta && obj.id) {
        meta = oldLayers.find(l => !newLayers.includes(l) && l.fabricObj?.id === obj.id) || null;
      }
      if (!meta) {
        meta = this._createMeta(obj, false, newLayers, currentObjects);
      } else {
        meta.fabricObj = obj;
        this._refreshMetaName(meta, obj, false, newLayers, currentObjects);
      }
      meta.zIndex = objects.length - 1 - i;
      newLayers.push(meta);
    }

    // 背景图层始终在列表末尾（面板最底部）
    if (this._cm.originalImage) {
      let bgMeta = oldLayers.find(l => l.fabricObj === this._cm.originalImage) || null;
      if (!bgMeta) {
        bgMeta = this._createMeta(this._cm.originalImage, true, newLayers, currentObjects);
      } else {
        bgMeta.fabricObj = this._cm.originalImage;
        this._refreshMetaName(bgMeta, this._cm.originalImage, true, newLayers, currentObjects);
      }
      bgMeta.zIndex = 0;
      newLayers.push(bgMeta);
    }

    this._layers = newLayers;
    eventBus.emit('layers:updated', this._layers);
  }

  /**
   * 获取图层列表
   * @returns {Array}
   */
  getLayers() {
    return this._layers;
  }

  /**
   * 根据 ID 查找图层元数据
   * @param {number} layerId
   * @returns {object|null}
   */
  getLayerById(layerId) {
    return this._layers.find(l => l.id === layerId) || null;
  }

  /**
   * 根据 fabricObj 查找图层元数据
   * @param {fabric.Object} obj
   * @returns {object|null}
   */
  _findMeta(obj) {
    return this._layers.find(l => l.fabricObj === obj) || null;
  }

  /**
   * 根据 Fabric 对象获取图层元数据
   * @param {fabric.Object} obj
   * @returns {object|null}
   */
  getLayerByObject(obj) {
    return this._findMeta(obj);
  }

  _createMeta(obj, isBackground = false, newLayers = null, currentObjects = null) {
    const id = ++this._idCounter;
    const nameInfo = this._resolveLayerName(obj, isBackground, newLayers, null, currentObjects);

    const meta = {
      id,
      name: nameInfo.name,
      visible: obj.visible !== false,
      locked: isBackground ? true : (!obj.selectable && !obj.evented),
      fabricObj: obj,
      zIndex: 0,
      isBackground,
    };

    if (!isBackground) {
      this._setObjectLayerName(obj, meta.name, nameInfo.auto, nameInfo.baseName);
    }

    return meta;
  }

  _refreshMetaName(meta, obj, isBackground = false, newLayers = null, currentObjects = null) {
    const nameInfo = this._resolveLayerName(obj, isBackground, newLayers, meta, currentObjects);
    meta.name = nameInfo.name;

    if (!isBackground) {
      this._setObjectLayerName(obj, meta.name, nameInfo.auto, nameInfo.baseName);
    }
  }

  _resolveLayerName(obj, isBackground = false, newLayers = null, currentMeta = null, currentObjects = null) {
    if (isBackground) {
      return { name: '背景', auto: false, baseName: '背景' };
    }

    const savedName = this._getObjectLayerName(obj);
    const isAutoName = obj?._layerNameAuto === true
      || !savedName
      || (obj?._layerNameAuto !== false && this._isLegacyDefaultLayerName(savedName, obj));
    if (!isAutoName && savedName) {
      return { name: savedName, auto: false, baseName: '' };
    }

    const baseName = this._getDefaultLayerBaseName(obj);
    if (savedName
      && obj?._layerBaseName === baseName
      && !this._isLayerNameUsed(savedName, newLayers, currentMeta, currentObjects)) {
      return { name: savedName, auto: true, baseName };
    }

    return {
      name: this._getUniqueDefaultLayerName(baseName, newLayers, currentMeta, currentObjects),
      auto: true,
      baseName,
    };
  }

  _getDefaultLayerBaseName(obj) {
    if (this._isTextLayerObject(obj)) {
      const text = this._normalizeLayerText(obj.text);
      return text ? `文字 - ${text}` : '文字';
    }

    if (this._isBrushLayerObject(obj)) {
      return this._joinLayerNameParts(
        '画笔',
        obj._layerColorPresetName || this._getBrushColorPresetName(obj.stroke),
        obj._layerWidthPresetName || this._getBrushWidthPresetName(obj.strokeWidth)
      );
    }

    if (this._isMosaicLayerObject(obj)) {
      return this._joinLayerNameParts('马赛克', obj._layerPresetName || this._getMosaicPresetName(obj));
    }

    // 按对象功能命名（不是按 Fabric type 字面翻译）
    const funcLabelMap = {
      'image': '马赛克',       // 非背景图片 = 马赛克覆盖层
      'i-text': '文字',
      'textbox': '文字',
      'text': '文字',
      'rect': '矩形',
      'circle': '圆形',
      'path': '涂鸦',
      'group': '组合',
    };

    return funcLabelMap[obj?.type] || '图层';
  }

  _getUniqueDefaultLayerName(baseName, newLayers = null, currentMeta = null, currentObjects = null) {
    let name = baseName;
    let index = 2;

    while (this._isLayerNameUsed(name, newLayers, currentMeta, currentObjects)) {
      name = `${baseName} - ${index}`;
      index++;
    }

    return name;
  }

  _isLayerNameUsed(name, newLayers = null, currentMeta = null, currentObjects = null) {
    const layers = [...(newLayers || []), ...this._layers];
    return layers.some(layer => {
      if (!layer || layer === currentMeta || layer.name !== name) return false;
      if (!currentObjects || !layer.fabricObj) return true;
      return currentObjects.has(layer.fabricObj);
    });
  }

  _isTextLayerObject(obj) {
    return obj?.type === 'i-text' || obj?.type === 'text' || obj?.type === 'textbox';
  }

  _isBrushLayerObject(obj) {
    return obj?._layerKind === 'brush'
      || (typeof obj?.id === 'string' && obj.id.startsWith('brush_'));
  }

  _isMosaicLayerObject(obj) {
    return obj?._layerKind === 'mosaic'
      || obj?._mosaicDynamic === true
      || (typeof obj?.id === 'string' && obj.id.startsWith('mosaic_'));
  }

  _isLegacyDefaultLayerName(name, obj) {
    const label = this._getLegacyTypeLabel(obj);
    if (!label) return false;

    return new RegExp(`^${this._escapeRegExp(label)}-\\d+$`).test(name);
  }

  _getLegacyTypeLabel(obj) {
    const legacyLabelMap = {
      'image': '马赛克',
      'i-text': '文字',
      'textbox': '文字',
      'text': '文字',
      'rect': '矩形',
      'circle': '圆形',
      'path': '涂鸦',
      'group': '组合',
    };

    return legacyLabelMap[obj?.type] || '图层';
  }

  _getBrushColorPresetName(color) {
    const colorMap = {
      '#d83b31': '红',
      '#1677ff': '蓝',
      '#ffd700': '黄',
      '#2ead4a': '绿',
      '#ffffff': '白',
      '#111111': '黑',
    };

    return colorMap[this._normalizeColor(color)] || '';
  }

  _getBrushWidthPresetName(width) {
    const widthMap = {
      3: '细',
      6: '中',
      12: '粗',
      24: '特粗',
    };

    return widthMap[Math.round(Number(width))] || '';
  }

  _getMosaicPresetName(obj) {
    if ((obj?._mosaicMode || 'mosaic') === 'blur') {
      const blurMap = {
        6: '轻模糊',
        12: '中模糊',
        18: '强模糊',
      };
      return blurMap[Math.round(Number(obj._mosaicBlurRadius))] || '';
    }

    const mosaicMap = {
      6: '轻马赛克',
      12: '中马赛克',
      24: '重马赛克',
    };
    return mosaicMap[Math.round(Number(obj?._mosaicSize))] || '';
  }

  _normalizeColor(color) {
    if (typeof color !== 'string') return '';

    const value = color.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/i.test(value)) return value;
    if (/^#[0-9a-f]{3}$/i.test(value)) {
      return '#' + value.slice(1).split('').map(ch => ch + ch).join('');
    }

    return '';
  }

  _escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  _joinLayerNameParts(baseName, ...parts) {
    return [baseName, ...parts]
      .map(part => String(part || '').trim())
      .filter(Boolean)
      .join(' - ');
  }

  _normalizeLayerText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  _getObjectLayerName(obj) {
    if (typeof obj?._layerName !== 'string') return '';

    return obj._layerName.trim() ? obj._layerName : '';
  }

  _setObjectLayerName(obj, name, auto = false, baseName = '') {
    if (!obj || typeof name !== 'string' || !name.trim()) return;

    obj._layerName = name;
    obj._layerNameAuto = !!auto;
    obj._layerBaseName = auto ? (baseName || name) : '';
  }

  /**
   * 切换图层可见性
   * @param {number} layerId
   */
  toggleVisibility(layerId) {
    const meta = this._layers.find(l => l.id === layerId);
    if (!meta) return;

    this.setVisibility(layerId, !meta.visible);
  }

  /**
   * 设置图层可见性
   * @param {number} layerId
   * @param {boolean} visible
   */
  setVisibility(layerId, visible) {
    const meta = this._layers.find(l => l.id === layerId);
    if (!meta) return;

    meta.visible = !!visible;
    meta.fabricObj.set({ visible: meta.visible });
    this._cm.canvas.renderAll();
    eventBus.emit('layers:updated', this._layers);
    eventBus.emit('layer:visibilityChanged', meta);
  }

  /**
   * 切换图层锁定
   * @param {number} layerId
   */
  toggleLock(layerId) {
    const meta = this._layers.find(l => l.id === layerId);
    if (!meta || meta.isBackground) return;

    this.setLock(layerId, !meta.locked);
  }

  /**
   * 设置图层锁定状态
   * @param {number} layerId
   * @param {boolean} locked
   */
  setLock(layerId, locked) {
    const meta = this._layers.find(l => l.id === layerId);
    if (!meta || meta.isBackground) return;

    meta.locked = !!locked;
    meta.fabricObj.set({
      selectable: !meta.locked,
      evented: !meta.locked,
    });
    if (meta.locked && this._cm.canvas.getActiveObject() === meta.fabricObj) {
      this._cm.canvas.discardActiveObject();
    }
    this._cm.canvas.renderAll();
    eventBus.emit('layers:updated', this._layers);
    eventBus.emit('layer:lockChanged', meta);
  }

  /**
   * 选中图层
   * @param {number} layerId
   */
  selectLayer(layerId) {
    const meta = this._layers.find(l => l.id === layerId);
    if (!meta || meta.locked) return;

    this._cm.canvas.setActiveObject(meta.fabricObj);
    this._cm.canvas.renderAll();
    eventBus.emit('layer:selected', meta);
  }

  /**
   * 删除图层
   * @param {number} layerId
   */
  deleteLayer(layerId) {
    const meta = this._layers.find(l => l.id === layerId);
    if (!meta || meta.locked || meta.isBackground) return;

    this._cm.canvas.remove(meta.fabricObj);
    this._layers = this._layers.filter(l => l.id !== layerId);
    this._cm.canvas.renderAll();
    eventBus.emit('layers:updated', this._layers);
  }

  /**
   * 图层上移
   * @param {number} layerId
   */
  moveUp(layerId) {
    const meta = this._layers.find(l => l.id === layerId);
    if (!meta || meta.isBackground) return;

    this._cm.canvas.bringForward(meta.fabricObj);
    this._cm.canvas.renderAll();
    this.syncLayers();
  }

  /**
   * 图层下移
   * @param {number} layerId
   */
  moveDown(layerId) {
    const meta = this._layers.find(l => l.id === layerId);
    if (!meta || meta.isBackground) return;

    this._cm.canvas.sendBackwards(meta.fabricObj);
    this._cm.canvas.renderAll();
    this.syncLayers();
  }

  /**
   * 置顶
   * @param {number} layerId
   */
  bringToFront(layerId) {
    const meta = this._layers.find(l => l.id === layerId);
    if (!meta || meta.isBackground) return;

    this._cm.canvas.bringToFront(meta.fabricObj);
    this._cm.canvas.renderAll();
    this.syncLayers();
  }

  /**
   * 置底（在原图之上）
   * @param {number} layerId
   */
  sendToBack(layerId) {
    const meta = this._layers.find(l => l.id === layerId);
    if (!meta || meta.isBackground) return;

    const objects = this._cm.canvas.getObjects();
    const imgIndex = objects.indexOf(this._cm.originalImage);
    this._cm.canvas.moveTo(meta.fabricObj, imgIndex + 1);
    this._cm.canvas.renderAll();
    this.syncLayers();
  }

  /**
   * 按图层面板位置重排图层（0 = 顶部，背景图层固定在底部）
   * @param {number} layerId
   * @param {number} targetPanelIndex
   * @returns {boolean} 是否发生了重排
   */
  reorderLayer(layerId, targetPanelIndex) {
    const meta = this._layers.find(l => l.id === layerId);
    if (!meta || meta.isBackground || !this._cm.canvas) return false;

    const overlayLayers = this._layers.filter(l => !l.isBackground);
    const fromIndex = overlayLayers.findIndex(l => l.id === layerId);
    if (fromIndex === -1 || overlayLayers.length < 2) return false;

    let insertIndex = Math.max(0, Math.min(targetPanelIndex, overlayLayers.length));
    if (fromIndex < insertIndex) insertIndex -= 1;
    if (insertIndex === fromIndex) return false;

    const [movedLayer] = overlayLayers.splice(fromIndex, 1);
    overlayLayers.splice(insertIndex, 0, movedLayer);

    eventBus.emit('layer:reorderWillChange', {
      layer: movedLayer,
      fromIndex,
      toIndex: insertIndex,
    });

    this._applyPanelOrder(overlayLayers);
    this._cm.canvas.renderAll();
    this.syncLayers();

    eventBus.emit('layer:reordered', {
      layer: movedLayer,
      fromIndex,
      toIndex: insertIndex,
    });

    return true;
  }

  _applyPanelOrder(overlayLayers) {
    const canvas = this._cm.canvas;
    const objects = canvas.getObjects();
    const backgroundIndex = objects.indexOf(this._cm.originalImage);
    const startIndex = backgroundIndex >= 0 ? backgroundIndex + 1 : 0;
    const bottomToTopLayers = overlayLayers.slice().reverse();

    bottomToTopLayers.forEach((layer, index) => {
      canvas.moveTo(layer.fabricObj, startIndex + index);
    });
  }

  /**
   * 图层重命名
   * @param {number} layerId
   * @param {string} newName
   */
  renameLayer(layerId, newName) {
    const meta = this._layers.find(l => l.id === layerId);
    if (!meta) return;
    meta.name = newName;
    this._setObjectLayerName(meta.fabricObj, newName, false);
    eventBus.emit('layers:updated', this._layers);
  }

  /**
   * 获取图层数量
   * @returns {number}
   */
  getCount() {
    return this._layers.length;
  }
}

export default LayerManager;
