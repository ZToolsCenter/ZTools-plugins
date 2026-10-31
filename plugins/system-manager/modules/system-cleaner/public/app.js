'use strict'

const CATEGORY_LABELS = { cache: '缓存', logs: '日志', temporary: '临时' }
const state = { snapshotId: '', candidates: [], busy: false, expandedGroups: new Set() }
const elements = {
  scanButton: document.querySelector('#scanButton'),
  cleanButton: document.querySelector('#cleanButton'),
  themeButton: document.querySelector('#themeButton'),
  statusPanel: document.querySelector('#statusPanel'),
  resultPanel: document.querySelector('#resultPanel'),
  totalSize: document.querySelector('#totalSize'),
  scanMeta: document.querySelector('#scanMeta'),
  candidateList: document.querySelector('#candidateList'),
  selectedSize: document.querySelector('#selectedSize'),
  selectedCount: document.querySelector('#selectedCount'),
  warnings: document.querySelector('#warnings'),
  template: document.querySelector('#candidateTemplate'),
  dialog: document.querySelector('#confirmDialog'),
  dialogCount: document.querySelector('#dialogCount'),
  dialogSize: document.querySelector('#dialogSize'),
  confirmInput: document.querySelector('#confirmInput'),
  confirmCleanButton: document.querySelector('#confirmCleanButton')
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** unit).toLocaleString('zh-CN', { maximumFractionDigits: unit > 2 ? 1 : 0 })} ${units[unit]}`
}

const api = window.systemCleaner || null

function selectedCandidates() {
  const selected = new Set([...document.querySelectorAll('.candidate-check:checked')].map((input) => input.dataset.id))
  return state.candidates.filter((item) => selected.has(item.id))
}

function updateSelection() {
  const selected = selectedCandidates()
  const bytes = selected.reduce((sum, item) => sum + item.sizeBytes, 0)
  elements.selectedSize.textContent = formatBytes(bytes)
  elements.selectedCount.textContent = `已选 ${selected.length} 项`
  elements.cleanButton.disabled = state.busy || selected.length === 0;

  document.querySelectorAll('.group-card').forEach((card) => {
    const groupCheck = card.querySelector('.group-check');
    if (!groupCheck) return;
    const childChecks = [...card.querySelectorAll('.child-item .candidate-check')];
    if (!childChecks.length) return;
    const checkedCount = childChecks.filter(c => c.checked).length;
    if (checkedCount === 0) {
      groupCheck.checked = false;
      groupCheck.indeterminate = false;
    } else if (checkedCount === childChecks.length) {
      groupCheck.checked = true;
      groupCheck.indeterminate = false;
    } else {
      groupCheck.checked = false;
      groupCheck.indeterminate = true;
    }
  });
}

function setBusy(busy) {
  state.busy = busy
  elements.scanButton.disabled = busy
  elements.cleanButton.disabled = busy || selectedCandidates().length === 0
  document.querySelectorAll('.candidate-check').forEach((input) => { input.disabled = busy })
  document.querySelectorAll('input[name=category]').forEach((input) => { input.disabled = busy })
}

function createGroupCard(group, groupId) {
  const isExpanded = state.expandedGroups.has(groupId);
  const groupTotalBytes = group.items.reduce((s, i) => s + i.sizeBytes, 0);

  const card = document.createElement('div');
  card.className = 'group-card';
  card.dataset.groupId = groupId;

  const header = document.createElement('div');
  header.className = 'candidate group-header';

  const selectLabel = document.createElement('label');
  selectLabel.className = 'candidate-select';
  const groupCheck = document.createElement('input');
  groupCheck.type = 'checkbox';
  groupCheck.className = 'candidate-check group-check';
  groupCheck.checked = group.items.some(i => i.selectedByDefault);
  const selectSpan = document.createElement('span');
  selectSpan.setAttribute('aria-hidden', 'true');
  selectLabel.appendChild(groupCheck);
  selectLabel.appendChild(selectSpan);

  const iconImg = document.createElement('img');
  iconImg.className = 'candidate-icon';
  iconImg.alt = '';
  iconImg.setAttribute('aria-hidden', 'true');
  iconImg.src = group.icon || '';

  const mainDiv = document.createElement('div');
  mainDiv.className = 'candidate-main';
  const titleRow = document.createElement('div');
  titleRow.style.display = 'flex';
  titleRow.style.alignItems = 'center';
  titleRow.style.gap = '8px';
  const strong = document.createElement('strong');
  strong.className = 'candidate-label';
  strong.textContent = group.appName;
  const countBadge = document.createElement('span');
  countBadge.className = 'candidate-badge group-count-badge';
  countBadge.textContent = `${group.items.length} 处项目`;
  titleRow.appendChild(strong);
  titleRow.appendChild(countBadge);

  const locP = document.createElement('p');
  locP.className = 'candidate-location';
  locP.textContent = `共 ${group.items.length} 处子项，点击右侧可展开明细`;
  mainDiv.appendChild(titleRow);
  mainDiv.appendChild(locP);

  const infoDiv = document.createElement('div');
  infoDiv.className = 'candidate-info';
  const sizeStrong = document.createElement('strong');
  sizeStrong.className = 'candidate-size';
  sizeStrong.textContent = formatBytes(groupTotalBytes);
  infoDiv.appendChild(sizeStrong);

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'reveal-button group-toggle-btn quiet';
  toggleBtn.textContent = isExpanded ? '收起 ▲' : '展开 ▼';

  header.appendChild(selectLabel);
  header.appendChild(iconImg);
  header.appendChild(mainDiv);
  header.appendChild(infoDiv);
  header.appendChild(toggleBtn);

  const childrenContainer = document.createElement('div');
  childrenContainer.className = 'group-children';
  if (!isExpanded) {
    childrenContainer.style.display = 'none';
  }

  group.items.forEach((item) => {
    const childNode = elements.template.content.firstElementChild.cloneNode(true);
    childNode.classList.add('child-item');
    const check = childNode.querySelector('.candidate-check');
    check.dataset.id = item.id;
    check.checked = Boolean(item.selectedByDefault);
    check.addEventListener('change', updateSelection);

    const childIcon = childNode.querySelector('.candidate-icon');
    if (item.icon) {
      childIcon.src = item.icon;
      childIcon.style.display = '';
    } else {
      childIcon.style.display = 'none';
    }

    childNode.querySelector('.candidate-label').textContent = item.label;
    const badge = childNode.querySelector('.candidate-badge');
    badge.textContent = CATEGORY_LABELS[item.category] || item.category;
    childNode.querySelector('.candidate-location').textContent = item.location;
    childNode.querySelector('.candidate-size').textContent = formatBytes(item.sizeBytes);
    childNode.querySelector('.candidate-age').textContent = item.updatedAt ? new Date(item.updatedAt).toLocaleDateString('zh-CN') : '近期';

    const reveal = childNode.querySelector('.reveal-button');
    reveal.addEventListener('click', (e) => {
      e.stopPropagation();
      if (api?.reveal) {
        api.reveal(item.location).catch((error) => alert(error?.message || '无法定位路径'));
      }
    });

    childrenContainer.appendChild(childNode);
  });

  groupCheck.addEventListener('change', () => {
    const checked = groupCheck.checked;
    childrenContainer.querySelectorAll('.child-item .candidate-check').forEach((c) => {
      c.checked = checked;
    });
    updateSelection();
  });

  header.addEventListener('click', (e) => {
    if (e.target.closest('.candidate-select') || e.target.closest('.reveal-button')) {
      return;
    }
    toggleBtn.click();
  });

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const expanded = state.expandedGroups.has(groupId);
    if (expanded) {
      state.expandedGroups.delete(groupId);
      childrenContainer.style.display = 'none';
      toggleBtn.textContent = '展开 ▼';
    } else {
      state.expandedGroups.add(groupId);
      childrenContainer.style.display = 'block';
      toggleBtn.textContent = '收起 ▲';
    }
  });

  card.appendChild(header);
  card.appendChild(childrenContainer);
  return card;
}

function render(result) {
  state.snapshotId = result.snapshotId;
  state.candidates = result.candidates || [];
  elements.totalSize.textContent = formatBytes(result.totalBytes || 0);
  elements.scanMeta.textContent = `${state.candidates.length} 项候选 · ${new Date().toLocaleTimeString('zh-CN')}`;
  elements.candidateList.innerHTML = "";

  if (result.warnings?.length) {
    elements.warnings.hidden = false;
    elements.warnings.textContent = result.warnings.map(w => typeof w === 'string' ? w : (w?.message || w?.code || JSON.stringify(w))).join('；');
  } else {
    elements.warnings.hidden = true;
    elements.warnings.textContent = '';
  }

  if (state.candidates.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-card';
    empty.innerHTML = '<strong>当前无可安全清理的文件</strong><p>系统运行良好，未发现符合白名单的冗余项目。</p>';
    elements.candidateList.appendChild(empty);
    updateSelection();
    return;
  }

  const appMap = new Map();
  state.candidates.forEach((item) => {
    const appKey = item.appName || item.label || '系统项目';
    if (!appMap.has(appKey)) {
      appMap.set(appKey, {
        appName: appKey,
        icon: item.icon,
        category: item.category,
        items: []
      });
    }
    appMap.get(appKey).items.push(item);
  });

  let groupIndex = 0;
  appMap.forEach((group, appKey) => {
    groupIndex++;
    if (group.items.length > 1) {
      const groupId = `group_${groupIndex}_${encodeURIComponent(appKey)}`;
      const groupCard = createGroupCard(group, groupId);
      elements.candidateList.appendChild(groupCard);
    } else {
      const item = group.items[0];
      const node = elements.template.content.firstElementChild.cloneNode(true);
      const check = node.querySelector('.candidate-check');
      check.dataset.id = item.id;
      check.checked = Boolean(item.selectedByDefault);
      check.addEventListener('change', updateSelection);

      const iconImg = node.querySelector('.candidate-icon');
      if (item.icon) {
        iconImg.src = item.icon;
      } else {
        iconImg.style.display = 'none';
      }

      node.querySelector('.candidate-label').textContent = item.appName ? `${item.appName} · ${item.label}` : item.label;
      const badge = node.querySelector('.candidate-badge');
      badge.textContent = CATEGORY_LABELS[item.category] || item.category;
      node.querySelector('.candidate-location').textContent = item.location;
      node.querySelector('.candidate-size').textContent = formatBytes(item.sizeBytes);
      node.querySelector('.candidate-age').textContent = item.updatedAt ? new Date(item.updatedAt).toLocaleDateString('zh-CN') : '近期';

      const reveal = node.querySelector('.reveal-button');
      reveal.addEventListener('click', () => {
        if (api?.reveal) {
          const res = typeof api.reveal === 'function' ? api.reveal({ snapshotId: state.snapshotId, candidateId: item.id }) : null;
          if (res && typeof res.catch === 'function') {
            res.catch((error) => alert(error?.message || '无法定位路径'));
          }
        }
      });

      elements.candidateList.appendChild(node);
    }
  });

  updateSelection();
  elements.statusPanel.hidden = true;
  elements.resultPanel.hidden = false;
}

async function scan() {
  setBusy(true)
  elements.resultPanel.hidden = true
  elements.statusPanel.hidden = false
  elements.statusPanel.classList.remove('is-error')
  elements.statusPanel.querySelector('strong').textContent = '正在读取安全清理范围'
  elements.statusPanel.querySelector('p').textContent = '不会扫描文档、照片或其他个人内容目录。'
  try {
    if (!api || typeof api.scan !== 'function') throw new Error('本地清理能力未加载，请在 ZTools 中重新打开插件。')
    const categories = [...document.querySelectorAll('input[name=category]:checked')].map((input) => input.value)
    render(await api.scan({ categories }))
  } catch (error) {
    elements.statusPanel.classList.add('is-error')
    elements.statusPanel.querySelector('strong').textContent = '扫描未完成'
    elements.statusPanel.querySelector('p').textContent = error?.message || '请稍后重试。'
  } finally {
    setBusy(false)
  }
}

function openConfirm() {
  const selected = selectedCandidates()
  elements.dialogCount.textContent = String(selected.length)
  elements.dialogSize.textContent = formatBytes(selected.reduce((sum, item) => sum + item.sizeBytes, 0))
  elements.confirmInput.value = ''
  elements.confirmCleanButton.disabled = true
  elements.dialog.showModal()
  elements.confirmInput.focus()
}

async function executeClean() {
  const selected = selectedCandidates()
  if (!selected.length || elements.confirmInput.value !== '移到废纸篓') return
  setBusy(true)
  elements.confirmCleanButton.disabled = true
  try {
    const result = await api.clean({ snapshotId: state.snapshotId, candidateIds: selected.map((item) => item.id), confirmation: '移到废纸篓' })
    const failedResults = (result.results || []).filter((item) => item.status === 'failed')
    const failed = new Set(failedResults.map((item) => item.candidateId))
    state.candidates = state.candidates.filter((item) => failed.has(item.id) || !selected.some((chosen) => chosen.id === item.id))
    elements.dialog.close()
    await scan()
    if (failedResults.length) {
      elements.warnings.hidden = false
      elements.warnings.textContent = `${failedResults.length} 项未能移到废纸篓，已安全跳过；请查看权限或重新扫描。`
    }
  } catch (error) {
    elements.confirmInput.setCustomValidity(error?.message || '清理失败，请重新扫描')
    elements.confirmInput.reportValidity()
  } finally {
    setBusy(false)
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme
  try { localStorage.setItem('system-cleaner-theme', theme) } catch {}
}

elements.scanButton.addEventListener('click', scan)
elements.cleanButton.addEventListener('click', openConfirm)
elements.confirmInput.addEventListener('input', () => { elements.confirmInput.setCustomValidity(''); elements.confirmCleanButton.disabled = elements.confirmInput.value !== '移到废纸篓' })
elements.confirmCleanButton.addEventListener('click', executeClean)
elements.themeButton.addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'))
document.querySelectorAll('input[name=category]').forEach((input) => input.addEventListener('change', scan))
let initialTheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
try { initialTheme = localStorage.getItem('system-cleaner-theme') || initialTheme } catch {}
applyTheme(initialTheme)
scan()
