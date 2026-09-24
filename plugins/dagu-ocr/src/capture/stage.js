// 画布舞台：承载冻结画面与标注，并负责缩放/平移、坐标换算与导出。

import { createTransform, clampZoom, zoomAt, imageToViewport, viewportToImage, roundRect } from './geometry.js';
import { findAnnotationAt } from './hit-test.js';

export function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片加载失败'));
    image.src = src;
  });
}

export function createStage({ container, fabric = globalThis.fabric, backgroundColor = '#000000' }) {
  if (!container) throw new Error('缺少画布容器');
  if (!fabric) throw new Error('缺少 fabric 依赖');

  const canvasElement = document.createElement('canvas');
  canvasElement.className = 'capture-canvas';
  container.replaceChildren(canvasElement);

  const canvas = new fabric.Canvas(canvasElement, {
    backgroundColor,
    selection: false,
    preserveObjectStacking: true,
    renderOnAddRemove: false,
    stopContextMenu: true,
    fireRightClick: false
  });

  let transform = createTransform(1, 0, 0);
  let viewport = { width: 1, height: 1 };
  let imageElement = null;
  let backgroundObject = null;

  const stage = {
    canvas,

    get imageElement() {
      return imageElement;
    },

    get viewport() {
      return { ...viewport };
    },

    get transform() {
      return { ...transform };
    },

    imageSize() {
      return {
        width: imageElement?.naturalWidth || imageElement?.width || 0,
        height: imageElement?.naturalHeight || imageElement?.height || 0
      };
    },

    setViewportSize(width, height) {
      viewport = { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
      canvas.setDimensions({ width: viewport.width, height: viewport.height });
    },

    async setImage(source) {
      const element = typeof source === 'string' ? await loadImageElement(source) : source;
      if (!element) throw new Error('缺少截图内容');
      imageElement = element;
      backgroundObject = new fabric.Image(element, {
        left: 0,
        top: 0,
        selectable: false,
        evented: false,
        objectCaching: false
      });
      canvas.add(backgroundObject);
      canvas.sendToBack(backgroundObject);
      return element;
    },

    apply() {
      canvas.setViewportTransform([
        transform.scale,
        0,
        0,
        transform.scale,
        transform.offsetX,
        transform.offsetY
      ]);
      canvas.requestRenderAll();
    },

    setTransform(next) {
      transform = { ...next };
      stage.apply();
    },

    fit() {
      const size = stage.imageSize();
      if (!size.width || !size.height) return;
      const scale = Math.min(viewport.width / size.width, viewport.height / size.height);
      transform = createTransform(
        scale,
        (viewport.width - size.width * scale) / 2,
        (viewport.height - size.height * scale) / 2
      );
      stage.apply();
    },

    zoom(factor, focusViewportPoint) {
      transform = zoomAt(transform, factor, focusViewportPoint);
      stage.apply();
      return transform.scale;
    },

    zoomScale() {
      return transform.scale;
    },

    setZoomScale(scale, focusViewportPoint = { x: viewport.width / 2, y: viewport.height / 2 }) {
      const target = clampZoom(scale);
      if (!transform.scale) return target;
      transform = zoomAt(transform, target / transform.scale, focusViewportPoint);
      stage.apply();
      return target;
    },

    panBy(delta) {
      transform = {
        ...transform,
        offsetX: transform.offsetX + delta.x,
        offsetY: transform.offsetY + delta.y
      };
      stage.apply();
    },

    clientToViewport(clientX, clientY) {
      const rect = canvasElement.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    },

    imageToViewport(point) {
      return imageToViewport(point, transform);
    },

    viewportToImage(point) {
      return viewportToImage(point, transform);
    },

    clientToImage(clientX, clientY) {
      return viewportToImage(stage.clientToViewport(clientX, clientY), transform);
    },

    findObject(clientX, clientY) {
      const imagePoint = stage.clientToImage(clientX, clientY);
      const objects = canvas.getObjects().filter((object) => (
        object !== backgroundObject
        && object.selectable !== false
        && object.evented !== false
        && object.visible !== false
      ));
      return findAnnotationAt(objects, imagePoint, 6 / (transform.scale || 1));
    },

    bringToFront(object) {
      if (object) canvas.bringToFront(object);
    },

    exportDataUrl(rect) {
      const region = roundRect(rect);
      canvas.renderAll();
      return canvas.toDataURL({
        format: 'png',
        multiplier: 1,
        left: region.left,
        top: region.top,
        width: region.width,
        height: region.height
      });
    },

    destroy() {
      try {
        canvas.dispose();
      } catch (error) {
        console.warn('[capture] 释放画布失败:', error);
      }
    }
  };

  return stage;
}
