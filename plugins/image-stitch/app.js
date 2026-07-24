(function () {
  const state = {
    images: [],
    stash: [],
    direction: 'vertical',
    align: 'center',
    resizeMode: 'enlarge',
    spacing: 0,
    padding: 0,
    bgColor: 'transparent',
    format: 'png',
    quality: 0.92
  };

  const $ = (sel) => document.querySelector(sel);
  const canvas = $('#canvas');
  const ctx = canvas.getContext('2d');
  let isDraggingInternal = false;
  let dragFromIdx = -1;

  function init() {
    bindEvents();
    ztools.setExpendHeight(600);
    ztools.onPluginEnter(({ code, payload }) => {
      if (code === 'image-stitch-files' && payload) {
        const files = Array.isArray(payload) ? payload : [payload];
        files.forEach((f) => addImageFromPath(typeof f === 'string' ? f : f.path));
      } else if (code === 'image-stitch-img' && payload) {
        addImageFromDataURL(payload);
      }
    });
  }

  function bindEvents() {
    $('#btn-add').addEventListener('click', openFilePicker);
    $('#btn-paste').addEventListener('click', pasteFromClipboard);
    $('#btn-clear').addEventListener('click', clearAll);
    $('#btn-reverse').addEventListener('click', reverseOrder);
    $('#btn-stash').addEventListener('click', stashCurrent);
    $('#btn-save').addEventListener('click', saveImage);
    $('#btn-copy').addEventListener('click', copyToClipboard);

    document.querySelectorAll('input[name="direction"]').forEach((el) => {
      el.addEventListener('change', (e) => {
        state.direction = e.target.value;
        updateAlignOptions();
        render();
      });
    });

    $('#align').addEventListener('change', (e) => {
      state.align = e.target.value;
      render();
    });

    $('#resize-mode').addEventListener('change', (e) => {
      state.resizeMode = e.target.value;
      updateAlignVisibility();
      render();
    });

    $('#spacing').addEventListener('input', (e) => {
      state.spacing = parseInt(e.target.value);
      $('#spacing-value').textContent = state.spacing + 'px';
      render();
    });

    $('#padding').addEventListener('input', (e) => {
      state.padding = parseInt(e.target.value);
      $('#padding-value').textContent = state.padding + 'px';
      render();
    });

    document.querySelectorAll('.color-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.color-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.bgColor = btn.dataset.color;
        render();
      });
    });

    $('#custom-color').addEventListener('input', (e) => {
      document.querySelectorAll('.color-btn').forEach((b) => b.classList.remove('active'));
      state.bgColor = e.target.value;
      render();
    });

    $('#format').addEventListener('change', (e) => {
      state.format = e.target.value;
      const showQuality = e.target.value !== 'png';
      $('#quality-group').style.display = showQuality ? '' : 'none';
      render();
    });

    $('#quality').addEventListener('input', (e) => {
      state.quality = parseInt(e.target.value) / 100;
      $('#quality-value').textContent = e.target.value + '%';
    });

    const previewArea = $('#preview-area');
    previewArea.addEventListener('dragover', (e) => {
      if (isDraggingInternal) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    previewArea.addEventListener('drop', (e) => {
      if (isDraggingInternal) return;
      if (handleStashDrop(e)) return;
      handleDrop(e);
    });

    const imageList = $('#image-list');
    imageList.addEventListener('dragover', (e) => {
      if (isDraggingInternal) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        startAutoScroll(imageList, e.clientY);
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    imageList.addEventListener('dragleave', (e) => {
      if (isDraggingInternal && !imageList.contains(e.relatedTarget)) {
        const rect = imageList.getBoundingClientRect();
        if (e.clientY < rect.top) {
          startAutoScroll(imageList, e.clientY);
          applyDragShifts(0);
        } else if (e.clientY > rect.bottom) {
          startAutoScroll(imageList, e.clientY);
          applyDragShifts(state.images.length - 1);
        }
      }
    });

    document.addEventListener('dragover', (e) => {
      if (!isDraggingInternal) return;
      const rect = imageList.getBoundingClientRect();
      if (e.clientY < rect.top) {
        startAutoScroll(imageList, e.clientY);
        applyDragShifts(0);
      } else if (e.clientY > rect.bottom) {
        startAutoScroll(imageList, e.clientY);
        applyDragShifts(state.images.length - 1);
      } else if (!imageList.contains(e.target)) {
        stopAutoScroll();
      }
    });
    imageList.addEventListener('drop', (e) => {
      stopAutoScroll();
      if (isDraggingInternal) {
        e.preventDefault();
        const fromIdx = dragFromIdx;
        const toIdx = lastShiftTarget;
        isDraggingInternal = false;
        dragFromIdx = -1;
        clearDragShifts();
        if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) {
          const [moved] = state.images.splice(fromIdx, 1);
          state.images.splice(toIdx, 0, moved);
          updateUI();
          render();
        }
        return;
      }
      if (handleStashDrop(e)) return;
      handleDrop(e);
    });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'a') { e.preventDefault(); openFilePicker(); }
        if (e.key === 'd') { e.preventDefault(); clearAll(); }
        if (e.key === 's') { e.preventDefault(); saveImage(); }
        if (e.key === 'v') { e.preventDefault(); pasteFromClipboard(); }
      }
    });
  }

  function handleDrop(e) {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (!files.length) return;
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        const filePath = ztools.getPathForFile ? ztools.getPathForFile(file) : null;
        if (filePath) {
          addImageFromPath(filePath);
        } else {
          addImageFromFile(file);
        }
      }
    }
  }

  function openFilePicker() {
    const result = ztools.showOpenDialog({
      title: '选择图片',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'] }],
      properties: ['openFile', 'multiSelections']
    });
    if (result && result.length) {
      result.forEach((p) => addImageFromPath(p));
    }
  }

  function pasteFromClipboard() {
    const files = ztools.getCopyedFiles();
    if (files && files.length) {
      files.forEach((f) => {
        if (/\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(f)) {
          addImageFromPath(f);
        }
      });
      return;
    }
    navigator.clipboard.read().then((items) => {
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith('image/'));
        if (imageType) {
          item.getType(imageType).then((blob) => {
            const reader = new FileReader();
            reader.onload = () => addImageFromDataURL(reader.result);
            reader.readAsDataURL(blob);
          });
        }
      }
    }).catch(() => {});
  }

  function addImageFromPath(filePath) {
    const img = new Image();
    img.onload = () => {
      state.images.push({ img, name: filePath.split(/[/\\]/).pop(), width: img.naturalWidth, height: img.naturalHeight });
      updateUI();
      render();
    };
    img.onerror = () => {
      ztools.showNotification('加载图片失败: ' + filePath.split(/[/\\]/).pop());
    };
    if (filePath.startsWith('file://')) {
      img.src = filePath;
    } else {
      const formatted = filePath.replace(/\\/g, '/');
      img.src = formatted.startsWith('/') ? 'file://' + formatted : 'file:///' + formatted;
    }
  }

  function addImageFromFile(file) {
    const reader = new FileReader();
    reader.onload = () => addImageFromDataURL(reader.result, file.name);
    reader.readAsDataURL(file);
  }

  function addImageFromDataURL(dataURL, name) {
    const img = new Image();
    img.onload = () => {
      state.images.push({ img, name: name || '粘贴图片', width: img.naturalWidth, height: img.naturalHeight });
      updateUI();
      render();
    };
    img.onerror = () => {
      ztools.showNotification('加载图片数据失败');
    };
    img.src = dataURL;
  }

  function clearAll() {
    state.images = [];
    updateUI();
    render();
  }

  function reverseOrder() {
    if (state.images.length < 2) return;
    state.images.reverse();
    updateUI();
    render();
  }

  function updateAlignVisibility() {
    const show = state.resizeMode === 'none';
    $('#align-group').style.display = show ? '' : 'none';
  }

  function updateAlignOptions() {
    const alignEl = $('#align');
    const opts = alignEl.options;
    if (state.direction === 'vertical') {
      opts[0].textContent = '左对齐';
      opts[1].textContent = '居中';
      opts[2].textContent = '右对齐';
    } else {
      opts[0].textContent = '顶部对齐';
      opts[1].textContent = '居中';
      opts[2].textContent = '底部对齐';
    }
  }

  function updateUI() {
    const list = $('#image-list');
    const hint = $('#empty-hint');

    list.querySelectorAll('.image-item').forEach((el) => el.remove());

    if (state.images.length === 0) {
      hint.style.display = '';
      return;
    }
    hint.style.display = 'none';

    state.images.forEach((item, idx) => {
      const div = document.createElement('div');
      div.className = 'image-item';
      div.draggable = true;
      div.dataset.index = idx;

      const thumb = document.createElement('img');
      thumb.src = item.img.src;

      const info = document.createElement('span');
      info.className = 'image-info';
      info.textContent = `${item.name} (${item.width}×${item.height})`;
      info.title = info.textContent;

      const remove = document.createElement('button');
      remove.className = 'image-remove';
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        state.images.splice(idx, 1);
        updateUI();
        render();
      });

      div.appendChild(thumb);
      div.appendChild(info);
      div.appendChild(remove);

      div.addEventListener('dragstart', (e) => {
        isDraggingInternal = true;
        dragFromIdx = idx;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', idx);
        requestAnimationFrame(() => div.classList.add('dragging'));
      });
      div.addEventListener('dragend', () => {
        div.classList.remove('dragging');
        stopAutoScroll();
        isDraggingInternal = false;
        clearDragShifts();
        dragFromIdx = -1;
      });
      div.addEventListener('dragover', (e) => {
        if (!isDraggingInternal) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        applyDragShifts(idx);
      });
      div.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isDraggingInternal) return;
        const fromIdx = dragFromIdx;
        const toIdx = idx;
        isDraggingInternal = false;
        dragFromIdx = -1;
        clearDragShifts();
        if (fromIdx !== toIdx && fromIdx >= 0) {
          const [moved] = state.images.splice(fromIdx, 1);
          state.images.splice(toIdx, 0, moved);
          updateUI();
          render();
        }
      });

      list.appendChild(div);
    });
  }

  let lastShiftTarget = -1;
  let autoScrollTimer = null;
  let autoScrollSpeed = 0;
  let autoScrollList = null;

  function startAutoScroll(listEl, clientY) {
    const rect = listEl.getBoundingClientRect();
    const edgeZone = 40;
    const topDist = clientY - rect.top;
    const bottomDist = rect.bottom - clientY;

    let speed = 0;
    if (clientY < rect.top) {
      speed = -Math.max(4, Math.min(12, (rect.top - clientY) / 5));
    } else if (clientY > rect.bottom) {
      speed = Math.max(4, Math.min(12, (clientY - rect.bottom) / 5));
    } else if (topDist < edgeZone && listEl.scrollTop > 0) {
      speed = -Math.max(2, (edgeZone - topDist) / 3);
    } else if (bottomDist < edgeZone && listEl.scrollTop < listEl.scrollHeight - listEl.clientHeight) {
      speed = Math.max(2, (edgeZone - bottomDist) / 3);
    }

    autoScrollSpeed = speed;
    autoScrollList = listEl;

    if (speed !== 0) {
      if (!autoScrollTimer) {
        autoScrollTimer = setInterval(() => {
          if (autoScrollList) autoScrollList.scrollTop += autoScrollSpeed;
        }, 16);
      }
    } else {
      stopAutoScroll();
    }
  }

  function stopAutoScroll() {
    if (autoScrollTimer) {
      clearInterval(autoScrollTimer);
      autoScrollTimer = null;
    }
    autoScrollSpeed = 0;
    autoScrollList = null;
  }

  function applyDragShifts(hoverIdx) {
    if (hoverIdx === lastShiftTarget) return;
    lastShiftTarget = hoverIdx;
    const items = document.querySelectorAll('.image-item');
    const itemHeight = items[0] ? items[0].offsetHeight + 2 : 40;
    items.forEach((el) => {
      const idx = parseInt(el.dataset.index);
      if (idx === dragFromIdx) return;
      let shift = 0;
      if (dragFromIdx < hoverIdx) {
        if (idx > dragFromIdx && idx <= hoverIdx) shift = -itemHeight;
      } else if (dragFromIdx > hoverIdx) {
        if (idx >= hoverIdx && idx < dragFromIdx) shift = itemHeight;
      }
      el.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  }

  function clearDragShifts() {
    lastShiftTarget = -1;
    document.querySelectorAll('.image-item').forEach((el) => {
      el.style.transform = '';
    });
  }

  function render() {
    if (state.images.length === 0) {
      canvas.style.display = 'none';
      $('#preview-placeholder').style.display = '';
      return;
    }
    canvas.style.display = '';
    $('#preview-placeholder').style.display = 'none';

    const { direction, align, resizeMode, spacing, padding, bgColor, images } = state;

    // 计算每张图片的绘制尺寸
    const drawSizes = computeDrawSizes(images, direction, resizeMode);

    let totalWidth, totalHeight;

    if (direction === 'vertical') {
      totalWidth = Math.max(...drawSizes.map((s) => s.w)) + padding * 2;
      totalHeight = drawSizes.reduce((sum, s) => sum + s.h, 0) + spacing * (images.length - 1) + padding * 2;
    } else {
      totalWidth = drawSizes.reduce((sum, s) => sum + s.w, 0) + spacing * (images.length - 1) + padding * 2;
      totalHeight = Math.max(...drawSizes.map((s) => s.h)) + padding * 2;
    }

    const MAX_CANVAS_SIZE = 16384;
    if (totalWidth > MAX_CANVAS_SIZE || totalHeight > MAX_CANVAS_SIZE) {
      ztools.showNotification(`拼接尺寸过大 (${totalWidth}×${totalHeight})，请减少图片或使用"缩小大图"模式`);
      return;
    }

    canvas.width = totalWidth;
    canvas.height = totalHeight;

    if (bgColor === 'transparent') {
      ctx.clearRect(0, 0, totalWidth, totalHeight);
    } else {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, totalWidth, totalHeight);
    }

    let offset = padding;
    for (let i = 0; i < images.length; i++) {
      const item = images[i];
      const size = drawSizes[i];
      let x, y;
      if (direction === 'vertical') {
        y = offset;
        if (align === 'start') x = padding;
        else if (align === 'end') x = totalWidth - padding - size.w;
        else x = (totalWidth - size.w) / 2;
        offset += size.h + spacing;
      } else {
        x = offset;
        if (align === 'start') y = padding;
        else if (align === 'end') y = totalHeight - padding - size.h;
        else y = (totalHeight - size.h) / 2;
        offset += size.w + spacing;
      }
      ctx.drawImage(item.img, x, y, size.w, size.h);
    }
  }

  function computeDrawSizes(images, direction, resizeMode) {
    if (resizeMode === 'none') {
      return images.map((img) => ({ w: img.width, h: img.height }));
    }

    if (direction === 'vertical') {
      // 纵向拼接 → 统一宽度
      let targetWidth;
      const widths = images.map((i) => i.width);
      if (resizeMode === 'enlarge') {
        targetWidth = Math.max(...widths);
      } else {
        targetWidth = Math.min(...widths);
      }
      return images.map((img) => {
        const scale = targetWidth / img.width;
        return { w: targetWidth, h: Math.round(img.height * scale) };
      });
    } else {
      // 横向拼接 → 统一高度
      let targetHeight;
      const heights = images.map((i) => i.height);
      if (resizeMode === 'enlarge') {
        targetHeight = Math.max(...heights);
      } else {
        targetHeight = Math.min(...heights);
      }
      return images.map((img) => {
        const scale = targetHeight / img.height;
        return { w: Math.round(img.width * scale), h: targetHeight };
      });
    }
  }

  function getOutputMimeType() {
    const map = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
    return map[state.format] || 'image/png';
  }

  function saveImage() {
    if (state.images.length === 0) return;
    const ext = state.format === 'jpeg' ? 'jpg' : state.format;
    const result = ztools.showSaveDialog({
      title: '保存拼接图片',
      defaultPath: `拼接图片.${ext}`,
      filters: [{ name: '图片', extensions: [ext] }]
    });
    if (!result) return;

    const dataURL = canvas.toDataURL(getOutputMimeType(), state.quality);
    const parts = dataURL.split(',');
    if (parts.length < 2 || !parts[1]) {
      ztools.showNotification('保存失败: 图片尺寸过大，无法生成数据');
      return;
    }
    const base64 = parts[1];
    try {
      const fs = require('fs');
      fs.writeFileSync(result, Buffer.from(base64, 'base64'));
      ztools.showNotification('图片已保存');
      ztools.shellShowItemInFolder(result);
    } catch (err) {
      ztools.showNotification('保存失败: ' + err.message);
    }
  }

  function copyToClipboard() {
    if (state.images.length === 0) return;
    const dataURL = canvas.toDataURL('image/png');
    ztools.copyImage(dataURL);
    ztools.showNotification('已复制到剪贴板');
  }

  function stashCurrent() {
    if (state.images.length === 0) return;

    const skipConfirm = ztools.dbGet ? ztools.dbGet('stash-skip-confirm') : localStorage.getItem('stash-skip-confirm');
    if (skipConfirm) {
      doStash();
      return;
    }

    showStashConfirm();
  }

  function showStashConfirm() {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog';
    dialog.innerHTML = `
      <div class="confirm-title">暂存拼接结果</div>
      <div class="confirm-body">将当前拼接结果保存为缩略图，放在预览区上方。<br>暂存后当前工作区会清空，你可以继续拼接新的图片，之后把暂存的图片拖回列表再次拼接。</div>
      <label class="confirm-checkbox"><input type="checkbox" id="stash-no-ask">下次不再提醒</label>
      <div class="confirm-actions">
        <button class="btn" id="stash-cancel">取消</button>
        <button class="btn btn-stash" id="stash-ok">确认暂存</button>
      </div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => overlay.classList.add('visible'));

    document.getElementById('stash-cancel').addEventListener('click', () => {
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 150);
    });
    document.getElementById('stash-ok').addEventListener('click', () => {
      const noAsk = document.getElementById('stash-no-ask').checked;
      if (noAsk) {
        if (ztools.dbPut) ztools.dbPut('stash-skip-confirm', true);
        else localStorage.setItem('stash-skip-confirm', '1');
      }
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 150);
      doStash();
    });
  }

  function doStash() {
    canvas.toBlob((blob) => {
      if (!blob) {
        ztools.showNotification('暂存失败: 无法生成图片数据');
        return;
      }
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        state.stash.push({
          img,
          dataURL: url,
          name: `暂存 ${state.stash.length + 1}`,
          width: canvas.width,
          height: canvas.height
        });
        updateStashUI();
        state.images = [];
        updateUI();
        render();
      };
      img.src = url;
    }, 'image/png');
  }

  function updateStashUI() {
    const shelf = $('#stash-shelf');
    const container = $('#stash-items');
    container.innerHTML = '';

    if (state.stash.length === 0) {
      shelf.style.display = 'none';
      return;
    }
    shelf.style.display = '';

    state.stash.forEach((item, idx) => {
      const div = document.createElement('div');
      div.className = 'stash-item';
      div.draggable = true;
      div.title = `${item.name} (${item.width}×${item.height})`;

      const img = document.createElement('img');
      img.src = item.dataURL;

      const remove = document.createElement('button');
      remove.className = 'stash-remove';
      remove.textContent = '×';
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        state.stash.splice(idx, 1);
        updateStashUI();
      });

      div.appendChild(img);
      div.appendChild(remove);

      div.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('application/x-stash-index', idx);
        div.style.opacity = '0.5';
      });
      div.addEventListener('dragend', () => {
        div.style.opacity = '';
      });

      container.appendChild(div);
    });
  }

  function handleStashDrop(e) {
    const stashIdx = e.dataTransfer.getData('application/x-stash-index');
    if (stashIdx === '') return false;
    e.preventDefault();
    const idx = parseInt(stashIdx);
    const item = state.stash[idx];
    if (!item) return true;
    const img = new Image();
    img.onload = () => {
      state.images.push({ img, name: item.name, width: item.width, height: item.height });
      updateUI();
      render();
    };
    img.src = item.dataURL;
    return true;
  }

  init();
})();
