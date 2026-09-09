document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const searchInput = document.getElementById('searchInput');
  const searchClear = document.getElementById('searchClear');
  const processListContainer = document.getElementById('processListContainer');
  const processListEl = document.getElementById('processList');
  const loadingState = document.getElementById('loadingState');
  const emptyState = document.getElementById('emptyState');
  const processCountBadge = document.getElementById('processCountBadge');
  const btnRefresh = document.getElementById('btnRefresh');
  const btnBatchKill = document.getElementById('btnBatchKill');
  const selectedCount = document.getElementById('selectedCount');
  const selectAllCheckbox = document.getElementById('selectAllCheckbox');

  // Header click sort handlers
  const thName = document.getElementById('thName');
  const thPID = document.getElementById('thPID');
  const thPort = document.getElementById('thPort');
  const thMem = document.getElementById('thMem');

  // Modal Elements
  const killModal = document.getElementById('killModal');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');
  const btnModalConfirm = document.getElementById('btnModalConfirm');
  const btnModalCancel = document.getElementById('btnModalCancel');

  // Toast Container
  const toastContainer = document.getElementById('toastContainer');

  // State Variables
  let allProcesses = [];
  let filteredProcesses = [];
  let selectedIndex = 0;
  let lastCheckedIndex = null;
  const checkedPids = new Set();
  let isModalOpen = false;
  let targetProcessToKill = null; // Single process or null for batch
  let isBatchKillMode = false;
  let currentSort = { field: 'memoryKB', desc: true };

  // Expand window height helper for Ztools / uTools
  function adjustPluginHeight(height = 580) {
    try {
      const api = window.ztools || window.utools;
      if (api) {
        if (typeof api.setExpendHeight === 'function') {
          api.setExpendHeight(height);
        }
        if (typeof api.setExploresHeight === 'function') {
          api.setExploresHeight(height);
        }
        if (typeof api.showMainWindow === 'function') {
          api.showMainWindow();
        }
      }
    } catch (e) {
      console.warn('Failed to call setExpendHeight:', e);
    }
  }

  // System Theme Auto-Detection (Ztools / uTools API & OS prefers-color-scheme)
  function updateSystemTheme() {
    try {
      const api = window.ztools || window.utools;
      if (api && typeof api.isDarkColors === 'function') {
        const isDark = api.isDarkColors();
        document.body.classList.toggle('dark-mode', isDark);
        document.body.classList.toggle('light-mode', !isDark);
      }
    } catch (e) {
      console.warn('Theme check error:', e);
    }
  }

  updateSystemTheme();
  if (window.matchMedia) {
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateSystemTheme);
    } catch (e) {}
  }

  // Set height immediately & focus search input
  adjustPluginHeight(580);
  if (searchInput) {
    setTimeout(() => searchInput.focus(), 50);
  }

  // Resolution of process service from preload
  const processService = window.services || window.processService || {
    getProcesses: async () => [
      { name: 'chrome.exe', pid: 12100, memoryStr: '132.3 MB', memoryKB: 135480, listeningPorts: [8080, 8081], allPorts: [8080, 8081], primaryPort: 8080, portsStr: ':8080, :8081' },
      { name: 'Antigravity.exe', pid: 65176, memoryStr: '252.4 MB', memoryKB: 258488, listeningPorts: [], allPorts: [54321], primaryPort: 54321, portsStr: ':54321' },
      { name: 'ZTools.exe', pid: 56044, memoryStr: '91.9 MB', memoryKB: 94092, listeningPorts: [], allPorts: [], primaryPort: Infinity, portsStr: '' },
      { name: 'WeChatAppEx.exe', pid: 54964, memoryStr: '133.1 MB', memoryKB: 136308, listeningPorts: [], allPorts: [], primaryPort: Infinity, portsStr: '' },
      { name: 'Unity.exe', pid: 28976, memoryStr: '0.96 GB', memoryKB: 1002752, listeningPorts: [3000], allPorts: [3000], primaryPort: 3000, portsStr: ':3000' }
    ],
    killProcess: async (pid) => `Mock killed process PID ${pid}`
  };

  // Toast notification helper
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = '';
    if (type === 'success') {
      icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    } else if (type === 'error') {
      icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
    }

    toast.innerHTML = `${icon}<span>${escapeHtml(message)}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  let isFetchingProcesses = false;
  let searchDebounceTimer = null;

  // Load and refresh process list
  async function loadProcesses(keepIndex = true, silent = false) {
    if (isFetchingProcesses) return;
    isFetchingProcesses = true;

    adjustPluginHeight(580);
    if (!silent) {
      loadingState.style.display = 'flex';
      emptyState.style.display = 'none';
      processListEl.style.display = 'none';
    }

    try {
      allProcesses = await processService.getProcesses();
      
      // Clean up PIDs that no longer exist
      const currentPidSet = new Set(allProcesses.map(p => p.pid));
      for (const pid of checkedPids) {
        if (!currentPidSet.has(pid)) {
          checkedPids.delete(pid);
        }
      }

      applyFilterAndSort(keepIndex);
    } catch (err) {
      console.error('Failed to load processes:', err);
      if (!silent) {
        showToast('获取进程列表失败: ' + (err.message || '未知错误'), 'error');
      }
    } finally {
      isFetchingProcesses = false;
      if (!silent) {
        loadingState.style.display = 'none';
        processListEl.style.display = 'block';
      }
      if (searchInput && !isModalOpen && document.activeElement !== searchInput) {
        searchInput.focus();
      }
    }
  }

  // Window Focus & Plugin Enter Lifecycle Events for Auto-Refresh
  window.onPluginEnter = function(action) {
    loadProcesses(true, allProcesses.length > 0);
  };

  window.addEventListener('focus', () => {
    if (!isModalOpen && !isFetchingProcesses) {
      loadProcesses(true, true);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !isModalOpen && !isFetchingProcesses) {
      loadProcesses(true, true);
    }
  });

  // Update header sort direction icons
  function updateHeaderSortIcons() {
    const headers = [
      { el: thName, field: 'name' },
      { el: thPID, field: 'pid' },
      { el: thPort, field: 'primaryPort' },
      { el: thMem, field: 'memoryKB' }
    ];

    headers.forEach(({ el, field }) => {
      if (!el) return;
      const iconEl = el.querySelector('.sort-icon');
      if (currentSort.field === field) {
        el.classList.add('active-sort');
        if (iconEl) iconEl.textContent = currentSort.desc ? ' ▲' : ' ▼';
      } else {
        el.classList.remove('active-sort');
        if (iconEl) iconEl.textContent = '';
      }
    });
  }

  // Update Batch Kill Bar & Select All Checkbox state
  function updateBatchKillState() {
    const count = checkedPids.size;
    if (count > 0) {
      btnBatchKill.style.display = 'flex';
      selectedCount.textContent = count;
    } else {
      btnBatchKill.style.display = 'none';
    }

    if (!selectAllCheckbox) return;

    if (filteredProcesses.length === 0) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
      return;
    }

    let checkedCount = 0;
    filteredProcesses.forEach(p => {
      if (checkedPids.has(p.pid)) checkedCount++;
    });

    if (checkedCount === 0) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
    } else if (checkedCount === filteredProcesses.length) {
      selectAllCheckbox.checked = true;
      selectAllCheckbox.indeterminate = false;
    } else {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = true;
    }
  }

  // Filter and Sort logic
  function applyFilterAndSort(keepIndex = false) {
    const rawQuery = searchInput.value.trim().toLowerCase();
    
    // Filter
    if (!rawQuery) {
      filteredProcesses = [...allProcesses];
      searchClear.style.display = 'none';
    } else {
      searchClear.style.display = 'flex';
      
      // Clean query for port matching (e.g. ":8080", "port:8080", "port=8080" -> "8080")
      const cleanPortQuery = rawQuery.replace(/^port\s*[:=]?\s*/i, '').replace(/^[:]/, '').trim();

      filteredProcesses = allProcesses.filter(p => {
        const nameMatch = p.name.toLowerCase().includes(rawQuery);
        const pidMatch = p.pid.toString().includes(rawQuery);
        
        let portMatch = false;
        if (cleanPortQuery) {
          const listeningPorts = p.listeningPorts || [];
          const allPorts = p.allPorts || [];
          const portsStr = p.portsStr || '';

          const hasListeningMatch = listeningPorts.some(port => port.toString().includes(cleanPortQuery));
          const hasAllMatch = allPorts.some(port => port.toString().includes(cleanPortQuery));
          const hasStrMatch = portsStr.toLowerCase().includes(rawQuery) || portsStr.toLowerCase().includes(cleanPortQuery);

          portMatch = hasListeningMatch || hasAllMatch || hasStrMatch;
        }

        return nameMatch || pidMatch || portMatch;
      });
    }

    // Sort
    filteredProcesses.sort((a, b) => {
      let valA = a[currentSort.field];
      let valB = b[currentSort.field];

      if (valA === undefined || valA === null) valA = currentSort.field === 'primaryPort' ? Infinity : '';
      if (valB === undefined || valB === null) valB = currentSort.field === 'primaryPort' ? Infinity : '';

      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();

      if (valA < valB) return currentSort.desc ? 1 : -1;
      if (valA > valB) return currentSort.desc ? -1 : 1;
      return 0;
    });

    updateHeaderSortIcons();

    // Update Badge
    processCountBadge.textContent = `进程数: ${filteredProcesses.length}`;

    // Index boundary check - default select 0 (first item)
    if (!keepIndex || selectedIndex >= filteredProcesses.length) {
      selectedIndex = 0;
    }

    renderList();
    updateBatchKillState();
  }

  // Render Port Badges Helper
  function renderPortBadges(proc) {
    const listening = proc.listeningPorts || [];
    const all = proc.allPorts || [];
    
    if (listening.length > 0) {
      const showPorts = listening.slice(0, 2);
      const extraCount = listening.length - showPorts.length;
      const fullTooltip = `监听端口: ${listening.map(p => ':' + p).join(', ')}`;

      let html = showPorts.map(p => `<span class="port-badge" title="${fullTooltip}">:${p}</span>`).join(' ');
      if (extraCount > 0) {
        html += ` <span class="port-badge-more" title="${fullTooltip}">+${extraCount}</span>`;
      }
      return html;
    } else if (all.length > 0) {
      const showPorts = all.slice(0, 2);
      const extraCount = all.length - showPorts.length;
      const fullTooltip = `活跃连接端口: ${all.map(p => ':' + p).join(', ')}`;

      let html = showPorts.map(p => `<span class="port-badge port-badge-active" title="${fullTooltip}">:${p}</span>`).join(' ');
      if (extraCount > 0) {
        html += ` <span class="port-badge-more" title="${fullTooltip}">+${extraCount}</span>`;
      }
      return html;
    }
    
    return `<span class="no-port">-</span>`;
  }

  // Render Process Items
  function renderList() {
    processListEl.innerHTML = '';

    if (filteredProcesses.length === 0) {
      emptyState.style.display = 'flex';
      return;
    } else {
      emptyState.style.display = 'none';
    }

    filteredProcesses.forEach((proc, index) => {
      const item = document.createElement('div');
      const isChecked = checkedPids.has(proc.pid);
      item.className = `process-item ${index === selectedIndex ? 'selected' : ''} ${isChecked ? 'checked-row' : ''}`;
      item.setAttribute('data-index', index);

      const portHtml = renderPortBadges(proc);

      item.innerHTML = `
        <div class="checkbox-cell">
          <input type="checkbox" class="row-checkbox" data-index="${index}" ${isChecked ? 'checked' : ''}>
        </div>
        <div class="process-name-cell" title="${escapeHtml(proc.name)}">
          <svg class="process-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect>
            <rect x="9" y="9" width="6" height="6"></rect>
            <line x1="9" y1="1" x2="9" y2="4"></line>
            <line x1="15" y1="1" x2="15" y2="4"></line>
            <line x1="9" y1="20" x2="9" y2="23"></line>
            <line x1="15" y1="20" x2="15" y2="23"></line>
            <line x1="20" y1="9" x2="23" y2="9"></line>
            <line x1="20" y1="15" x2="23" y2="15"></line>
            <line x1="1" y1="9" x2="4" y2="9"></line>
            <line x1="1" y1="15" x2="4" y2="15"></line>
          </svg>
          <span>${escapeHtml(proc.name)}</span>
        </div>
        <div class="pid-cell">${proc.pid}</div>
        <div class="port-cell">${portHtml}</div>
        <div class="mem-cell">${escapeHtml(proc.memoryStr)}</div>
        <div class="action-cell">
          <button type="button" class="btn-kill-row" data-action="kill" data-index="${index}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
            结束
          </button>
        </div>
      `;

      const checkbox = item.querySelector('.row-checkbox');

      // Checkbox Change Handler
      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        toggleCheckProcess(index, checkbox.checked);
        lastCheckedIndex = index;
      });

      // Item Click Handler
      item.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="kill"]')) {
          setSelection(index);
          openKillModal(proc);
          return;
        }

        if (e.target === checkbox) return;

        // Shift key multi-select range
        if (e.shiftKey && lastCheckedIndex !== null) {
          const start = Math.min(lastCheckedIndex, index);
          const end = Math.max(lastCheckedIndex, index);
          const shouldCheck = !checkedPids.has(proc.pid);

          for (let i = start; i <= end; i++) {
            if (filteredProcesses[i]) {
              toggleCheckProcess(i, shouldCheck);
            }
          }
          setSelection(index);
          return;
        }

        // Ctrl / Cmd key toggle check
        if (e.ctrlKey || e.metaKey) {
          toggleCheckProcess(index, !checkedPids.has(proc.pid));
          lastCheckedIndex = index;
          setSelection(index);
          return;
        }

        setSelection(index);
        lastCheckedIndex = index;
      });

      // Double Click Handler: Open kill dialog
      item.addEventListener('dblclick', () => {
        setSelection(index);
        openKillModal(proc);
      });

      processListEl.appendChild(item);
    });

    scrollToSelected();
  }

  // Toggle Check status for process index
  function toggleCheckProcess(index, checkState) {
    const proc = filteredProcesses[index];
    if (!proc) return;

    if (checkState) {
      checkedPids.add(proc.pid);
    } else {
      checkedPids.delete(proc.pid);
    }

    const itemEl = processListEl.children[index];
    if (itemEl) {
      if (checkState) {
        itemEl.classList.add('checked-row');
      } else {
        itemEl.classList.remove('checked-row');
      }
      const cb = itemEl.querySelector('.row-checkbox');
      if (cb) cb.checked = checkState;
    }

    updateBatchKillState();
  }

  // Set selection index
  function setSelection(newIndex) {
    if (filteredProcesses.length === 0) return;
    newIndex = Math.max(0, Math.min(newIndex, filteredProcesses.length - 1));

    const currentSelected = processListEl.querySelector('.process-item.selected');
    if (currentSelected) {
      currentSelected.classList.remove('selected');
    }

    selectedIndex = newIndex;
    const newSelectedItem = processListEl.children[selectedIndex];
    if (newSelectedItem) {
      newSelectedItem.classList.add('selected');
      scrollToSelected();
    }
  }

  // Smooth scroll selected item into view
  function scrollToSelected() {
    const selectedItem = processListEl.children[selectedIndex];
    if (!selectedItem) return;

    const containerTop = processListContainer.scrollTop;
    const containerBottom = containerTop + processListContainer.clientHeight;
    const itemTop = selectedItem.offsetTop - processListContainer.offsetTop;
    const itemBottom = itemTop + selectedItem.offsetHeight;

    if (itemTop < containerTop) {
      processListContainer.scrollTop = itemTop - 8;
    } else if (itemBottom > containerBottom) {
      processListContainer.scrollTop = itemBottom - processListContainer.clientHeight + 8;
    }
  }

  // Modal Open Handler for Single Process
  function openKillModal(proc) {
    if (!proc) return;
    targetProcessToKill = proc;
    isBatchKillMode = false;
    isModalOpen = true;

    modalTitle.textContent = '确认结束进程？';
    modalBody.innerHTML = `
      <div class="info-row">
        <span class="info-label">进程名称:</span>
        <span class="info-value">${escapeHtml(proc.name)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">进程 PID:</span>
        <span class="info-value">${proc.pid}</span>
      </div>
      <div class="info-row">
        <span class="info-label">占用端口:</span>
        <span class="info-value" style="color: var(--accent-green); font-family: var(--font-mono);">${escapeHtml(proc.portsStr || '无')}</span>
      </div>
      <div class="info-row">
        <span class="info-label">内存占用:</span>
        <span class="info-value">${escapeHtml(proc.memoryStr)}</span>
      </div>
    `;

    btnModalConfirm.textContent = '确认杀死进程 (Enter)';
    killModal.classList.add('active');
    setTimeout(() => btnModalConfirm.focus(), 50);
  }

  // Modal Open Handler for Batch Kill
  function openBatchKillModal() {
    if (checkedPids.size === 0) return;
    targetProcessToKill = null;
    isBatchKillMode = true;
    isModalOpen = true;

    const selectedProcs = allProcesses.filter(p => checkedPids.has(p.pid));

    modalTitle.textContent = `确认批量结束 ${selectedProcs.length} 个进程？`;
    
    let html = selectedProcs.map(p => `
      <div class="modal-proc-tag">
        <span><strong>${escapeHtml(p.name)}</strong> (PID: ${p.pid}${p.portsStr ? ' | ' + escapeHtml(p.portsStr) : ''})</span>
        <span style="color: #38bdf8; font-family: var(--font-mono); font-size: 11px;">${p.memoryStr}</span>
      </div>
    `).join('');

    modalBody.innerHTML = html;
    btnModalConfirm.textContent = `确认结束全部 (${selectedProcs.length}) (Enter)`;
    killModal.classList.add('active');
    setTimeout(() => btnModalConfirm.focus(), 50);
  }

  // Modal Close Handler
  function hideKillModal() {
    isModalOpen = false;
    targetProcessToKill = null;
    isBatchKillMode = false;
    killModal.classList.remove('active');
    if (searchInput) {
      searchInput.focus();
    }
  }

  // Execute Kill Process (Single or Batch)
  async function doKillProcess() {
    btnModalConfirm.disabled = true;

    if (isBatchKillMode || (!targetProcessToKill && checkedPids.size > 0)) {
      // Batch Kill
      const pidsToKill = Array.from(checkedPids);
      btnModalConfirm.textContent = `正在批量结束 ${pidsToKill.length} 个进程...`;

      const results = await Promise.allSettled(pidsToKill.map(pid => processService.killProcess(pid, true)));
      
      let successCount = 0;
      let failCount = 0;

      results.forEach(res => {
        if (res.status === 'fulfilled') successCount++;
        else failCount++;
      });

      if (successCount > 0) {
        showToast(`成功批量杀死 ${successCount} 个进程`, 'success');
      }
      if (failCount > 0) {
        showToast(`${failCount} 个进程结束失败 (权限不足或进程已退出)`, 'error');
      }

      checkedPids.clear();
      hideKillModal();
      await loadProcesses(true);
      btnModalConfirm.disabled = false;
      btnModalConfirm.textContent = '确认杀死进程 (Enter)';

    } else if (targetProcessToKill) {
      // Single Kill
      const proc = targetProcessToKill;
      btnModalConfirm.textContent = '正在杀死进程...';

      try {
        await processService.killProcess(proc.pid, true);
        showToast(`成功杀死进程: ${proc.name} (PID: ${proc.pid})`, 'success');
        checkedPids.delete(proc.pid);
        hideKillModal();
        await loadProcesses(true);
      } catch (err) {
        console.error('Kill error:', err);
        showToast(`结束进程失败: ${err.message || '权限不足或进程不存在'}`, 'error');
        hideKillModal();
      } finally {
        btnModalConfirm.disabled = false;
        btnModalConfirm.textContent = '确认杀死进程 (Enter)';
      }
    }
  }

  // HTML Escape helper
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Keyboard Navigation & Events Listener
  window.addEventListener('keydown', (e) => {
    // If Modal is Open
    if (isModalOpen) {
      if (e.key === 'Enter') {
        e.preventDefault();
        doKillProcess();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        hideKillModal();
      }
      return;
    }

    // If Modal is Closed
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelection(selectedIndex + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelection(selectedIndex - 1);
        break;
      case ' ':
        // Space key toggles checkbox on selected process
        e.preventDefault();
        if (filteredProcesses[selectedIndex]) {
          const proc = filteredProcesses[selectedIndex];
          toggleCheckProcess(selectedIndex, !checkedPids.has(proc.pid));
          lastCheckedIndex = selectedIndex;
        }
        break;
      case 'PageDown':
        e.preventDefault();
        setSelection(selectedIndex + 8);
        break;
      case 'PageUp':
        e.preventDefault();
        setSelection(selectedIndex - 8);
        break;
      case 'Home':
        e.preventDefault();
        setSelection(0);
        break;
      case 'End':
        e.preventDefault();
        setSelection(filteredProcesses.length - 1);
        break;
      case 'Enter':
        e.preventDefault();
        if (checkedPids.size > 0) {
          openBatchKillModal();
        } else if (filteredProcesses[selectedIndex]) {
          openKillModal(filteredProcesses[selectedIndex]);
        }
        break;
      case 'Escape':
        if (checkedPids.size > 0) {
          checkedPids.clear();
          applyFilterAndSort(true);
        } else if (document.activeElement === searchInput || searchInput.value) {
          searchInput.value = '';
          applyFilterAndSort(false);
          searchInput.focus();
        }
        break;
      case 'F5':
        e.preventDefault();
        loadProcesses(true);
        break;
      default:
        // Shortcut Ctrl+R for refresh
        if (e.ctrlKey && e.key.toLowerCase() === 'r') {
          e.preventDefault();
          loadProcesses(true);
        }
        // Shortcut Ctrl+A for Select All
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
          if (document.activeElement !== searchInput) {
            e.preventDefault();
            filteredProcesses.forEach(p => checkedPids.add(p.pid));
            applyFilterAndSort(true);
          }
        }
        break;
    }
  });

  // Select All Checkbox Handler
  selectAllCheckbox.addEventListener('change', () => {
    const isChecked = selectAllCheckbox.checked;
    filteredProcesses.forEach(p => {
      if (isChecked) checkedPids.add(p.pid);
      else checkedPids.delete(p.pid);
    });
    applyFilterAndSort(true);
  });

  // Search Input Event
  searchInput.addEventListener('input', () => {
    // 1. Instantly filter existing cached processes for fast response
    applyFilterAndSort(false);

    // 2. Debounce (300ms) background refresh from OS to catch newly launched processes/ports
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      loadProcesses(true, true);
    }, 300);
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    applyFilterAndSort(false);
    loadProcesses(true, true);
    searchInput.focus();
  });

  // Refresh Button Click
  btnRefresh.addEventListener('click', () => loadProcesses(true));

  // Batch Kill Button Click
  btnBatchKill.addEventListener('click', () => openBatchKillModal());

  // Table header click sort handlers
  function toggleSort(field, defaultDesc = true) {
    if (currentSort.field === field) {
      currentSort.desc = !currentSort.desc;
    } else {
      currentSort = { field, desc: defaultDesc };
    }
    applyFilterAndSort(false);
  }

  thName.addEventListener('click', () => toggleSort('name', false));
  thPID.addEventListener('click', () => toggleSort('pid', false));
  if (thPort) thPort.addEventListener('click', () => toggleSort('primaryPort', false));
  thMem.addEventListener('click', () => toggleSort('memoryKB', true));

  // Modal Mouse Click Handlers
  function handleCancelClick(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    hideKillModal();
  }

  function handleConfirmClick(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    doKillProcess();
  }

  btnModalCancel.addEventListener('click', handleCancelClick);
  btnModalCancel.addEventListener('mousedown', (e) => e.stopPropagation());

  btnModalConfirm.addEventListener('click', handleConfirmClick);
  btnModalConfirm.addEventListener('mousedown', (e) => e.stopPropagation());

  // Backdrop click to close modal
  killModal.addEventListener('click', (e) => {
    if (e.target === killModal) {
      handleCancelClick(e);
    }
  });

  // Initial Load
  loadProcesses(false);
});
