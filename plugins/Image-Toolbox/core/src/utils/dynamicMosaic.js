export const DYNAMIC_MOSAIC_PROPS = [
  'dynamicMosaic',
  'mosaicVersion',
  'mosaicEffect',
  'mosaicSize',
  'mosaicBlurRadius',
  'mosaicMaskType',
  'mosaicBrushPoints',
  'mosaicBrushSize',
];

const IDENTITY_VIEWPORT = [1, 0, 0, 1, 0, 0];

export function isDynamicMosaicObject(obj) {
  return !!obj?.dynamicMosaic;
}

export function createDynamicMosaicObject(rect, options = {}, maskOptions = {}) {
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;

  const img = new fabric.Image(tempCanvas, {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    selectable: false,
    evented: false,
    objectCaching: false,
    id: 'mosaic_' + Date.now(),
  });

  img.set({
    dynamicMosaic: true,
    mosaicVersion: 1,
    mosaicEffect: options.mode === 'blur' ? 'blur' : 'mosaic',
    mosaicSize: Math.max(2, parseInt(options.mosaicSize, 10) || 12),
    mosaicBlurRadius: Math.max(1, parseInt(options.blurRadius, 10) || 8),
    mosaicMaskType: maskOptions.type || 'rect',
    mosaicBrushPoints: maskOptions.brushPoints || null,
    mosaicBrushSize: maskOptions.brushSize || null,
  });

  img._dynamicMosaicCanvas = tempCanvas;
  return img;
}

export function hydrateDynamicMosaicObjects(canvas) {
  if (!canvas) return;
  canvas.getObjects().forEach(obj => {
    if (!isDynamicMosaicObject(obj)) return;
    ensureDynamicMosaicCanvas(obj);
    obj.set({ objectCaching: false });
    obj.dirty = true;
  });
}

export function queueDynamicMosaicUpdate(canvas, obj) {
  if (!canvas || !obj) return;

  const targets = getDynamicTargets(canvas, obj);
  if (targets.length === 0) return;

  const schedule = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (fn) => setTimeout(fn, 16);

  targets.forEach(target => {
    if (target._dynamicMosaicFrame) return;
    target._dynamicMosaicFrame = schedule(() => {
      target._dynamicMosaicFrame = null;
      updateDynamicMosaicObject(canvas, target, { render: true });
    });
  });
}

export function updateDynamicMosaics(canvas, options = {}) {
  if (!canvas) return;

  const objects = canvas.getObjects();
  const fromIndex = Number.isFinite(options.fromIndex) ? options.fromIndex : 0;
  let changed = false;

  objects.forEach((obj, index) => {
    if (index < fromIndex || !isDynamicMosaicObject(obj)) return;
    changed = updateDynamicMosaicObject(canvas, obj, { render: false }) || changed;
  });

  if (changed && options.render !== false) {
    requestCanvasRender(canvas);
  }
}

export function updateDynamicMosaicObject(canvas, obj, options = {}) {
  if (!canvas || !isDynamicMosaicObject(obj) || obj._dynamicMosaicUpdating) return false;

  const width = Math.max(1, Math.round(obj.width || obj._element?.width || 1));
  const height = Math.max(1, Math.round(obj.height || obj._element?.height || 1));
  const tempCanvas = ensureDynamicMosaicCanvas(obj, width, height);
  const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
  const sample = captureUnderlyingPixels(canvas, obj, width, height);

  if (!sample) return false;

  const maskData = createMaskData(obj, width, height);
  const effectData = new Uint8ClampedArray(sample.data.data);

  if (obj.mosaicEffect === 'blur') {
    blurPixels(effectData, width, height, obj.mosaicBlurRadius || 8, maskData);
  } else {
    mosaicPixels(effectData, width, height, obj.mosaicSize || 12, maskData);
  }

  const output = sample.data;
  const src = output.data;
  for (let i = 0; i < src.length; i += 4) {
    if (!maskData || maskData[i + 3] > 0) {
      src[i] = effectData[i];
      src[i + 1] = effectData[i + 1];
      src[i + 2] = effectData[i + 2];
      src[i + 3] = effectData[i + 3];
    } else {
      src[i] = 0;
      src[i + 1] = 0;
      src[i + 2] = 0;
      src[i + 3] = 0;
    }
  }

  tempCtx.clearRect(0, 0, width, height);
  tempCtx.putImageData(output, 0, 0);
  setImageElement(obj, tempCanvas);
  obj.dirty = true;

  if (options.render !== false) {
    requestCanvasRender(canvas);
  }

  return true;
}

function getDynamicTargets(canvas, obj) {
  const explicitTargets = obj.type === 'activeSelection' && typeof obj.getObjects === 'function'
    ? obj.getObjects().filter(isDynamicMosaicObject)
    : (isDynamicMosaicObject(obj) ? [obj] : []);

  if (explicitTargets.length === 0) return [];

  const objects = canvas.getObjects();
  const firstIndex = explicitTargets.reduce((min, target) => {
    const index = objects.indexOf(target);
    return index >= 0 ? Math.min(min, index) : min;
  }, objects.length);

  return objects.filter((candidate, index) => index >= firstIndex && isDynamicMosaicObject(candidate));
}

function ensureDynamicMosaicCanvas(obj, width, height) {
  const targetWidth = Math.max(1, Math.round(width || obj.width || obj._element?.width || 1));
  const targetHeight = Math.max(1, Math.round(height || obj.height || obj._element?.height || 1));
  let tempCanvas = obj._dynamicMosaicCanvas;

  if (!tempCanvas) {
    tempCanvas = document.createElement('canvas');
    obj._dynamicMosaicCanvas = tempCanvas;
  }

  if (tempCanvas.width !== targetWidth) tempCanvas.width = targetWidth;
  if (tempCanvas.height !== targetHeight) tempCanvas.height = targetHeight;
  setImageElement(obj, tempCanvas);
  return tempCanvas;
}

function setImageElement(obj, element) {
  if (obj._element === element) return;

  if (typeof obj.setElement === 'function') {
    obj.setElement(element);
  } else {
    obj._element = element;
    obj._originalElement = element;
  }
}

function captureUnderlyingPixels(canvas, obj, width, height) {
  const objects = canvas.getObjects();
  const objectIndex = objects.indexOf(obj);
  const hiddenObjects = objectIndex >= 0 ? objects.slice(objectIndex) : [];
  const visibilityBackups = [];
  const viewportTransform = canvas.viewportTransform?.slice();
  const activeObject = canvas._activeObject;
  const backgroundColor = canvas.backgroundColor;

  obj._dynamicMosaicUpdating = true;

  try {
    hiddenObjects.forEach(item => {
      visibilityBackups.push({ item, visible: item.visible });
      item.visible = false;
    });

    canvas._activeObject = null;
    canvas.viewportTransform = IDENTITY_VIEWPORT.slice();
    canvas.renderAll();

    const sampleWidth = Math.max(1, Math.round(width * Math.abs(obj.scaleX || 1)));
    const sampleHeight = Math.max(1, Math.round(height * Math.abs(obj.scaleY || 1)));
    const left = Math.round(obj.left || 0);
    const top = Math.round(obj.top || 0);
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = width;
    sourceCanvas.height = height;
    const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    const canvasEl = canvas.lowerCanvasEl || canvas.getElement?.();

    if (canvasEl) {
      sourceCtx.imageSmoothingEnabled = false;
      sourceCtx.drawImage(
        canvasEl,
        left,
        top,
        sampleWidth,
        sampleHeight,
        0,
        0,
        width,
        height
      );
    } else {
      const ctx = canvas.getContext();
      const imageData = ctx.getImageData(left, top, width, height);
      sourceCtx.putImageData(imageData, 0, 0);
    }

    if (backgroundColor) {
      const imageData = sourceCtx.getImageData(0, 0, width, height);
      return { data: imageData };
    }

    return { data: sourceCtx.getImageData(0, 0, width, height) };
  } finally {
    visibilityBackups.forEach(({ item, visible }) => {
      item.visible = visible;
    });
    if (viewportTransform) canvas.viewportTransform = viewportTransform;
    canvas._activeObject = activeObject;
    canvas.backgroundColor = backgroundColor;
    obj._dynamicMosaicUpdating = false;
  }
}

function createMaskData(obj, width, height) {
  if (obj.mosaicMaskType !== 'brush') return null;

  const points = Array.isArray(obj.mosaicBrushPoints) ? obj.mosaicBrushPoints : [];
  const brushSize = Math.max(1, parseFloat(obj.mosaicBrushSize) || 1);
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
  const radius = brushSize / 2;

  maskCtx.fillStyle = '#fff';
  points.forEach(point => {
    maskCtx.beginPath();
    maskCtx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    maskCtx.fill();
  });

  return maskCtx.getImageData(0, 0, width, height).data;
}

function mosaicPixels(data, width, height, blockSize, mask) {
  const size = Math.max(2, parseInt(blockSize, 10) || 12);

  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      if (mask && !blockHasMask(mask, width, height, x, y, size)) continue;

      let r = 0, g = 0, b = 0, a = 0, count = 0;
      for (let dy = 0; dy < size && y + dy < height; dy++) {
        for (let dx = 0; dx < size && x + dx < width; dx++) {
          const idx = ((y + dy) * width + (x + dx)) * 4;
          r += data[idx];
          g += data[idx + 1];
          b += data[idx + 2];
          a += data[idx + 3];
          count++;
        }
      }

      r = Math.round(r / count);
      g = Math.round(g / count);
      b = Math.round(b / count);
      a = Math.round(a / count);

      for (let dy = 0; dy < size && y + dy < height; dy++) {
        for (let dx = 0; dx < size && x + dx < width; dx++) {
          const idx = ((y + dy) * width + (x + dx)) * 4;
          if (!mask || mask[idx + 3] > 0) {
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = a;
          }
        }
      }
    }
  }
}

function blockHasMask(mask, width, height, x, y, size) {
  for (let dy = 0; dy < size && y + dy < height; dy++) {
    for (let dx = 0; dx < size && x + dx < width; dx++) {
      const idx = ((y + dy) * width + (x + dx)) * 4;
      if (mask[idx + 3] > 0) return true;
    }
  }
  return false;
}

function blurPixels(data, width, height, radius, mask) {
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = width;
  srcCanvas.height = height;
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  srcCtx.putImageData(new ImageData(data, width, height), 0, 0);

  const dstCanvas = document.createElement('canvas');
  dstCanvas.width = width;
  dstCanvas.height = height;
  const dstCtx = dstCanvas.getContext('2d', { willReadFrequently: true });
  dstCtx.filter = `blur(${Math.max(1, parseInt(radius, 10) || 8)}px)`;
  dstCtx.drawImage(srcCanvas, 0, 0);
  dstCtx.filter = 'none';

  const blurred = dstCtx.getImageData(0, 0, width, height).data;
  for (let i = 0; i < data.length; i += 4) {
    if (!mask || mask[i + 3] > 0) {
      data[i] = blurred[i];
      data[i + 1] = blurred[i + 1];
      data[i + 2] = blurred[i + 2];
      data[i + 3] = blurred[i + 3];
    }
  }
}

function requestCanvasRender(canvas) {
  if (typeof canvas.requestRenderAll === 'function') {
    canvas.requestRenderAll();
  } else {
    canvas.renderAll();
  }
}
