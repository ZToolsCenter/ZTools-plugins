/**
 * ORA (OpenRaster) 格式导入/导出模块
 *
 * OpenRaster 是开放的栅格图层交换格式，本质是 ZIP 文件：
 *   mimetype          — 固定字符串 "image/openraster"
 *   mergedimage.png   — 合并预览图
 *   stack.xml         — 图层结构描述
 *   data/layerN.png   — 各图层 PNG
 *
 * 规范参考: https://www.openraster.org/
 *
 * 本模块使用 JSZip (MIT) 进行 ZIP 打包/解压。
 * JSZip 通过 <script> 标签全局引入，在 index.html 中加载 core/src/lib/jszip.min.js。
 *
 * 导出：Fabric.js 画布对象 → 每层 PNG + stack.xml → ZIP (.ora)
 * 导入：ZIP (.ora) → stack.xml + PNG → Fabric.js 对象
 */

import eventBus from '../EventBus.js';

const ORA_MIMETYPE = 'image/openraster';

// ── XML 辅助 ──

function _escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function _parseXml(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'text/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('stack.xml 解析失败: ' + parseError.textContent);
  }
  return doc;
}

// ── 图层元数据提取 ──

function _getLayerName(obj, layerManager) {
  if (layerManager) {
    const meta = layerManager.getLayerByObject?.(obj);
    if (meta?.name) return meta.name;
  }
  if (obj._layerName) return obj._layerName;
  const typeMap = {
    'i-text': '文字', 'text': '文字', 'textbox': '文字',
    'rect': '矩形', 'circle': '圆形', 'path': '画笔',
    'image': '图层', 'group': '组合',
  };
  return typeMap[obj?.type] || '图层';
}

function _getLayerOpacity(obj) {
  const opacity = obj.opacity ?? 1;
  return Math.max(0, Math.min(1, opacity));
}

function _getLayerVisibility(obj) {
  return obj.visible !== false;
}

// ── Fabric 对象序列化/反序列化 ──

/**
 * 将 Fabric 对象序列化为 Base64 编码的 JSON 字符串
 * 用于在 ORA stack.xml 的自定义属性中嵌入完整矢量信息
 */
function _serializeFabricObject(obj) {
  try {
    const jsonObj = obj.toJSON([
      'id', '_layerName', '_layerKind', '_layerColorPresetName',
      '_layerWidthPresetName', '_originalImage', 'excludeFromLayer',
      'excludeFromProperty', 'excludeFromHistory', 'excludeFromExport',
    ]);
    // 对于 Image 类型，如果 src 是 dataURL 且过大，跳过序列化
    // 避免 XML 属性过大导致解析失败
    if (obj.type === 'image' && jsonObj.src && jsonObj.src.length > 500000) {
      console.warn('[ORA] Image src 过大，跳过 fab:json 序列化:', jsonObj.src.length);
      return null;
    }
    const json = JSON.stringify(jsonObj);
    // Base64 编码避免 XML 特殊字符问题
    return btoa(unescape(encodeURIComponent(json)));
  } catch (e) {
    console.warn('[ORA] 序列化 Fabric 对象失败:', e);
    return null;
  }
}

/**
 * 从 Base64 编码的 JSON 字符串反序列化 Fabric 对象
 * @returns {Promise<object|null>} 重建的 Fabric 对象
 */
async function _deserializeFabricObject(base64Str) {
  try {
    const jsonStr = decodeURIComponent(escape(atob(base64Str)));
    const objData = JSON.parse(jsonStr);
    // 使用 fabric.util.enlivenObjects 重建对象
    return await new Promise((resolve) => {
      let resolved = false;
      // 超时保护：5 秒后返回 null，避免 enlivenObjects 回调不触发
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.warn('[ORA] 反序列化超时');
          resolve(null);
        }
      }, 5000);

      try {
        fabric.util.enlivenObjects([objData], (enlivened) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            resolve(enlivened && enlivened.length > 0 ? enlivened[0] : null);
          }
        });
      } catch (e) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          console.warn('[ORA] enlivenObjects 异常:', e);
          resolve(null);
        }
      }
    });
  } catch (e) {
    console.warn('[ORA] 反序列化 Fabric 对象失败:', e);
    return null;
  }
}

// ── 对象渲染为 PNG ──

/**
 * 将单个 Fabric.js 对象渲染为 PNG dataURL
 * 渲染到一个与画布同尺寸的透明 canvas 上，对象保留原始位置/变换
 * 这样 ORA layer 的 x=0, y=0 即可正确定位
 *
 * @param {object} obj - Fabric 对象
 * @param {number} canvasWidth - 画布宽度
 * @param {number} canvasHeight - 画布高度
 * @returns {{dataURL: string, width: number, height: number}|null}
 */
function _renderObjectToPng(obj, canvasWidth, canvasHeight) {
  try {
    obj.setCoords();
    const width = Math.max(1, Math.round(canvasWidth));
    const height = Math.max(1, Math.round(canvasHeight));

    // 创建与画布同尺寸的透明 canvas
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const ctx = tempCanvas.getContext('2d');

    // 直接用对象的 render 方法将对象绘制到 canvas 上
    // render 会应用对象的所有变换（scale, angle, flip 等）
    obj.render(ctx);

    const dataURL = tempCanvas.toDataURL('image/png');
    return { dataURL, width, height };
  } catch (err) {
    console.warn('[ORA] 渲染对象失败:', obj?.type, err);
    return null;
  }
}

/**
 * 将背景图片渲染为 PNG
 * 渲染到与画布同尺寸的透明 canvas 上，保留原始位置和变换
 */
function _renderBackgroundToPng(canvasManager, canvasWidth, canvasHeight) {
  const img = canvasManager.originalImage;
  if (!img) return null;

  try {
    img.setCoords();
    const width = Math.max(1, Math.round(canvasWidth));
    const height = Math.max(1, Math.round(canvasHeight));

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const ctx = tempCanvas.getContext('2d');

    img.render(ctx);

    const dataURL = tempCanvas.toDataURL('image/png');
    return { dataURL, width, height };
  } catch (err) {
    console.warn('[ORA] 渲染背景图失败:', err);
    return null;
  }
}

/**
 * 将 dataURL 转为 Blob
 */
async function _dataURLToBlob(dataURL) {
  const response = await fetch(dataURL);
  return response.blob();
}

/**
 * 从 dataURL 加载 Fabric.Image
 */
function _loadImageFromDataURL(dataURL) {
  return new Promise((resolve) => {
    fabric.Image.fromURL(dataURL, (img, isError) => {
      if (isError || !img) {
        resolve(null);
        return;
      }
      resolve(img);
    }, undefined, undefined);
  });
}

// ═══════════════════════════════════════
// ORA 导出
// ═══════════════════════════════════════

/**
 * 导出为 ORA 文件
 * @param {object} canvasManager - CanvasManager 实例
 * @param {object} layerManager - LayerManager 实例
 * @param {object} [hostAdapter] - 宿主适配器（可选）
 * @returns {Promise<boolean>}
 */
export async function exportORA(canvasManager, layerManager, hostAdapter = null) {
  const canvas = canvasManager.canvas;
  if (!canvas) return false;

  try {
    const objects = canvas.getObjects();
    const originalImage = canvasManager.originalImage;

    // ORA 画布尺寸 = Fabric 画布尺寸（不含 viewportTransform）
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;

    const layers = [];

    // 1. 背景图层（原图）
    if (originalImage) {
      const bgPng = _renderBackgroundToPng(canvasManager, canvasWidth, canvasHeight);
      if (bgPng) {
        // 序列化完整 Fabric 对象 JSON，用于恢复缩放/旋转等变换属性
        const fabricJson = _serializeFabricObject(originalImage);

        layers.push({
          name: '背景',
          dataURL: bgPng.dataURL,
          left: 0,
          top: 0,
          opacity: _getLayerOpacity(originalImage),
          visible: _getLayerVisibility(originalImage),
          isBackground: true,
          fabricJson,
        });
      }
    }

    // 2. 覆盖图层（排除临时对象和背景）
    for (const obj of objects) {
      if (obj === originalImage) continue;
      if (obj.excludeFromLayer || obj.excludeFromHistory) continue;

      const png = _renderObjectToPng(obj, canvasWidth, canvasHeight);
      if (png) {
        // 序列化完整 Fabric 对象 JSON，用于往返恢复矢量信息
        const fabricJson = _serializeFabricObject(obj);

        layers.push({
          name: _getLayerName(obj, layerManager),
          dataURL: png.dataURL,
          left: 0,
          top: 0,
          opacity: _getLayerOpacity(obj),
          visible: _getLayerVisibility(obj),
          isBackground: false,
          fabricJson,
        });
      }
    }

    // 3. 生成合并预览图 — 渲染到与画布同尺寸的 canvas，不含 viewportTransform
    const mergedCanvas = document.createElement('canvas');
    mergedCanvas.width = canvasWidth;
    mergedCanvas.height = canvasHeight;
    const mergedCtx = mergedCanvas.getContext('2d');
    // 按顺序渲染所有可见对象
    const visibleObjects = objects.filter(obj => obj.visible !== false);
    for (const obj of visibleObjects) {
      try {
        obj.render(mergedCtx);
      } catch (e) {
        // 忽略单个对象渲染失败
      }
    }
    const mergedDataURL = mergedCanvas.toDataURL('image/png');

    // 4. 生成 stack.xml（ORA 中图层顺序：顶层在前，底层在后）
    const stackLayers = [...layers].reverse();
    const stackXml = _buildStackXml(stackLayers, canvasWidth, canvasHeight);

    // 5. 使用 JSZip 打包
    const zip = new JSZip();

    // mimetype（必须是第一个文件，STORE 方式无压缩）
    zip.file('mimetype', ORA_MIMETYPE, { compression: 'STORE' });

    // mergedimage.png
    const mergedBlob = await _dataURLToBlob(mergedDataURL);
    zip.file('mergedimage.png', mergedBlob);

    // stack.xml
    zip.file('stack.xml', stackXml);

    // data/layerN.png — 必须与 stack.xml 中的 src 索引一致（即 stackLayers 顺序）
    const dataFolder = zip.folder('data');
    for (let i = 0; i < stackLayers.length; i++) {
      const layerBlob = await _dataURLToBlob(stackLayers[i].dataURL);
      dataFolder.file(`layer${i}.png`, layerBlob);
    }

    // 6. 生成 ZIP Blob
    const zipBlob = await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/zip',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    // 7. 保存文件
    await _saveOraFile(zipBlob, hostAdapter);
    return true;
  } catch (err) {
    console.error('[ORA] 导出失败:', err);
    eventBus.emit('toast:show', { message: 'ORA 导出失败: ' + err.message, type: 'error' });
    return false;
  }
}

function _buildStackXml(layers, canvasWidth, canvasHeight) {
  const w = Math.round(canvasWidth);
  const h = Math.round(canvasHeight);
  const layerXml = layers.map((layer, i) => {
    let attrs = `name="${_escapeXml(layer.name)}" src="data/layer${i}.png" x="${layer.left}" y="${layer.top}" opacity="${layer.opacity}" visibility="${layer.visible ? 'visible' : 'hidden'}"`;
    if (layer.isBackground) attrs += ' background="true"';
    // 自定义命名空间扩展：嵌入完整 Fabric 对象 JSON
    if (layer.fabricJson) {
      attrs += ` fab:json="${_escapeXml(layer.fabricJson)}"`;
    }
    return `    <layer ${attrs} />`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<image version="0.0.2" w="${w}" h="${h}" xmlns:fab="https://fabjs.example/ns">
  <stack>
${layerXml}
  </stack>
</image>`;
}

async function _saveOraFile(zipBlob, hostAdapter) {
  // 优先使用宿主 ORA 保存对话框（Electron 环境）
  if (typeof window.showSaveOraDialog === 'function' && typeof window.writeBinaryFile === 'function') {
    const filePath = window.showSaveOraDialog('project.ora');
    if (!filePath) return;

    const oraPath = filePath.replace(/\.[^.]+$/, '') + '.ora';
    const arrayBuffer = await zipBlob.arrayBuffer();
    const saved = window.writeBinaryFile(oraPath, arrayBuffer);
    eventBus.emit('toast:show', {
      message: saved ? 'ORA 文件已保存' : '保存失败',
      type: saved ? 'success' : 'error',
    });
    return;
  }

  // 降级 1：使用 host adapter 的图片保存能力
  if (hostAdapter?.showSaveImageDialog && hostAdapter?.writeImageFile) {
    const filePath = hostAdapter.showSaveImageDialog('project.ora');
    if (!filePath) return;

    const oraPath = filePath.replace(/\.[^.]+$/, '') + '.ora';
    const arrayBuffer = await zipBlob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    const base64 = btoa(binary);
    const dataURL = `data:application/zip;base64,${base64}`;

    const saved = hostAdapter.writeImageFile(oraPath, dataURL);
    eventBus.emit('toast:show', {
      message: saved ? 'ORA 文件已保存' : '保存失败',
      type: saved ? 'success' : 'error',
    });
    return;
  }

  // 降级 2：浏览器下载
  const url = URL.createObjectURL(zipBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'project.ora';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  eventBus.emit('toast:show', { message: 'ORA 文件已下载', type: 'success' });
}

// ═══════════════════════════════════════
// ORA 导入
// ═══════════════════════════════════════

/**
 * 从 ORA 文件导入
 * @param {Blob} oraBlob - ORA 文件 Blob
 * @param {object} canvasManager - CanvasManager 实例
 * @param {object} layerManager - LayerManager 实例
 * @param {object} historyManager - HistoryManager 实例
 * @returns {Promise<boolean>}
 */
export async function importORA(oraBlob, canvasManager, layerManager, historyManager) {
  try {
    const zip = await JSZip.loadAsync(oraBlob);

    // 验证 mimetype
    const mimeFile = zip.file('mimetype');
    if (!mimeFile) {
      throw new Error('不是有效的 ORA 文件：缺少 mimetype');
    }
    const mimetype = await mimeFile.async('string');
    if (mimetype.trim() !== ORA_MIMETYPE) {
      throw new Error(`不是有效的 ORA 文件：mimetype = ${mimetype}`);
    }

    // 解析 stack.xml
    const xmlFile = zip.file('stack.xml');
    if (!xmlFile) {
      throw new Error('不是有效的 ORA 文件：缺少 stack.xml');
    }
    const xmlString = await xmlFile.async('string');
    const doc = _parseXml(xmlString);

    // 提取画布尺寸（ORA 规范要求 <image> 有 w 和 h 属性）
    const imageEl = doc.querySelector('image');
    const oraWidth = parseInt(imageEl?.getAttribute('w') || '0', 10) || 0;
    const oraHeight = parseInt(imageEl?.getAttribute('h') || '0', 10) || 0;
    if (oraWidth > 0 && oraHeight > 0) {
      canvasManager.canvas.setWidth(oraWidth);
      canvasManager.canvas.setHeight(oraHeight);
      canvasManager.canvas.calcOffset();
    }

    // 提取图层信息（按 stack.xml 中的顺序，顶层在前）
    const layerElements = Array.from(doc.querySelectorAll('layer'));
    const oraLayers = layerElements.map(el => {
      const src = el.getAttribute('src') || '';
      const x = parseInt(el.getAttribute('x') || '0', 10) || 0;
      const y = parseInt(el.getAttribute('y') || '0', 10) || 0;
      const opacity = parseFloat(el.getAttribute('opacity') || '1');
      const visibility = el.getAttribute('visibility') !== 'hidden';
      const name = el.getAttribute('name') || '图层';
      const isBackground = el.getAttribute('background') === 'true';
      // 提取自定义扩展属性：完整 Fabric 对象 JSON
      const fabricJsonB64 = el.getAttribute('fab:json') || el.getAttributeNS('https://fabjs.example/ns', 'json') || '';

      return { src, x, y, opacity, visibility, name, isBackground, fabricJsonB64 };
    });

    // 反转：从底层到顶层（与 Fabric.js 画布顺序一致）
    const orderedLayers = [...oraLayers].reverse();

    // 清空当前画布
    canvasManager.canvas.clear();
    canvasManager.originalImage = null;

    // 逐层加载
    let bgImage = null;
    let restoredAnyFromJson = false;

    for (let i = 0; i < orderedLayers.length; i++) {
      const layer = orderedLayers[i];
      const pngFile = zip.file(layer.src);
      if (!pngFile) {
        console.warn(`[ORA] 图层文件缺失: ${layer.src}`);
        continue;
      }

      const blob = await pngFile.async('blob');
      const dataURL = await _blobToDataURL(blob);

      // 优先尝试从扩展属性恢复原始矢量对象（含完整变换信息）
      let fabricObj = null;
      let fabricJsonData = null;
      let restoredFromJson = false;
      if (layer.fabricJsonB64) {
        try {
          const jsonStr = decodeURIComponent(escape(atob(layer.fabricJsonB64)));
          fabricJsonData = JSON.parse(jsonStr);
        } catch (e) {
          // 忽略解析失败
        }
        if (fabricJsonData) {
          fabricObj = await _deserializeFabricObject(layer.fabricJsonB64);
          if (fabricObj) {
            restoredFromJson = true;
            restoredAnyFromJson = true;
          }
        }
      }

      // 降级：从 PNG 图片加载
      if (!fabricObj) {
        fabricObj = await _loadImageFromDataURL(dataURL);
        // 如果有 fabricJson 但 enlivenObjects 失败，恢复变换属性
        if (fabricObj && fabricJsonData) {
          const transformProps = [
            'scaleX', 'scaleY', 'angle', 'flipX', 'flipY',
            'originX', 'originY', 'skewX', 'skewY',
            'cropX', 'cropY', 'left', 'top',
          ];
          const props = {};
          for (const key of transformProps) {
            if (fabricJsonData[key] !== undefined) {
              props[key] = fabricJsonData[key];
            }
          }
          if (Object.keys(props).length > 0) {
            fabricObj.set(props);
          }
        } else if (fabricObj) {
          // 没有 fabricJson，使用 stack.xml 中的位置
          // PNG 是画布尺寸大小，所以 x/y 就是对象在画布上的位置
          fabricObj.set({ left: layer.x, top: layer.y });
          // PNG 本身就是画布尺寸，不需要缩放
          fabricObj.set({ scaleX: 1, scaleY: 1 });
        }
      }
      if (!fabricObj) continue;

      fabricObj.set({
        opacity: layer.opacity,
        visible: layer.visibility,
      });

      if (layer.isBackground || i === 0) {
        fabricObj._originalImage = true;
        fabricObj._layerName = layer.name;
        canvasManager.originalImage = fabricObj;
        bgImage = fabricObj;
      } else {
        fabricObj._layerName = layer.name;
      }

      canvasManager.canvas.add(fabricObj);
    }

    // 恢复背景属性
    if (bgImage) {
      canvasManager._applyBackgroundImageProps?.(bgImage);
    }

    canvasManager.canvas.renderAll();

    // 仅在未能从 fab:json 恢复原始对象时执行 fitToCanvas
    // 因为 fab:json 恢复的对象已包含原始坐标/缩放，直接使用即可
    if (!restoredAnyFromJson) {
      canvasManager.fitToCanvas(40);
    }

    // 同步图层和历史记录
    layerManager.syncLayers();
    historyManager.clear();
    historyManager.saveState();

    eventBus.emit('image:loaded', bgImage);
    eventBus.emit('toast:show', { message: 'ORA 文件已导入', type: 'success' });
    return true;
  } catch (err) {
    console.error('[ORA] 导入失败:', err);
    eventBus.emit('toast:show', { message: 'ORA 导入失败: ' + err.message, type: 'error' });
    return false;
  }
}

/**
 * Blob 转 dataURL
 */
function _blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
