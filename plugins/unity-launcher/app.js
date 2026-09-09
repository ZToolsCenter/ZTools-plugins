const ztools = window.ztools || window.utools || {};
const KEY_EDITORS = 'unity-launcher.editors';
const KEY_PROJECTS = 'unity-launcher.projects';

let state = {
  tab: 'projects',
  projects: [],
  editors: [],
  searchQuery: '',
  activeTagFilter: 'ALL'
};

function sortProjects() {
  state.projects.sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    return (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0);
  });
}

function getTagColor(tag) {
  const t = String(tag || '').toLowerCase();
  if (t.includes('工作') || t.includes('work')) return { bg: 'rgba(59, 130, 246, 0.18)', border: 'rgba(59, 130, 246, 0.35)', text: '#60a5fa' };
  if (t.includes('个人') || t.includes('测试') || t.includes('test')) return { bg: 'rgba(245, 158, 11, 0.18)', border: 'rgba(245, 158, 11, 0.35)', text: '#fbbf24' };
  if (t.includes('urp') || t.includes('hdrp') || t.includes('渲染')) return { bg: 'rgba(168, 85, 247, 0.18)', border: 'rgba(168, 85, 247, 0.35)', text: '#c084fc' };
  if (t.includes('demo') || t.includes('案例')) return { bg: 'rgba(16, 185, 129, 0.18)', border: 'rgba(16, 185, 129, 0.35)', text: '#34d399' };
  return { bg: 'rgba(255, 255, 255, 0.08)', border: 'rgba(255, 255, 255, 0.15)', text: 'rgba(255, 255, 255, 0.85)' };
}

function renderTagBadges(p, origIdx) {
  const tags = Array.isArray(p.tags) ? p.tags : [];
  const badgesHtml = tags.map(t => {
    const c = getTagColor(t);
    return `<span class="tag-badge" style="background:${c.bg}; border:1px solid ${c.border}; color:${c.text};">${esc(t)}</span>`;
  }).join('');

  return `
    <div class="tags-list-container">
      ${badgesHtml}
      <span class="tag-badge-add" data-tagmgr="${origIdx}" title="点击管理项目分类标签">+ 标签</span>
    </div>`;
}

console.log('app.js loaded at top level');

function parseUnityVersion(v) {
  const match = String(v || '').match(/^(\d+)\.(\d+)\.(\d+)([a-z]*)(\d*)/i);
  if (match) {
    return [
      parseInt(match[1], 10),
      parseInt(match[2], 10),
      parseInt(match[3], 10),
      match[4].toLowerCase(),
      parseInt(match[5] || '0', 10)
    ];
  }
  return [0, 0, 0, '', 0];
}

function compareUnityVersions(v1, v2) {
  const p1 = parseUnityVersion(v1);
  const p2 = parseUnityVersion(v2);

  for (let i = 0; i < 3; i++) {
    if (p1[i] !== p2[i]) return p2[i] - p1[i];
  }

  if (p1[3] !== p2[3]) {
    return p2[3].localeCompare(p1[3]);
  }

  return p2[4] - p1[4];
}

function load() {
  console.log('load() executing...');
  state.projects = services.dbGet(KEY_PROJECTS) || [];
  state.editors = services.dbGet(KEY_EDITORS) || [];
  state.projects.forEach(p => {
    p.pinned = !!p.pinned;
    if (!Array.isArray(p.tags)) p.tags = [];
  });
  sortProjects();
  state.editors.sort((a, b) => compareUnityVersions(a.version, b.version));
  console.log('Loaded state:', JSON.stringify(state));
}
function save() {
  services.dbSet(KEY_PROJECTS, state.projects);
  services.dbSet(KEY_EDITORS, state.editors);
}

const helpHtml = `
  <div style="display: flex; flex-direction: column; gap: 10px; text-align: left; font-size: 12px; line-height: 1.5; color: var(--text-secondary);">
    <div style="background: var(--bg-card-hover); border: 1px solid var(--border-color); border-radius: 10px; padding: 10px 12px;">
      <div style="font-weight: 700; color: #6366f1; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
        <span>📌 1. 项目管理与分类组织</span>
      </div>
      <ul style="margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 3px;">
        <li><b>批量导入</b>：点击「添加项目」选择单目录或包含多个工程的父文件夹自动识别导入。</li>
        <li><b>⭐ 项目置顶</b>：点击卡片右侧星标可强行把常用工程锁定在列表顶部。</li>
        <li><b>🏷️ 标签与筛选</b>：点击「+ 标签」设置多彩胶囊分类；在顶部筛选横条中快速按标签过滤。</li>
        <li><b>📝 模糊搜索与备注</b>：顶部搜索框同时支持项目名、备注和标签关键词模糊检索。</li>
      </ul>
    </div>

    <div style="background: var(--bg-card-hover); border: 1px solid var(--border-color); border-radius: 10px; padding: 10px 12px;">
      <div style="font-weight: 700; color: #10b981; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
        <span>🛠️ 2. 新建项目与编辑器匹配</span>
      </div>
      <ul style="margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 3px;">
        <li><b>➕ 快捷新建工程</b>：点击「新建项目」选择指定的 Unity 编辑器版本，一键自动创建并直接打开。</li>
        <li><b>⚡ 智能版本识别</b>：启动项目时自动读取 <code>ProjectVersion.txt</code> 匹配已录入的最佳 Unity.exe。</li>
        <li><b>📂 资源管理器定位</b>：悬停卡片点击文件夹图标可直接在 Windows 资源管理器中打开项目目录。</li>
      </ul>
    </div>

    <div style="background: var(--bg-card-hover); border: 1px solid var(--border-color); border-radius: 10px; padding: 10px 12px;">
      <div style="font-weight: 700; color: #f43f5e; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
        <span>🗑️ 3. 彻底删除与安全机制</span>
      </div>
      <ul style="margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 3px;">
        <li><b>二次名称校验</b>：删除项目文件需输入完整的项目名确认解封按钮，防止误触事故。</li>
        <li><b>流光进度条</b>：异步递归清理庞大的 Assets 与 Library 硬盘缓存，过程流畅不卡顿。</li>
      </ul>
    </div>
  </div>
`;

function renderTabs() {
  const el = document.getElementById('tabs');
  const addLabel = state.tab === 'projects' ? '添加项目' : '添加编辑器';
  const createProjHtml = state.tab === 'projects' ? `
    <button class="add-btn" id="createProjBtn" style="background: var(--primary-gradient); box-shadow: 0 4px 12px rgba(99, 102, 241, 0.25);">
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
      <span>新建项目</span>
    </button>
  ` : '';

  el.innerHTML = `
    <div class="tabs-list">
      <div class="tab ${state.tab==='projects'?'active':''}" data-t="projects">
        项目 <span class="count">${state.projects.length}</span>
      </div>
      <div class="tab ${state.tab==='editors'?'active':''}" data-t="editors">
        编辑器 <span class="count">${state.editors.length}</span>
      </div>
    </div>
    <div style="display: flex; gap: 8px; align-items: center; margin-left: auto;">
      <button class="help-btn" id="helpBtn" title="使用帮助">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
      </button>
      ${createProjHtml}
      <button class="add-btn" id="addBtn">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        <span>${addLabel}</span>
      </button>
    </div>`;

  el.querySelectorAll('.tab').forEach(t => t.onclick = () => { state.tab = t.dataset.t; render(); });
  document.getElementById('addBtn').onclick = addItem;
  if (state.tab === 'projects') {
    document.getElementById('createProjBtn').onclick = createProjectForm;
  }
  document.getElementById('helpBtn').onclick = () => {
    openModal({
      title: '📖 Unity Launcher 使用指南',
      content: helpHtml,
      isHtml: true,
      showCancel: false
    });
  };
}

async function addItem() {
  if (state.tab === 'projects') {
    const selectedDir = services.selectFolder ? services.selectFolder() : null;
    if (!selectedDir) return;

    const progressHtml = `
      <div style="padding: 10px 0; text-align: center;">
        <div style="font-weight: 600; color: #6366f1; margin-bottom: 6px; font-size: 13px;">正在深度扫描 Unity 项目，请稍候...</div>
        <div id="scanCurrentDirText" style="font-size: 11px; color: var(--text-secondary); margin-bottom: 14px; word-break: break-all; opacity: 0.85; font-family: monospace; height: 32px; overflow: hidden; display: flex; align-items: center; justify-content: center; padding: 0 10px;">${esc(selectedDir)}</div>
        <div class="progress-container">
          <div class="progress-track">
            <div class="progress-bar-fill progress-bar-animated" style="background: linear-gradient(90deg, #6366f1 0%, #3b82f6 50%, #10b981 100%);"></div>
          </div>
          <div class="progress-status-text" style="margin-top: 10px; display: flex; justify-content: space-between; padding: 0 4px;">
            <span id="scanProgressDirCount">已扫描目录: 0</span>
            <span id="scanProgressFoundCount" style="color: #10b981; font-weight: 600;">已识别项目: 0 个</span>
          </div>
        </div>
      </div>
    `;

    openModal({
      title: '🔍 批量扫描 Unity 项目',
      content: progressHtml,
      isHtml: true,
      showFooter: false
    });

    const dirTextEl = document.getElementById('scanCurrentDirText');
    const dirCountEl = document.getElementById('scanProgressDirCount');
    const foundCountEl = document.getElementById('scanProgressFoundCount');

    let list = [];
    try {
      if (services.scanFolderAsync) {
        list = await services.scanFolderAsync(selectedDir, ({ scannedCount, foundCount, currentDir }) => {
          if (dirTextEl) dirTextEl.textContent = currentDir;
          if (dirCountEl) dirCountEl.textContent = `已扫描目录: ${scannedCount}`;
          if (foundCountEl) foundCountEl.textContent = `已识别项目: ${foundCount} 个`;
        });
      } else {
        list = services.pickFolder() || [];
      }
    } catch (err) {
      console.error('Scan failed:', err);
    } finally {
      const overlay = document.getElementById('modalOverlay');
      if (overlay) overlay.classList.remove('active');
    }

    if (!list || !list.length) {
      if (ztools.showNotification) {
        ztools.showNotification('没有检测到新的 Unity 项目');
      }
      return;
    }

    let addedCount = 0;
    list.forEach(r => {
      if (state.projects.some(p => p.path === r.path)) return;
      state.projects.push({
        path: r.path,
        name: r.path.split(/[\\/]/).filter(Boolean).pop() || r.path,
        version: r.detectedVersion,
        editorPath: null,
        remark: "",
        lastOpenedAt: Date.now()
      });
      addedCount++;
    });

    if (ztools.showNotification) {
      if (addedCount > 0) {
        ztools.showNotification(`成功识别并添加 ${addedCount} 个 Unity 项目`);
      } else {
        ztools.showNotification('未扫描到新的 Unity 项目或项目已存在');
      }
    }
  } else {
    const list = services.pickExe();
    if (!list || !list.length) return;

    let addedCount = 0;
    list.forEach(e => {
      if (state.editors.some(x => x.path === e.path)) return;
      state.editors.push(e);
      addedCount++;
    });

    if (ztools.showNotification) {
      if (addedCount > 0) {
        ztools.showNotification(`成功识别并添加 ${addedCount} 个 Unity 编辑器`);
      } else {
        ztools.showNotification('未扫描到新的 Unity.exe 或编辑器已存在');
      }
    }
  }
  sortProjects();
  state.editors.sort((a, b) => compareUnityVersions(a.version, b.version));
  save(); render();
}

function createProjectForm() {
  if (state.editors.length === 0) {
    openModal({
      title: '新建项目',
      content: '无法创建项目：请先在「编辑器」标签下添加至少一个 Unity 编辑器版本。',
      showCancel: false
    });
    return;
  }

  const formHtml = `
    <div class="create-form">
      <div class="form-group">
        <label>项目名称</label>
        <input type="text" id="newProjName" placeholder="例如: MyNewGame" class="form-input" autocomplete="off" />
      </div>
      <div class="form-group">
        <label>存储父目录</label>
        <div style="display: flex; gap: 8px;">
          <input type="text" id="newProjParentPath" placeholder="请选择存储父目录..." class="form-input" readonly />
          <button class="btn" id="selectParentDirBtn" style="padding: 0 12px; width: auto; font-size: 11.5px; flex-shrink: 0; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); height: 32px;" title="选择文件夹">选择</button>
        </div>
      </div>
      <div class="form-group">
        <label>Unity 编辑器版本</label>
        <div class="custom-select-wrapper">
          <select id="newProjEditorSelect">
            ${state.editors.map((e, idx) => `<option value="${idx}">⚡ Unity ${e.version} — ${e.path}</option>`).join('')}
          </select>
          <svg class="custom-select-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </div>
      </div>
    </div>
  `;

  openModal({
    title: '新建 Unity 项目',
    content: formHtml,
    isHtml: true,
    onConfirm: () => {
      const nameInput = document.getElementById('newProjName');
      const parentInput = document.getElementById('newProjParentPath');
      const editorSelectEl = document.getElementById('newProjEditorSelect');

      const name = nameInput.value.trim();
      const parentPath = parentInput.value.trim();
      const editorIdx = +editorSelectEl.value;

      if (!name) {
        if (ztools.showNotification) ztools.showNotification('请输入项目名称');
        return;
      }
      if (!parentPath) {
        if (ztools.showNotification) ztools.showNotification('请选择存储父目录');
        return;
      }

      const editor = state.editors[editorIdx];
      
      try {
        const targetProjPath = services.createNewProject(editor.path, parentPath, name);
        
        // Add to project list
        state.projects.push({
          path: targetProjPath,
          name: name,
          version: editor.version,
          editorPath: editor.path, // pin it to this editor
          remark: "新建项目",
          lastOpenedAt: Date.now()
        });

        // Sort and save
        sortProjects();
        save();
        render();

        if (ztools.showNotification) {
          ztools.showNotification(`正在使用 Unity ${editor.version} 创建并打开项目「${name}」...`);
        }
        if (ztools.hideMainWindow) ztools.hideMainWindow();
      } catch (err) {
        if (ztools.showNotification) {
          ztools.showNotification(`创建项目失败: ${err.message}`);
        } else {
          alert(`创建项目失败: ${err.message}`);
        }
      }
    }
  });

  // Bind the parent directory select button click inside the modal
  const selectBtn = document.getElementById('selectParentDirBtn');
  const parentInput = document.getElementById('newProjParentPath');
  selectBtn.onclick = () => {
    const dir = services.pickDirectory();
    if (dir) {
      parentInput.value = dir;
    }
  };
}

function renderTagFilterBar() {
  const bar = document.getElementById('tagFilterBar');
  if (state.tab !== 'projects' || state.projects.length === 0) {
    bar.style.display = 'none';
    return;
  }

  const allTagsSet = new Set();
  let hasPinned = false;
  state.projects.forEach(p => {
    if (p.pinned) hasPinned = true;
    if (Array.isArray(p.tags)) {
      p.tags.forEach(t => allTagsSet.add(t));
    }
  });

  const allTags = Array.from(allTagsSet);

  if (!hasPinned && allTags.length === 0) {
    bar.style.display = 'none';
    return;
  }

  bar.style.display = 'flex';

  let chipsHtml = `
    <div class="tag-chip ${state.activeTagFilter === 'ALL' ? 'active' : ''}" data-chip="ALL">全部 (${state.projects.length})</div>
  `;

  if (hasPinned) {
    const pinnedCount = state.projects.filter(p => p.pinned).length;
    chipsHtml += `
      <div class="tag-chip ${state.activeTagFilter === '__PINNED__' ? 'active' : ''}" data-chip="__PINNED__">⭐ 仅看收藏 (${pinnedCount})</div>
    `;
  }

  allTags.forEach(t => {
    const count = state.projects.filter(p => Array.isArray(p.tags) && p.tags.includes(t)).length;
    chipsHtml += `
      <div class="tag-chip ${state.activeTagFilter === t ? 'active' : ''}" data-chip="${esc(t)}">${esc(t)} (${count})</div>
    `;
  });

  bar.innerHTML = chipsHtml;

  bar.querySelectorAll('[data-chip]').forEach(chip => {
    chip.onclick = () => {
      state.activeTagFilter = chip.dataset.chip;
      render();
    };
  });
}

function openTagManagerModal(origIdx) {
  const proj = state.projects[origIdx];
  let currentTags = Array.isArray(proj.tags) ? [...proj.tags] : [];

  const updateModalDOM = () => {
    const container = document.getElementById('modalCurrentTags');
    if (!container) return;
    if (currentTags.length === 0) {
      container.innerHTML = '<span style="color: var(--text-secondary); font-size: 12px; padding: 2px 4px;">暂无标签，可输入或点选快捷标签添加</span>';
      return;
    }
    container.innerHTML = currentTags.map((t, i) => {
      const c = getTagColor(t);
      return `
        <span class="tag-badge" style="background:${c.bg}; border:1px solid ${c.border}; color:${c.text}; padding: 4px 8px; font-size: 11px;">
          ${esc(t)}
          <span data-del-tag="${i}" style="margin-left: 6px; cursor: pointer; color: #ef4444; font-weight: bold;" title="移除标签">&times;</span>
        </span>`;
    }).join('');

    container.querySelectorAll('[data-del-tag]').forEach(el => {
      el.onclick = () => {
        const idx = +el.dataset.delTag;
        currentTags.splice(idx, 1);
        updateModalDOM();
      };
    });
  };

  const formHtml = `
    <div class="create-form">
      <div class="form-group">
        <label>当前已有标签</label>
        <div id="modalCurrentTags" style="display: flex; flex-wrap: wrap; gap: 6px; min-height: 36px; padding: 6px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; align-items: center;">
        </div>
      </div>
      <div class="form-group">
        <label>添加新标签</label>
        <div style="display: flex; gap: 8px;">
          <input type="text" id="modalTagInput" placeholder="输入标签名（如：工作、URP、Demo）" class="form-input" autocomplete="off" />
          <button class="btn" id="modalAddTagBtn" style="padding: 0 14px; width: auto; font-size: 12px; flex-shrink: 0; background: var(--primary-gradient);" title="添加">添加</button>
        </div>
      </div>
      <div class="form-group">
        <label>快捷常用标签</label>
        <div style="display: flex; flex-wrap: wrap; gap: 6px;" id="modalQuickTags">
          <span class="tag-chip" data-quicktag="工作">+ 工作</span>
          <span class="tag-chip" data-quicktag="个人">+ 个人</span>
          <span class="tag-chip" data-quicktag="URP">+ URP</span>
          <span class="tag-chip" data-quicktag="HDRP">+ HDRP</span>
          <span class="tag-chip" data-quicktag="Demo">+ Demo</span>
        </div>
      </div>
    </div>
  `;

  openModal({
    title: `管理标签 - ${proj.name}`,
    content: formHtml,
    isHtml: true,
    onConfirm: () => {
      proj.tags = currentTags;
      save();
      render();
    }
  });

  updateModalDOM();

  const tagInput = document.getElementById('modalTagInput');
  const addBtn = document.getElementById('modalAddTagBtn');
  const quickContainer = document.getElementById('modalQuickTags');

  const addSingleTag = (val) => {
    const tag = val.trim();
    if (!tag) return;
    if (!currentTags.includes(tag)) {
      currentTags.push(tag);
      updateModalDOM();
    }
    tagInput.value = '';
  };

  addBtn.onclick = () => addSingleTag(tagInput.value);
  tagInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addSingleTag(tagInput.value);
    }
  };

  if (quickContainer) {
    quickContainer.querySelectorAll('[data-quicktag]').forEach(chip => {
      chip.onclick = () => addSingleTag(chip.dataset.quicktag);
    });
  }
}

function render() {
  console.log('render() executing with state.tab =', state.tab);
  renderTabs();
  
  const searchBarWrapper = document.getElementById('searchBarWrapper');
  const searchInput = document.getElementById('searchInput');
  const searchClearBtn = document.getElementById('searchClearBtn');
  const c = document.getElementById('content');

  if (state.tab === 'projects') {
    renderTagFilterBar();

    // 只有项目列表显示搜索框（且有项目时显示）
    if (state.projects.length > 0) {
      searchBarWrapper.style.display = 'flex';
      searchInput.value = state.searchQuery;
      searchClearBtn.style.display = state.searchQuery ? 'block' : 'none';
    } else {
      searchBarWrapper.style.display = 'none';
      state.searchQuery = '';
    }

    const query = state.searchQuery.toLowerCase().trim();
    let displayProjects = state.projects.map((p, idx) => ({ ...p, originalIndex: idx }));

    if (state.activeTagFilter === '__PINNED__') {
      displayProjects = displayProjects.filter(p => p.pinned);
    } else if (state.activeTagFilter !== 'ALL') {
      displayProjects = displayProjects.filter(p => Array.isArray(p.tags) && p.tags.includes(state.activeTagFilter));
    }

    if (query) {
      displayProjects = displayProjects.filter(p =>
        p.name.toLowerCase().includes(query) ||
        (p.remark && p.remark.toLowerCase().includes(query)) ||
        (Array.isArray(p.tags) && p.tags.some(t => t.toLowerCase().includes(query)))
      );
    }

    if (!displayProjects.length) {
      if (query || state.activeTagFilter !== 'ALL') {
        c.innerHTML = `
          <div class="empty">
            <span class="empty-icon">🔍</span>
            <span>没有找到匹配的项目</span>
            <span class="warn">请尝试切换标签分类或修改搜索词（支持搜索项目名、备注、标签）</span>
          </div>`;
      } else {
        c.innerHTML = `
          <div class="empty">
            <span class="empty-icon">📁</span>
            <span>暂无 Unity 项目</span>
            <span class="warn">点击右上角「添加项目」按钮来记录您的第一个 Unity 项目</span>
          </div>`;
      }
      return bindContent(c);
    }

    c.innerHTML = displayProjects.map((p) => `
      <div class="item ${p.pinned ? 'pinned-item' : ''}">
        <div class="item-icon-wrapper">
          <svg class="unity-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 22 7 22 17 12 22 2 17 2 7 12 2"></polygon>
            <polyline points="2 7 12 12 22 7"></polyline>
            <line x1="12" y1="12" x2="12" y2="22"></line>
          </svg>
        </div>
        <div class="info">
          <div class="name-container">
            <span class="name">${esc(p.name)}</span>
            ${p.version ? `<span class="version-tag">${esc(p.version)}</span>` : ''}
          </div>
          <span class="sub" title="${esc(p.path)}">${esc(p.path)}</span>
          <div class="remark-container">
            <input type="text" class="remark-input" data-idx="${p.originalIndex}" value="${esc(p.remark || '')}" placeholder="添加项目备注信息（点击编辑，自动保存）..." />
          </div>
          ${renderTagBadges(p, p.originalIndex)}
        </div>
        <div class="actions">
          <button class="btn pin ${p.pinned ? 'active' : ''}" data-pin="${p.originalIndex}" title="${p.pinned ? '取消收藏/置顶' : '收藏并置顶项目'}">
            <svg viewBox="0 0 24 24" fill="${p.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
          </button>
          ${editorSelect(p)}
          <button class="btn open" data-open="${p.originalIndex}" title="使用指定/默认编辑器打开项目">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          </button>
          <button class="btn exp" data-exp="${p.originalIndex}" title="在资源管理器中显示">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
          </button>
          <button class="btn del" data-del="${p.originalIndex}" title="从列表中移除项目">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
          </button>
          <button class="btn rmdir" data-rmdir="${p.originalIndex}" title="彻底删除本地项目文件夹（危险）">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="9" y1="14" x2="15" y2="14"></line></svg>
          </button>
        </div>
      </div>`).join('');
  } else {
    // 编辑器界面隐去搜索框与标签栏
    searchBarWrapper.style.display = 'none';
    const tagFilterBar = document.getElementById('tagFilterBar');
    if (tagFilterBar) tagFilterBar.style.display = 'none';

    if (!state.editors.length) {
      c.innerHTML = `
        <div class="empty">
          <span class="empty-icon">⚙️</span>
          <span>暂无关联的 Unity 编辑器</span>
          <span class="warn">点击右上角「添加编辑器」选择您电脑里的 Unity.exe<br>（例如：&lt;Unity安装目录&gt;/Editor/Unity.exe）</span>
        </div>`;
      return bindContent(c);
    }
    c.innerHTML = state.editors.map((e, i) => `
      <div class="item editor-item">
        <div class="item-icon-wrapper">
          <svg class="unity-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 22 7 22 17 12 22 2 17 2 7 12 2"></polygon>
            <polyline points="2 7 12 12 22 7"></polyline>
            <line x1="12" y1="12" x2="12" y2="22"></line>
          </svg>
        </div>
        <div class="info">
          <div class="name-container">
            <span class="name">Unity ${esc(e.version)}</span>
          </div>
          <span class="sub" title="${esc(e.path)}">${esc(e.path)}</span>
        </div>
        <div class="actions">
          <button class="btn del" data-dele="${i}" title="从列表中移除编辑器">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
          </button>
        </div>
      </div>`).join('');
  }

  bindContent(c);
  console.log('render() complete');
}

function editorSelect(p) {
  const idx = state.projects.indexOf(p);
  const opts = ['<option value="">自动选择编辑器</option>']
    .concat(state.editors.map((e, i) =>
      `<option value="${i}" ${p.editorPath===e.path?'selected':''}>${esc(e.version)}</option>`));
  return `
    <div class="select-wrapper">
      <select data-sel="${idx}">
        ${opts.join('')}
      </select>
      <svg class="select-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
    </div>`;
}

function bindContent(c) {
  c.querySelectorAll('[data-open]').forEach(b => b.onclick = () => {
    const p = state.projects[+b.dataset.open];
    let editor = null;
    
    // 1. 如果手动指定了编辑器，使用指定的
    if (p.editorPath) {
      editor = state.editors.find(e => e.path === p.editorPath);
    }
    
    // 2. 如果是“自动选择”，且项目检测到了版本号，尝试自动智能匹配
    if (!editor && p.version && state.editors.length > 0) {
      // 2.1 精确版本匹配 (e.g. 2022.3.20f1)
      editor = state.editors.find(e => e.version === p.version);
      
      // 2.2 补丁版本匹配 (e.g. 2022.3.20)
      if (!editor) {
        const getV3 = v => (String(v).match(/^(\d+\.\d+\.\d+)/) || [])[1];
        const pV3 = getV3(p.version);
        if (pV3) {
          editor = state.editors.find(e => getV3(e.version) === pV3);
        }
      }
      
      // 2.3 次版本匹配 (e.g. 2022.3)
      if (!editor) {
        const getV2 = v => (String(v).match(/^(\d+\.\d+)/) || [])[1];
        const pV2 = getV2(p.version);
        if (pV2) {
          editor = state.editors.find(e => getV2(e.version) === pV2);
        }
      }
    }
    
    // 3. 如果依然没有匹配到，且目前只录入了一个编辑器，直接用这唯一的编辑器
    if (!editor && state.editors.length === 1) {
      editor = state.editors[0];
    }
    
    // 4. 启动编辑器或弹窗提示手动选择
    let launched = false;
    if (editor) {
      services.launch(editor.path, p.path);
      launched = true;
    } else if (ztools.showOpenDialog) {
      const r = ztools.showOpenDialog({ 
        title: `选择用于打开项目「${p.name}」(${p.version || '未知版本'}) 的 Unity.exe`, 
        properties: ['openFile'], 
        filters: [{ name: 'Unity Editor', extensions: ['exe'] }] 
      });
      if (r && r.length) {
        services.launch(r[0], p.path);
        launched = true;
      }
    }

    if (launched) {
      p.lastOpenedAt = Date.now();
      sortProjects();
      save();
    }
    if (ztools.hideMainWindow) ztools.hideMainWindow();
  });

  c.querySelectorAll('[data-pin]').forEach(b => b.onclick = () => {
    const idx = +b.dataset.pin;
    const p = state.projects[idx];
    p.pinned = !p.pinned;
    sortProjects();
    save();
    render();
  });

  c.querySelectorAll('[data-tagmgr]').forEach(b => b.onclick = () => {
    const idx = +b.dataset.tagmgr;
    openTagManagerModal(idx);
  });

  c.querySelectorAll('select[data-sel]').forEach(s => s.onchange = () => {
    state.projects[+s.dataset.sel].editorPath = s.value === '' ? null : state.editors[+s.value].path;
    save();
  });

  c.querySelectorAll('[data-exp]').forEach(b => b.onclick = () => services.openInExplorer(state.projects[+b.dataset.exp].path));

  c.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    const idx = +b.dataset.del;
    const proj = state.projects[idx];
    openModal({
      title: '确认移除项目',
      content: `确认从列表中移除项目「${proj.name}」吗？\n（此操作仅清理快捷启动记录，不会影响硬盘上的实际项目文件）`,
      onConfirm: () => {
        state.projects.splice(idx, 1);
        save();
        render();
      }
    });
  });

  c.querySelectorAll('[data-rmdir]').forEach(b => b.onclick = () => {
    const idx = +b.dataset.rmdir;
    const proj = state.projects[idx];
    
    // 第一阶段：严重警告
    openModal({
      title: '⚠️ 极其危险的删除操作',
      content: `您确定要彻底删除本地项目文件夹吗？\n\n项目名称: ${proj.name}\n项目路径: ${proj.path}\n\n警告: 此操作将在您的硬盘上彻底抹除该文件夹（包含 Assets、Library、工程代码等所有资源），数据将永久丢失且不可恢复！`,
      onConfirm: () => {
        // 第二阶段：二次防误触验证输入项目名称
        setTimeout(() => {
          openModal({
            title: '确认删除：请输入项目名称',
            content: `为防止误触，请在下方输入该项目的确切名称「${proj.name}」以确认删除行为：`,
            showInput: {
              expectedValue: proj.name,
              placeholder: '在此输入项目名以解锁删除按钮...'
            },
            onConfirm: () => {
              // 第三阶段：进入无缝进度条动画删除
              setTimeout(() => {
                const progressHtml = `
                  <div style="padding: 10px 0; text-align: center;">
                    <div style="font-weight: 600; color: #f43f5e; margin-bottom: 6px; font-size: 13px;">正在彻底清理本地硬盘文件，请稍候...</div>
                    <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 14px; word-break: break-all; opacity: 0.8; font-family: monospace;">${esc(proj.path)}</div>
                    <div class="progress-container">
                      <div class="progress-track">
                        <div class="progress-bar-fill progress-bar-animated"></div>
                      </div>
                      <div class="progress-status-text">
                        <span>递归清理 Assets、Library 极多缓存文件...</span>
                        <span style="color: #f97316; font-weight: 600;">删除中</span>
                      </div>
                    </div>
                  </div>
                `;

                openModal({
                  title: `正在彻底删除项目「${proj.name}」`,
                  content: progressHtml,
                  isHtml: true,
                  showFooter: false
                });

                services.deleteFolderAsync(proj.path)
                  .then(() => {
                    const overlay = document.getElementById('modalOverlay');
                    if (overlay) overlay.classList.remove('active');

                    state.projects.splice(idx, 1);
                    save();
                    render();
                    if (ztools.showNotification) {
                      ztools.showNotification(`已成功删除项目「${proj.name}」及其磁盘本地文件夹`);
                    }
                  })
                  .catch((err) => {
                    const overlay = document.getElementById('modalOverlay');
                    if (overlay) overlay.classList.remove('active');

                    console.error(err);
                    if (ztools.showNotification) {
                      ztools.showNotification(`本地删除失败: ${err.message}`);
                    } else {
                      alert(`本地删除失败: ${err.message}`);
                    }
                  });
              }, 150);
            }
          });
        }, 200);
      }
    });
  });

  c.querySelectorAll('[data-dele]').forEach(b => b.onclick = () => {
    const idx = +b.dataset.dele;
    const editor = state.editors[idx];
    openModal({
      title: '确认移除编辑器',
      content: `确认从列表中移除 Unity ${editor.version} 编辑器的启动关联记录吗？`,
      onConfirm: () => {
        state.editors.splice(idx, 1);
        save();
        render();
      }
    });
  });

  c.querySelectorAll('.remark-input').forEach(input => {
    input.onchange = () => {
      const idx = +input.dataset.idx;
      state.projects[idx].remark = input.value.trim();
      save();
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') input.blur();
    };
  });
}

function esc(s){ return String(s||'').replace(/</g,'&lt;').replace(/&/g,'&amp;'); }

function setupSearchListeners() {
  const searchInput = document.getElementById('searchInput');
  const searchClearBtn = document.getElementById('searchClearBtn');
  
  if (!searchInput || !searchClearBtn) return;
  
  searchInput.oninput = () => {
    state.searchQuery = searchInput.value;
    searchClearBtn.style.display = state.searchQuery ? 'block' : 'none';
    render();
  };
  
  searchClearBtn.onclick = () => {
    state.searchQuery = '';
    searchInput.value = '';
    searchClearBtn.style.display = 'none';
    render();
  };
}

function applyTheme() {
  let isDark = true;
  if (typeof ztools.isDarkMode === 'function') {
    isDark = ztools.isDarkMode();
  } else if (window.matchMedia) {
    isDark = !window.matchMedia('(prefers-color-scheme: light)').matches;
  }
  
  if (isDark) {
    document.documentElement.classList.remove('light');
    document.documentElement.classList.add('dark');
    document.body.classList.remove('light-mode');
    document.body.classList.add('dark-mode');
  } else {
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
    document.body.classList.remove('dark-mode');
    document.body.classList.add('light-mode');
  }
}

function boot() {
  console.log('boot() executing...');
  try {
    if (typeof services === 'undefined') {
      console.error('services is undefined!');
      document.body.innerHTML = '<div style="color:#f66;padding:10px;">preload 未注入：services 未定义。</div>';
      return;
    }
    applyTheme();
    if (window.matchMedia) {
      try {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
      } catch (e) {}
    }
    if (ztools.onPluginEnter) {
      ztools.onPluginEnter(() => {
        applyTheme();
      });
    }
    load();
    setupSearchListeners();
    render();
    if (ztools.setExpendHeight) ztools.setExpendHeight(620);
  } catch(e) {
    console.error('boot() crashed:', e);
    document.body.innerHTML += '<div style="color:#f66;padding:10px;">初始化失败: ' + esc(e.message) + '</div>';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

function openModal({ title, content, onConfirm, showCancel = true, showInput = null, isHtml = false, showFooter = true }) {
  const overlay = document.getElementById('modalOverlay');
  const titleEl = document.getElementById('modalTitle');
  const textEl = document.getElementById('modalText');
  const inputEl = document.getElementById('modalInput');
  const cancelBtn = document.getElementById('modalCancelBtn');
  const confirmBtn = document.getElementById('modalConfirmBtn');
  const closeBtn = document.getElementById('modalClose');
  const footerEl = overlay ? overlay.querySelector('.modal-footer') : null;

  titleEl.textContent = title;
  if (isHtml) {
    textEl.style.whiteSpace = 'normal';
    textEl.innerHTML = content;
  } else {
    textEl.style.whiteSpace = 'pre-wrap';
    textEl.textContent = content; // 使用 textContent 确保安全防止 XSS 攻击
  }

  if (footerEl) {
    footerEl.style.display = showFooter ? 'flex' : 'none';
  }
  closeBtn.style.display = showFooter ? 'block' : 'none';
  cancelBtn.style.display = showCancel ? 'inline-block' : 'none';
  
  // 克隆节点以重置之前绑定的事件监听器，避免多次弹窗的事件污染
  const newConfirm = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
  
  const newCancel = cancelBtn.cloneNode(true);
  cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);

  const newClose = closeBtn.cloneNode(true);
  closeBtn.parentNode.replaceChild(newClose, closeBtn);

  const closeModal = () => {
    overlay.classList.remove('active');
  };

  if (showInput) {
    inputEl.style.display = 'block';
    inputEl.value = '';
    inputEl.placeholder = showInput.placeholder || '';
    
    newConfirm.disabled = true;
    newConfirm.style.opacity = '0.5';
    newConfirm.style.cursor = 'not-allowed';
    
    inputEl.oninput = () => {
      const isMatch = inputEl.value.trim() === showInput.expectedValue;
      newConfirm.disabled = !isMatch;
      newConfirm.style.opacity = isMatch ? '1' : '0.5';
      newConfirm.style.cursor = isMatch ? 'pointer' : 'not-allowed';
    };
    
    setTimeout(() => inputEl.focus(), 50);
  } else {
    inputEl.style.display = 'none';
    newConfirm.disabled = false;
    newConfirm.style.opacity = '1';
    newConfirm.style.cursor = 'pointer';
  }

  newConfirm.onclick = () => {
    closeModal();
    if (onConfirm) onConfirm();
  };

  newCancel.onclick = closeModal;
  newClose.onclick = closeModal;
  overlay.onclick = (e) => {
    if (e.target === overlay && showFooter) closeModal();
  };

  overlay.classList.add('active');
}
