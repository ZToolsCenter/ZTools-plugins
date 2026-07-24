"use strict";
let state = null;
document.addEventListener('keydown', (e) => {
    if (e.target?.closest('button'))
        return;
    if (!state || state.view.length === 0)
        return;
    if (e.key === 'ArrowDown') {
        state.highlighted = Math.min(state.highlighted + 1, state.view.length - 1);
        render();
        e.preventDefault();
    }
    else if (e.key === 'ArrowUp') {
        state.highlighted = Math.max(state.highlighted - 1, 0);
        render();
        e.preventDefault();
    }
    else if (e.key === 'Enter') {
        select(state.view[state.highlighted]);
        e.preventDefault();
    }
});
function render() {
    if (!state)
        return;
    const { list, empty, diag, view, highlighted, diagText } = state;
    if (view.length === 0) {
        list.hidden = true;
        empty.hidden = false;
        if (diagText) {
            diag.textContent = diagText;
            diag.hidden = false;
        }
        else {
            diag.hidden = true;
        }
    }
    else {
        list.hidden = false;
        empty.hidden = true;
        diag.hidden = true;
        list.innerHTML = '';
        view.forEach((it, idx) => {
            const li = document.createElement('li');
            if (idx === highlighted)
                li.classList.add('active');
            const t = document.createElement('div');
            t.className = 'title';
            t.textContent = it.title;
            li.appendChild(t);
            const s = document.createElement('div');
            s.className = 'subtitle';
            s.textContent = it.subtitle;
            li.appendChild(s);
            li.addEventListener('click', () => select(it));
            list.appendChild(li);
        });
        const active = list.querySelector('.active');
        if (active)
            active.scrollIntoView({ block: 'nearest' });
    }
    // Defer height adjustment until after DOM layout. Double rAF avoids the case
    // where a single rAF still races a measurement that depends on subsequent style flush.
    requestAnimationFrame(() => requestAnimationFrame(() => applyHeight()));
}
function applyHeight() {
    if (!state)
        return;
    const { list, empty, diag } = state;
    const listH = list.hidden ? 0 : list.offsetHeight;
    const emptyH = empty.hidden ? 0 : empty.offsetHeight;
    const diagH = diag.hidden ? 0 : diag.offsetHeight;
    const padding = 8;
    const desired = listH + emptyH + diagH + padding;
    ztools.setExpendHeight(desired);
}
async function configureWindowsVSCode(button) {
    button.disabled = true;
    try {
        const result = await window.recentApi.configureWindowsExecutable();
        if (result.ok) {
            ztools.showNotification('VSCode 已配置：' + result.path);
        }
        else if (!result.canceled) {
            ztools.showNotification('配置 VSCode 失败：' + result.reason);
        }
    }
    catch (e) {
        ztools.showNotification('配置 VSCode 失败（IPC 异常）：' + (e instanceof Error ? e.message : String(e)));
    }
    finally {
        button.disabled = false;
    }
}
async function select(item) {
    // KEEP-IN-SYNC with src/select-actions.ts:decideSelectActions — the
    // sandboxed plugin view has no module loader so the policy lives inline
    // here AND as a pure function in src/ (tested). When you change one,
    // change the other.
    let r;
    try {
        r = await window.recentApi.open(item);
    }
    catch (e) {
        ztools.showNotification('启动 VSCode 失败（IPC 异常）：' + (e instanceof Error ? e.message : String(e)));
        return;
    }
    if (r.ok) {
        // 关闭 ztool 主窗口（不仅退出插件视图），让用户专注于刚启动的 VSCode
        ztools.hideMainWindow?.(false);
        ztools.outPlugin();
    }
    else {
        ztools.showNotification('无法启动 VSCode：' + r.reason +
            '。请确认已安装稳定版 Visual Studio Code；Windows 用户可通过页面中的“设置 VSCode”手动选择 Code.exe，Linux 用户需确保 code 命令可用。');
    }
}
function formatDiag(d) {
    const lines = ['诊断信息（list 为空时显示）:'];
    for (const p of d.diag.probes) {
        if (p.error) {
            lines.push(`  [${p.name}] ERROR: ${p.error}`);
        }
        else if (p.rawCount === null) {
            lines.push(`  [${p.name}] 源不存在或无法读取`);
        }
        else {
            lines.push(`  [${p.name}] 原始 ${p.rawCount} 条`);
        }
    }
    lines.push(`  mapper 输出: ${d.diag.mappedCount} 条`);
    lines.push(`  最终展示: ${d.diag.finalCount} 条 (因路径不存在丢弃 ${d.diag.droppedNonexistent} 条)`);
    if (d.diag.examplePath) {
        lines.push(`  样本路径: ${d.diag.examplePath}`);
    }
    return lines.join('\n');
}
ztools.onPluginEnter(async () => {
    const list = document.getElementById('list');
    const empty = document.getElementById('empty');
    const diag = document.getElementById('diag');
    const toolbar = document.getElementById('toolbar');
    const configureButton = document.getElementById('configure-vscode');
    const isWindows = window.recentApi.platform === 'win32';
    toolbar.hidden = !isWindows;
    configureButton.onclick = () => configureWindowsVSCode(configureButton);
    let items = [];
    let diagText = '';
    try {
        items = await window.recentApi.list();
    }
    catch (e) {
        ztools.showNotification('读取 VSCode 历史失败：' + (e instanceof Error ? e.message : String(e)));
        items = [];
    }
    if (items.length === 0) {
        try {
            const detailed = await window.recentApi.diagnose();
            diagText = formatDiag(detailed);
        }
        catch (e) {
            diagText = '诊断失败: ' + (e instanceof Error ? e.message : String(e));
        }
    }
    const fuse = new window.Fuse(items, {
        keys: ['title', 'subtitle'],
        threshold: 0.4,
        includeScore: true,
    });
    state = { items, view: items, highlighted: 0, fuse, list, empty, diag, diagText };
    ztools.setSubInput((arg) => {
        if (!state)
            return;
        const text = arg.text.trim();
        state.view = text ? state.fuse.search(text).map((r) => r.item) : state.items;
        state.highlighted = 0;
        render();
    }, '搜索 VSCode 项目');
    render();
});
