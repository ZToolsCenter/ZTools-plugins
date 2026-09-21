// 就地文字编辑：DOM 编辑器覆盖在画布上，提交后写入 fabric 文字对象。

import { createTextAnnotation } from './annotations.js';

export function createTextEditor({
  container,
  fabric,
  stage,
  store,
  getSettings,
  displayScale = 1,
  onCommit = () => {},
  onStatus = () => {}
}) {
  const editor = document.createElement('textarea');
  editor.className = 'capture-text-editor';
  editor.spellcheck = false;
  editor.setAttribute('aria-label', '文字内容');
  container.appendChild(editor);

  let editingObject = null;
  let creating = false;
  let anchorPoint = { x: 0, y: 0 };

  const isOpen = () => editor.classList.contains('visible');

  const place = () => {
    if (!isOpen()) return;
    const settings = getSettings();
    const point = stage.imageToViewport(anchorPoint);
    editor.style.left = `${Math.round(point.x)}px`;
    editor.style.top = `${Math.round(point.y)}px`;
    editor.style.fontSize = `${Math.round(settings.fontSize * displayScale)}px`;
    editor.style.fontWeight = settings.fontBold ? '700' : '400';
    editor.style.fontStyle = settings.fontItalic ? 'italic' : 'normal';
    editor.style.color = settings.color;
  };

  const close = () => {
    editor.classList.remove('visible');
    if (editingObject) editingObject.set('visible', true);
  };

  const cancel = () => {
    close();
    editingObject = null;
    creating = false;
    stage?.canvas?.requestRenderAll();
  };

  const commit = () => {
    if (!isOpen()) return;
    const text = editor.value;
    const target = editingObject;
    const isCreating = creating;
    close();
    editingObject = null;
    creating = false;
    if (!text.trim()) {
      if (!isCreating) {
        store.beginChange();
        target?.set?.({ text: '' });
        store.commitChange();
      }
      onStatus(isCreating ? '未输入文字' : '已清空文字');
      return;
    }
    if (isCreating) {
      const object = createTextAnnotation({
        fabric,
        point: anchorPoint,
        text,
        settings: getSettings(),
        scale: displayScale
      });
      store.add(object);
    } else if (target) {
      store.beginChange();
      target.set({ text });
      store.commitChange();
    }
    stage?.canvas?.requestRenderAll();
    onCommit();
    onStatus('已添加文字');
  };

  const open = (imagePoint, existing = null) => {
    if (isOpen()) commit();
    anchorPoint = existing ? { x: existing.left, y: existing.top } : { ...imagePoint };
    editingObject = existing;
    creating = !existing;
    editor.value = existing ? String(existing.text || '') : '';
    editor.classList.add('visible');
    if (existing) existing.set('visible', false);
    place();
    stage?.canvas?.requestRenderAll();
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
    onStatus('输入文字，Enter 完成，Esc 取消');
  };

  editor.addEventListener('blur', () => commit());
  editor.addEventListener('pointerdown', (event) => event.stopPropagation());
  editor.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
      onStatus('已取消文字');
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      commit();
    }
  });

  return {
    element: editor,
    open,
    commit,
    cancel,
    place,
    isOpen,
    isEditing: (object) => isOpen() && editingObject === object
  };
}
