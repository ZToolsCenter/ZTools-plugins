import { createFindingPageCollector, humanFindingKind, parseDocument, compareContracts, reportMarkdown } from '../core/contract.js';

const UI_PAGE_SIZE = 100;
const ledger = document.querySelector('#ledger');
const $ = (selector) => document.querySelector(selector);
const levelLabels = { breaking: '破坏性变更', 'non-breaking': '兼容性变更', info: '信息' };
let comparison = null;
let currentPage = null;

function entry(finding) {
  const article = document.createElement('article');
  const title = document.createElement('b');
  const firstBreak = document.createElement('br');
  const pointer = document.createElement('code');
  const secondBreak = document.createElement('br');
  article.className = `entry ${finding.level}`;
  title.textContent = `${levelLabels[finding.level] || '未知级别'} · ${humanFindingKind(finding.kind)}`;
  pointer.textContent = finding.pointer;
  article.append(title, firstBreak, pointer, secondBreak, document.createTextNode(finding.reason));
  return article;
}

function setResultControls(enabled) {
  $('#copy-md').disabled = !enabled;
  $('#copy-json').disabled = !enabled;
  const total = currentPage?.counts.total || 0;
  const offset = currentPage?.offset || 0;
  const returned = currentPage?.findings.length || 0;
  $('#previous-page').disabled = !enabled || offset === 0;
  $('#next-page').disabled = !enabled || offset + returned >= total;
  $('#finding-summary').textContent = enabled
    ? total === 0 ? '未发现影响行为的差异。' : `显示第 ${offset + 1}—${offset + returned} 条，共 ${total} 条`
    : '尚未执行比较';
}

function clearComparison(message = '请输入或选择两份契约后执行比较。') {
  comparison = null;
  currentPage = null;
  setResultControls(false);
  ledger.replaceChildren(Object.assign(document.createElement('article'), { className: 'entry info', textContent: message }));
}

function render() {
  const items = currentPage.findings.length
    ? currentPage.findings.map(entry)
    : [Object.assign(document.createElement('article'), { className: 'entry non-breaking', textContent: '未发现影响行为的差异。' })];
  ledger.replaceChildren(...items);
  setResultControls(true);
}

function comparePage(offset = 0) {
  const collector = createFindingPageCollector(offset, UI_PAGE_SIZE);
  compareContracts(comparison.before, comparison.after, collector);
  currentPage = collector;
  render();
}

function run(beforeText, afterText) {
  const before = parseDocument(beforeText);
  const after = parseDocument(afterText);
  comparison = { before, after };
  comparePage(0);
}

function visibleError(error) {
  const message = String(error?.message || '');
  return /[\u3400-\u9fff]/.test(message) ? message : '契约处理失败，请检查输入。';
}

function showError(error) {
  comparison = null;
  currentPage = null;
  setResultControls(false);
  ledger.replaceChildren(Object.assign(document.createElement('article'), { className: 'entry', textContent: visibleError(error) }));
}

$('#compare').onclick = () => {
  try { run($('#old').value, $('#next').value); }
  catch (error) { showError(error); }
};

$('#copy-md').onclick = () => {
  if (currentPage) window.contractGate?.copyText?.(reportMarkdown(currentPage.findings));
};

$('#copy-json').onclick = () => {
  if (currentPage) window.contractGate?.copyText?.(JSON.stringify({ counts: currentPage.counts, page: { offset: currentPage.offset, limit: currentPage.limit }, findings: currentPage.findings }, null, 2));
};

$('#previous-page').onclick = () => {
  if (!comparison || !currentPage) return;
  try { comparePage(Math.max(0, currentPage.offset - UI_PAGE_SIZE)); }
  catch (error) { showError(error); }
};

$('#next-page').onclick = () => {
  if (!comparison || !currentPage) return;
  try { comparePage(currentPage.offset + UI_PAGE_SIZE); }
  catch (error) { showError(error); }
};

for (const input of [$('#old'), $('#next')]) input.addEventListener('input', () => clearComparison('输入已更改，请重新执行比较。'));

$('#choose').onclick = async () => {
  try {
    const selected = await window.contractGate?.choose?.();
    if (!selected) throw Error('ZTools 能力桥不可用');
    if (selected.length === 0) { clearComparison('未选择契约文件。'); return; }
    const documents = window.contractGate?.readGranted?.();
    if (!documents) throw Error('ZTools 能力桥不可用');
    clearComparison('已载入契约；请补齐两份后执行比较。');
    if (documents[0]) $('#old').value = documents[0];
    if (documents[1]) $('#next').value = documents[1];
    if (documents.length === 2) run(documents[0], documents[1]);
  } catch (error) { showError(error); }
};

clearComparison();
