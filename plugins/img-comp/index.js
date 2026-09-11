// img-comp 用户界面控制器
// 批次、输入项和结果由 imgCompRuntime 服务统一管理。

(function () {
  'use strict';

  const root = document.getElementById('root');
  const runtime = window.imgCompRuntime;
  const state = { batches: [], activeIndex: -1 };
  let dropLayer = null;
  let eventsBound = false;
  let importing = false;
  const MAX_HISTORY = 8;

  /**
   * 获取当前选中的批次。
   * @returns {object|null} 当前批次
   */
  function activeBatch() {
    return state.activeIndex >= 0 && state.activeIndex < state.batches.length
      ? state.batches[state.activeIndex]
      : null;
  }

  /**
   * 将时间转换为紧凑展示文本。
   * @param {number} value 时间戳
   * @returns {string} 时间文本
   */
  function formatTime(value) {
    const created = new Date(value || Date.now());
    const now = new Date();
    const seconds = Math.max(0, (now - created) / 1000);
    if (seconds < 60) return '此刻';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
    if (created.toDateString() === now.toDateString()) {
      return `${String(created.getHours()).padStart(2, '0')}:${String(created.getMinutes()).padStart(2, '0')}`;
    }
    if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)} 天前`;
    return `${created.getMonth() + 1}/${created.getDate()}`;
  }

  /**
   * 构造 tab 标题。
   * @param {object} batch 批次
   * @returns {string} tab 标题
   */
  function tabTitle(batch) {
    return `${formatTime(batch.createdAt)} · ${batch.entries.length}张`;
  }

  /**
   * 对用户可见文本进行 HTML 转义。
   * @param {unknown} value 原始文本
   * @returns {string} 安全文本
   */
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * 把本地路径转换为图片 URL。
   * @param {string} filePath 文件路径
   * @returns {string} file URL
   */
  function localUrl(filePath) {
    let normalized = String(filePath).replace(/\\/g, '/');
    if (!normalized.startsWith('/')) normalized = `/${normalized}`;
    return `file://${encodeURI(normalized)}`;
  }

  /**
   * 判断输入项是否为受支持的图片。
   * @param {object} entry 输入项
   * @returns {boolean} 是否为图片
   */
  function isImage(entry) {
    return /\.(jpg|jpeg|png|gif|svg)$/i.test(entry.filename || '');
  }

  /**
   * 生成一项的缩略图。
   * @param {object} entry 输入项
   * @returns {string} 缩略图 HTML
   */
  function thumbnail(entry) {
    if (!isImage(entry)) return '<div class="thumb">📄</div>';
    const target = entry.resultPath && entry.resultBytes < entry.inputBytes
      ? entry.resultPath : entry.inputPath;
    if (!target) return '<div class="thumb">🖼</div>';
    const stamp = entry.resultBytes ? `?v=${entry.resultBytes}` : '';
    return `<div class="thumb"><img src="${localUrl(target)}${stamp}" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode('🖼'))"></div>`;
  }

  /**
   * 读取历史记录并保持旧记录在左、最新记录在右。
   * @returns {Array<object>} 历史记录
   */
  function historyRecords() {
    try {
      const records = runtime && typeof runtime.history === 'function' ? runtime.history() : [];
      return Array.isArray(records)
        ? records.slice().sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0))
        : [];
    } catch { return []; }
  }

  /**
   * 将一个批次写入历史记录。
   * @param {object} batch 批次
   */
  function remember(batch) {
    if (!runtime || typeof runtime.writeHistory !== 'function') return;
    const records = historyRecords().filter(item => item.id !== batch.id);
    records.push(runtime.toHistory(batch));
    runtime.writeHistory(records.slice(-MAX_HISTORY));
  }

  /**
   * 从历史记录创建可展示批次。
   * @param {object} record 历史记录
   * @returns {object} 批次
   */
  function restore(record) {
    return runtime.fromHistory(record);
  }

  /**
   * 启动时载入已有历史批次。
   */
  function loadSavedBatches() {
    for (const record of historyRecords()) {
      const batch = restore(record);
      if (batch.entries.length > 0) state.batches.push(batch);
    }
    if (state.batches.length > 0) state.activeIndex = state.batches.length - 1;
  }

  /**
   * 渲染整个插件界面。
   */
  function render() {
    root.innerHTML = '';
    const tabs = renderTabs();
    if (tabs) root.appendChild(tabs);
    const batch = activeBatch();
    root.appendChild(batch ? renderBatch(batch) : renderEmpty());
  }

  /**
   * 渲染顶部历史 tab。
   * @returns {HTMLElement|null} tab 容器
   */
  function renderTabs() {
    if (state.batches.length === 0) return null;
    const container = document.createElement('div');
    container.className = 'tabs';
    state.batches.forEach((batch, index) => {
      const tab = document.createElement('div');
      tab.className = `tab${index === state.activeIndex ? ' active' : ''}`;
      const title = tabTitle(batch);
      tab.innerHTML = `<span class="text" title="${title}">${title}</span><span class="x" title="关闭">×</span>`;
      tab.addEventListener('click', event => {
        if (event.target.classList.contains('x')) {
          event.stopPropagation();
          closeBatch(index);
          return;
        }
        state.activeIndex = index;
        render();
      });
      container.appendChild(tab);
      if (index === state.activeIndex && typeof tab.scrollIntoView === 'function') {
        queueMicrotask(() => tab.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
      }
    });
    return container;
  }

  /**
   * 渲染空状态。
   * @returns {HTMLElement} 空状态元素
   */
  function renderEmpty() {
    const element = document.createElement('div');
    element.className = 'empty';
    element.innerHTML = '<div class="big">🖼</div><div>将图片或文件夹拖到这里，也可以直接粘贴截图</div>';
    return element;
  }

  /**
   * 渲染批次内容。
   * @param {object} batch 批次
   * @returns {HTMLElement} 批次元素
   */
  function renderBatch(batch) {
    const fragment = document.createDocumentFragment();
    const progress = document.createElement('div');
    progress.className = 'progress';
    const indicator = document.createElement('div');
    indicator.style.width = `${batch.progress.percent || 0}%`;
    progress.appendChild(indicator);
    fragment.appendChild(progress);

    const main = document.createElement('div');
    main.className = 'main';
    if (batch.error) {
      main.appendChild(emptyMessage('⚠', batch.error));
    } else if (batch.entries.length === 0) {
      main.appendChild(emptyMessage('🖼', '未找到支持的图片'));
    } else {
      main.appendChild(renderList(batch));
    }
    fragment.appendChild(main);
    fragment.appendChild(renderStatus(batch));

    const wrapper = document.createElement('div');
    wrapper.className = 'batch-view';
    wrapper.appendChild(fragment);
    return wrapper;
  }

  /**
   * 创建空内容提示。
   * @param {string} icon 图标
   * @param {string} message 提示语
   * @returns {HTMLElement} 提示元素
   */
  function emptyMessage(icon, message) {
    const element = document.createElement('div');
    element.className = 'empty';
    element.innerHTML = `<div class="big">${icon}</div><div>${escapeHtml(message)}</div>`;
    return element;
  }

  /**
   * 渲染文件列表。
   * @param {object} batch 批次
   * @returns {HTMLElement} 列表
   */
  function renderList(batch) {
    const list = document.createElement('div');
    list.className = 'list';
    for (const entry of batch.entries) {
      const row = document.createElement('div');
      row.className = `row${entry.relativeName && entry.relativeName !== entry.filename ? ' sub' : ''}`;
      const imageCell = document.createElement('div');
      imageCell.innerHTML = thumbnail(entry);
      row.appendChild(imageCell.firstElementChild);

      const name = document.createElement('div');
      name.className = 'name';
      name.title = entry.inputPath || '';
      name.textContent = entry.filename || '';
      if (entry.relativeName && entry.relativeName !== entry.filename) {
        const relative = document.createElement('span');
        relative.className = 'sub';
        relative.textContent = entry.relativeName;
        name.appendChild(relative);
      }
      row.appendChild(name);

      const original = document.createElement('div');
      original.className = 'sz';
      original.textContent = runtime.formatBytes(entry.inputBytes);
      row.appendChild(original);

      const arrow = document.createElement('div');
      arrow.className = 'arrow';
      arrow.textContent = '→';
      row.appendChild(arrow);

      const result = document.createElement('div');
      result.className = 'sz2';
      result.textContent = entry.resultBytes == null ? '' : runtime.formatBytes(entry.resultBytes);
      row.appendChild(result);

      const saving = document.createElement('div');
      saving.className = 'reduce';
      if (entry.error) {
        saving.classList.add('err');
        saving.textContent = '✕';
        saving.title = entry.error;
      } else if (entry.savedPercent == null) {
        saving.textContent = '';
      } else if (entry.savedPercent === 0) {
        saving.classList.add('zero');
        saving.textContent = '-0%';
      } else {
        saving.textContent = `-${entry.savedPercent}%`;
      }
      row.appendChild(saving);

      const copy = document.createElement('button');
      copy.className = 'copy';
      copy.title = '复制文件';
      copy.textContent = '⧉';
      copy.addEventListener('click', () => {
        const target = entry.resultPath || entry.inputPath;
        if (target) runtime.copyOne(target);
      });
      row.appendChild(copy);
      list.appendChild(row);
    }
    return list;
  }

  /**
   * 统计批次中可复制的结果路径。
   * @param {object} batch 批次
   * @returns {string[]} 路径列表
   */
  function copyTargets(batch) {
    return [...new Set(batch.entries
      .filter(entry => !entry.error)
      .map(entry => entry.resultPath || entry.inputPath)
      .filter(Boolean))];
  }

  /**
   * 渲染底部状态栏。
   * @param {object} batch 批次
   * @returns {HTMLElement} 状态栏
   */
  function renderStatus(batch) {
    const status = document.createElement('div');
    status.className = 'status';
    const progress = batch.progress;
    const summary = document.createElement('div');
    summary.className = 'left';
    summary.innerHTML = `完成 <b>${progress.percent || 0}%</b>  成功 <b>${progress.succeeded}</b>  失败 <b>${progress.failed}</b>`;
    status.appendChild(summary);

    if (batch.phase === 'complete' && batch.entries.length > 0) {
      const total = batch.entries.reduce((sum, entry) => {
        if (entry.error || entry.resultBytes == null) return sum;
        return sum + Math.max(0, entry.inputBytes - entry.resultBytes);
      }, 0);
      const original = batch.entries.reduce((sum, entry) => entry.error ? sum : sum + (entry.inputBytes || 0), 0);
      const percent = original > 0 ? (100 * total / original).toFixed(1) : '0.0';
      const center = document.createElement('div');
      center.className = 'center';
      center.innerHTML = `节省 <span class="bytes">${runtime.formatBytes(total)}</span> ${percent}%`;
      status.appendChild(center);
    }

    const spacer = document.createElement('div');
    spacer.className = 'spacer';
    status.appendChild(spacer);

    if (batch.phase === 'running' || batch.phase === 'pending') {
      const cancel = document.createElement('button');
      cancel.className = 'btn danger';
      cancel.textContent = '停止处理';
      cancel.addEventListener('click', () => { runtime.cancel(batch); render(); });
      status.appendChild(cancel);
    } else if (batch.phase === 'complete') {
      const replaceCount = batch.entries.filter(entry => !entry.error && entry.resultPath && entry.resultBytes < entry.inputBytes).length;
      if (replaceCount > 0) {
        const replace = document.createElement('button');
        replace.className = 'btn';
        replace.textContent = `覆盖原图 (${replaceCount})`;
        replace.addEventListener('click', async () => {
          const ok = await runtime.replaceInputs(batch);
          getZ().showNotification && getZ().showNotification(ok ? `已覆盖 ${replaceCount} 张` : '覆盖失败');
          if (ok) dismissMainWindow();
        });
        status.appendChild(replace);
      }
    }

    if (batch.phase === 'complete' && batch.entries.length > 0) {
      const targets = copyTargets(batch);
      const copyAll = document.createElement('button');
      copyAll.className = 'btn primary';
      copyAll.innerHTML = '复制全部<kbd>Ctrl+C</kbd>';
      copyAll.title = `复制 ${targets.length} 张图片`;
      copyAll.disabled = targets.length === 0;
      copyAll.addEventListener('click', async () => {
        const result = await runtime.copyMany(targets);
        const ok = typeof result === 'object' ? result.success : result;
        const count = typeof result === 'object' && Number.isInteger(result.count) ? result.count : targets.length;
        getZ().showNotification && getZ().showNotification(ok ? `已复制 ${count} 张图片到剪贴板` : `批量复制失败，应复制 ${targets.length} 张图片`);
        if (ok) dismissMainWindow();
      });
      status.appendChild(copyAll);
    }
    return status;
  }

  /**
   * 删除当前批次并同步删除历史。
   * @param {number} index 批次索引
   */
  function closeBatch(index) {
    const batch = state.batches[index];
    if (batch) {
      if (batch.phase === 'running' || batch.phase === 'pending') runtime.cancel(batch);
      if (runtime.removeHistory) runtime.removeHistory(batch.historyId || batch.id);
    }
    state.batches.splice(index, 1);
    if (state.batches.length === 0) state.activeIndex = -1;
    else if (state.activeIndex >= state.batches.length) state.activeIndex = state.batches.length - 1;
    render();
  }

  /**
   * 读取文件的 Data URI。
   * @param {File} file 文件对象
   * @returns {Promise<string>} Data URI
   */
  function readDataUri(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * 取得本次拖拽中的文件描述。
   * @param {DataTransfer} transfer 拖拽数据
   * @returns {Promise<{descriptors:object[],fallbackImages:string[]}>} 导入数据
   */
  async function inspectDrop(transfer) {
    const descriptors = [];
    const fallbackImages = [];
    const knownPaths = new Set();
    const items = transfer.items ? Array.from(transfer.items) : [];
    const addDescriptor = descriptor => {
      if (!descriptor.path || knownPaths.has(descriptor.path)) return;
      knownPaths.add(descriptor.path);
      descriptors.push(descriptor);
    };

    for (const item of items) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile ? item.getAsFile() : null;
      const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
      if (!file) continue;
      let filePath = '';
      try { filePath = getZ().getPathForFile ? getZ().getPathForFile(file) : ''; } catch {}
      if (entry && entry.isDirectory) {
        addDescriptor({ isDirectory: true, isFile: false, name: entry.name, path: filePath });
      } else if (filePath) {
        addDescriptor({ isDirectory: false, isFile: true, name: file.name, path: filePath });
      } else if (item.type && item.type.startsWith('image/')) {
        fallbackImages.push(await readDataUri(file));
      }
    }

    if (items.length === 0 && transfer.files && transfer.files.length) {
      for (const file of Array.from(transfer.files)) {
        let filePath = '';
        try { filePath = getZ().getPathForFile ? getZ().getPathForFile(file) : ''; } catch {}
        if (filePath) addDescriptor({ isDirectory: false, isFile: true, name: file.name, path: filePath });
        else if (file.type && file.type.startsWith('image/')) fallbackImages.push(await readDataUri(file));
      }
    }
    return { descriptors, fallbackImages };
  }

  /**
   * 绑定一次拖拽、粘贴和插件进入事件。
   */
  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;
    document.body.addEventListener('dragover', event => {
      event.preventDefault();
      event.stopPropagation();
    });
    document.body.addEventListener('drop', async event => {
      event.preventDefault();
      event.stopPropagation();
      removeDropLayer();
      if (importing || !event.dataTransfer) return;
      importing = true;
      try {
        const drop = await inspectDrop(event.dataTransfer);
        if (drop.descriptors.length > 0) await startBatch('files', drop.descriptors, drop.fallbackImages);
        else if (drop.fallbackImages.length > 0) await startBatch('clipboard', drop.fallbackImages);
      } finally {
        importing = false;
      }
    });
    document.body.addEventListener('dragenter', event => {
      event.preventDefault();
      showDropLayer();
    });
    document.body.addEventListener('dragleave', event => {
      if (!event.relatedTarget) removeDropLayer();
    });
    document.addEventListener('paste', async event => {
      if (!event.clipboardData) return;
      const images = [];
      for (const item of Array.from(event.clipboardData.items || [])) {
        if (!item.type.startsWith('image/')) continue;
        const file = item.getAsFile();
        if (file) images.push(await readDataUri(file));
      }
      if (images.length > 0) {
        event.preventDefault();
        await startBatch('clipboard', images);
      }
    });
    if (typeof getZ().onPluginEnter === 'function') {
      getZ().onPluginEnter(async ({ payload, type }) => {
        if (type === 'files' && Array.isArray(payload) && payload.length > 0) {
          await startBatch('files', payload);
        } else if (type === 'img' && payload) {
          await startBatch('clipboard', Array.isArray(payload) ? payload : [payload]);
        } else if (type === 'window') {
          await startBatchFromCurrentFolder();
        }
      });
    }
  }

  /**
   * 从当前文件管理器窗口创建压缩批次。
   * 由 window 指令进入时触发，读取资源管理器/访达当前目录并递归压缩。
   * @returns {Promise<void>} 完成信号
   */
  async function startBatchFromCurrentFolder() {
    const host = getZ();
    if (typeof host.readCurrentFolderPath !== 'function') {
      host.showNotification && host.showNotification('当前 ZTools 版本不支持读取文件管理器路径');
      return;
    }
    let folderPath = '';
    try {
      folderPath = await host.readCurrentFolderPath();
    } catch {
      // 活动窗口不是文件管理器时宿主会抛错，此时不创建批次
    }
    if (!folderPath) return;
    const folderName = folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath;
    await startBatch('files', [{ isDirectory: true, isFile: false, name: folderName, path: folderPath }]);
  }

  /**
   * 显示拖拽提示层。
   */
  function showDropLayer() {
    if (dropLayer) return;
    dropLayer = document.createElement('div');
    dropLayer.className = 'drop-overlay';
    dropLayer.textContent = '松开以导入文件';
    document.body.appendChild(dropLayer);
  }

  /**
   * 移除拖拽提示层。
   */
  function removeDropLayer() {
    if (dropLayer) {
      dropLayer.remove();
      dropLayer = null;
    }
  }

  /**
   * 创建并执行一个压缩批次。
   * @param {string} kind 批次类型
   * @param {unknown} payload 输入数据
   * @param {string[]} extraImages 备用图片数据
   * @returns {Promise<void>} 完成信号
   */
  async function startBatch(kind, payload, extraImages = []) {
    const batch = await runtime.create({ kind, payload });
    if (extraImages.length > 0) await runtime.addDataUris(batch, extraImages);
    if (batch.entries.length === 0) return;
    state.batches.push(batch);
    state.activeIndex = state.batches.length - 1;
    render();
    runtime.execute(batch, () => render()).then(() => {
      if (batch.phase === 'complete' && !batch.cancelled) remember(batch);
      render();
    });
  }

  /**
   * 获取宿主 ZTools 对象。
   * @returns {object} 宿主对象
   */
  function getZ() {
    return window.ztools || {};
  }

  /**
   * 操作成功后按窗口形态决定是否关闭插件窗口。
   * 分离窗口保持留存；主窗口弹窗模式下自动隐藏，与点击窗口外的行为一致。
   */
  function dismissMainWindow() {
    const host = getZ();
    if (typeof host.getWindowType === 'function' && host.getWindowType() === 'detach') return;
    if (typeof host.hideMainWindow === 'function') host.hideMainWindow();
  }

  /**
   * 初始化用户界面。
   */
  function bootstrap() {
    if (!runtime) {
      root.appendChild(renderEmpty());
      return;
    }
    loadSavedBatches();
    bindEvents();
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap);
  else bootstrap();
})();
