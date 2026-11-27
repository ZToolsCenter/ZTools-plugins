// 「下载」列表的流程，有两种进入方式：
//  - 在 ZTools 主搜索框里输入或粘贴一个远端绝对路径，选「下载远端文件」：带着路径进来，直接选服务器。
//  - 输入「下载文件」：先选服务器，再在启动器的搜索框里粘贴或输入路径。
// 路径始终在启动器的搜索框里输入，插件不在列表里另放输入框。为此要处理宿主搜索框的一个行为：
// 搜索框为空时粘贴文本，宿主不把文字放进输入框，而是在旁边显示成一个标签，也不通知插件。
// 所以按回车时如果还没有路径，就取剪贴板里最近的一条文本当作路径。
// 只依赖注入的 services（Node 侧能力）、host（ZTools 接口）与 configStore，不涉及界面。

import { authMode, buildDownloadArgs, describeScpFailure, remotePathProblem, scpRequest } from '../core/scp-args.js';
import { joinLocalPath, remoteBaseName } from '../core/paths.js';
import { filterTargets, moveHighlight, orderTargets } from '../core/list-model.js';
import { createStore } from '../core/store.js';
import { targetDestination } from '../core/targets.js';
import { SELECTABLE_PHASES, collapse, errorText, setupRow, targetRow } from './list-rows.js';

// stepTick 每进入一个步骤加一，boxValue 是这一步开始时搜索框应有的内容；界面层据此设置搜索框并全选。
const IDLE = Object.freeze({
  phase: 'idle', rows: [], highlight: 0, status: null, query: '', placeholder: '', stepTick: 0, boxValue: ''
});
const PICK_PLACEHOLDER = '搜索服务器，回车继续';
const PATH_PLACEHOLDER = '粘贴或输入远端文件的绝对路径，回车下载';
const NO_PASTED_PATH = '没有读到粘贴的内容：请先复制远端路径，粘贴后回车，或直接输入';

export function createDownloadFlow({ services, host, configStore, openSetup = () => {} }) {
  const store = createStore({ ...IDLE });
  let targets = [];
  let config = { targets: [], downloadDir: '', lastUsedId: '' };
  let chosen = null;
  let remotePath = '';
  let busy = false;
  let stepTick = 0;
  let boxValue = '';

  // 进入一个步骤：记下这一步开始时搜索框应有的内容。只在这里计数，不能放在渲染函数里：
  // 输入过程中每敲一个字都会重新渲染，那样每输入一个字符搜索框就被重设一次。
  const enterStep = (value) => {
    stepTick += 1;
    boxValue = value;
  };
  const step = () => ({ stepTick, boxValue });

  const show = (rows, phase, status = null, extra = {}) => store.set({ rows, phase, status, highlight: 0, ...step(), ...extra });
  const trimmedPath = () => remotePath.trim();
  const hasPath = () => !remotePathProblem(trimmedPath());
  const downloadDir = () => config.downloadDir || host?.getPath?.('downloads') || services?.defaultDownloadDir?.() || '';

  // 选服务器。带着路径进来时这一步就直接可以下载，列表末尾留一个「更改远端路径」。
  const renderPick = () => {
    const visible = filterTargets(orderTargets(targets, config.lastUsedId), store.get().query);
    const withPath = hasPath();
    const tools = withPath ? [{ key: 'edit-path', kind: 'editPath', title: '更改远端路径', subtitle: '' }] : [];
    const downloading = { title: `下载 ${trimmedPath()}` };
    const stepState = { ...step(), placeholder: PICK_PLACEHOLDER };
    if (!targets.length) {
      show([setupRow('回车打开配置，添加 SSH 服务器')], 'no-targets', { title: '还没有可用的 SSH 服务器' }, stepState);
      return;
    }
    if (!visible.length) {
      show(tools, 'pick', withPath ? downloading : { title: '没有匹配的服务器' }, stepState);
      return;
    }
    show([...visible.map(targetRow), ...tools], 'pick', withPath ? { ...downloading, subtitle: '选择服务器，回车开始' } : null, stepState);
  };

  const enterPick = () => {
    // 搜索框在这一步用来过滤服务器，从空开始。
    enterStep('');
    renderPick();
  };

  // 输入路径。可能还没选服务器（带着路径进来后点「更改远端路径」），这时回车是回到选服务器。
  const renderPath = () => {
    const path = trimmedPath();
    const problem = remotePathProblem(path);
    const saveTo = path && !problem ? `保存到 ${joinLocalPath(downloadDir(), services.uniqueName(remoteBaseName(path)))}` : '';
    const idleTitle = chosen ? '粘贴远端路径后回车下载' : '粘贴远端路径后回车继续';
    store.set({
      phase: 'path',
      query: '',
      highlight: 0,
      placeholder: PATH_PLACEHOLDER,
      ...step(),
      status: chosen ? { title: `从「${chosen.name}」下载`, subtitle: targetDestination(chosen) } : null,
      rows: [
        { key: 'download', kind: 'download', title: path ? `下载 ${path}` : idleTitle, subtitle: problem || saveTo },
        { key: 'back', kind: 'back', title: '返回选择服务器', subtitle: '' }
      ]
    });
  };

  const enterPath = () => {
    // 搜索框带着已经确定的路径，全选之后用户粘贴或输入的新路径会直接替换它。
    enterStep(remotePath);
    renderPath();
  };

  // 空搜索框里粘贴的内容只显示成启动器的一个标签，宿主不会把它交给插件；
  // 标签显示的就是剪贴板里最近的一条内容，所以这里取最近的一条文本。
  async function readPastedPath() {
    try {
      const history = await host?.clipboard?.getHistory?.(1, 1);
      const latest = history?.items?.[0];
      if (latest?.type !== 'text' || typeof latest.content !== 'string') return '';
      return services.cleanPath(latest.content);
    } catch {
      return '';
    }
  }

  async function usePastedPath() {
    if (busy) return;
    busy = true;
    const pasted = await readPastedPath();
    busy = false;
    remotePath = pasted;
    if (!pasted) {
      store.set({
        rows: [
          { key: 'download', kind: 'download', title: '粘贴远端路径后回车下载', subtitle: NO_PASTED_PATH },
          { key: 'back', kind: 'back', title: '返回选择服务器', subtitle: '' }
        ]
      });
      return;
    }
    if (hasPath()) {
      if (chosen) await runDownload();
      else enterPick();
      return;
    }
    renderPath();
  }

  async function enter(action = {}) {
    store.set({ ...IDLE, phase: 'loading', placeholder: PICK_PLACEHOLDER, status: { title: '正在加载…' } });
    if (!services) {
      show([], 'error', { title: '需要在 ZTools 中运行', tone: 'danger' });
      return;
    }
    try {
      config = await configStore.load();
    } catch (error) {
      show([], 'error', { title: '读取配置失败', subtitle: errorText(error), tone: 'danger' });
      return;
    }
    targets = config.targets.filter((target) => target.type === 'ssh');
    chosen = null;
    // 在主搜索框里直接输入或粘贴路径进来的，路径已经确定。只看内容是不是合法路径，不看宿主给的类型标记：
    // 输入触发的是正则指令，粘贴触发的是宿主对粘贴文本的匹配，两者的标记不一样。
    const typed = services.cleanPath(typeof action.payload === 'string' ? action.payload : '');
    remotePath = remotePathProblem(typed) ? '' : typed;
    enterPick();
  }

  function search(text) {
    const value = String(text ?? '');
    const { phase } = store.get();
    if (phase === 'pick') {
      store.set({ query: value });
      renderPick();
    } else if (phase === 'path') {
      remotePath = services.cleanPath(value);
      renderPath();
    }
  }

  function move(delta) {
    const { phase, rows, highlight } = store.get();
    if (SELECTABLE_PHASES.has(phase) && rows.length) store.set({ highlight: moveHighlight(highlight, delta, rows.length) });
  }

  async function runDownload() {
    if (busy) return;
    const path = trimmedPath();
    const dir = downloadDir();
    if (!dir) {
      show([setupRow('回车打开配置，先选择一个下载目录')], 'failed', { title: '下载失败', subtitle: '无法确定下载目录', tone: 'danger' }, { placeholder: PATH_PLACEHOLDER });
      return;
    }
    busy = true;
    // 绝不覆盖已有文件：默认名字撞上已有文件时换一个后缀。
    let name = services.uniqueName(remoteBaseName(path));
    if (services.fileExists(joinLocalPath(dir, name))) name = services.uniqueName(name, { force: true });
    store.set({
      phase: 'downloading',
      rows: [],
      highlight: 0,
      status: { title: `正在从「${chosen.name}」下载…`, subtitle: path, tone: 'busy' }
    });
    // 这台服务器保存了密码就按密码登录，否则免密登录。
    const password = chosen.password;
    const args = buildDownloadArgs({ target: chosen.target, port: chosen.port, remotePath: path, localName: name, password });
    let result;
    try {
      result = await services.runScp(scpRequest({ args, cwd: dir, password }));
    } catch (error) {
      result = { ok: false, reason: 'spawn-failed', code: null, stderr: '', error };
    }
    busy = false;
    const localPath = joinLocalPath(dir, name);
    if (!result.ok) {
      store.set({
        phase: 'failed',
        highlight: 0,
        status: { title: '下载失败', subtitle: describeScpFailure({ ...result, direction: 'download', auth: authMode(password) }), tone: 'danger' },
        rows: [
          { key: 'retry', kind: 'retry', title: `回车重试：下载 ${path}`, subtitle: targetDestination(chosen) },
          { key: 'edit-path', kind: 'editPath', title: '更改远端路径', subtitle: '' },
          setupRow()
        ]
      });
      return;
    }
    try {
      await configStore.save({ ...config, lastUsedId: chosen.id });
    } catch {
      // 记不住「上次使用」不影响本次下载结果。
    }
    host?.copyText?.(localPath);
    await host?.showNotification?.('已下载，本机路径已复制');
    show(
      [{ key: 'reveal', kind: 'reveal', title: '已下载，回车打开所在文件夹', subtitle: localPath, path: localPath }],
      'done'
    );
  }

  async function select(index) {
    const row = store.get().rows[index];
    const { phase } = store.get();
    if (!row) return;
    if (row.kind === 'setup') openSetup();
    else if (row.kind === 'target') {
      chosen = row.target;
      if (hasPath()) await runDownload();
      else enterPath();
    } else if (row.kind === 'editPath') {
      enterPath();
    } else if (row.kind === 'back') {
      enterPick();
    } else if (row.kind === 'download' && phase === 'path') {
      if (hasPath()) {
        if (chosen) await runDownload();
        else enterPick();
      } else if (!trimmedPath()) {
        // 框里没有路径就按了回车：多半是粘贴变成了启动器里的标签，去剪贴板里取。
        // 输入了不合法的内容时只提示原因，不拿剪贴板内容覆盖它。
        await usePastedPath();
      }
    } else if (row.kind === 'retry') {
      await runDownload();
    } else if (row.kind === 'reveal') {
      host?.shellShowItemInFolder?.(row.path);
      store.set({ placeholder: '' });
      await collapse(host);
    }
  }

  function reset() {
    targets = [];
    chosen = null;
    remotePath = '';
    stepTick = 0;
    boxValue = '';
    busy = false;
    store.set({ ...IDLE });
  }

  return Object.freeze({
    enter,
    search,
    move,
    select,
    activate: () => select(store.get().highlight),
    reset,
    subscribe: store.subscribe,
    get state() {
      return store.get();
    }
  });
}
