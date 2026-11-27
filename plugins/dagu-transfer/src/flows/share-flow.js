// 「分享」列表的流程：解析待分享的文件 → 列出目标（上次使用的排第一）→ 回车或点击上传 → 成功后收起。
// 只依赖注入的 services（Node 侧能力）、host（ZTools 接口）与 configStore，不涉及界面。

import { authMode, buildUploadArgs, describeScpFailure, joinRemotePath, scpRequest } from '../core/scp-args.js';
import { splitLocalPath } from '../core/paths.js';
import { filterTargets, moveHighlight, orderTargets } from '../core/list-model.js';
import { createStore } from '../core/store.js';
import { targetDestination } from '../core/targets.js';
import { SELECTABLE_PHASES, collapse, errorText, setupRow, targetRow } from './list-rows.js';

const IDLE = Object.freeze({ phase: 'idle', rows: [], highlight: 0, status: null, query: '', placeholder: '' });

const LOCAL_PROBLEMS = {
  'source-missing': '待分享的文件已不可用，请重新分享',
  exists: '目标目录里已有同名文件',
  'copy-failed': '写入本地目录失败，请检查目录是否可写'
};

export function createShareFlow({ services, host, configStore, openSetup = () => {} }) {
  const store = createStore({ ...IDLE });
  let config = { targets: [], downloadDir: '', lastUsedId: '' };
  let source = null;
  let busy = false;

  const show = (rows, phase, status = null) => store.set({ rows, phase, status, highlight: 0 });

  const renderTargets = () => {
    const visible = filterTargets(orderTargets(config.targets, config.lastUsedId), store.get().query);
    if (!visible.length) {
      show([], 'targets', { title: '没有匹配的上传目标' });
      return;
    }
    show(visible.map(targetRow), 'targets');
  };

  // 交接文件只供一次上传使用：上传成功或放弃时删除，避免临时目录越积越多。
  const discardSource = () => {
    if (source?.temporary) services?.discardShareSource?.({ path: source.path });
    source = null;
  };

  async function enter(action = {}) {
    store.set({ ...IDLE, phase: 'loading', placeholder: '搜索上传目标', status: { title: '正在加载…' } });
    if (!services) {
      show([], 'error', { title: '需要在 ZTools 中运行', tone: 'danger' });
      return;
    }
    discardSource();
    try {
      config = await configStore.load();
    } catch (error) {
      show([], 'error', { title: '读取配置失败', subtitle: errorText(error), tone: 'danger' });
      return;
    }
    let prepared;
    try {
      prepared = services.prepareShareSource(action);
    } catch (error) {
      prepared = { ok: false, reason: 'source-missing' };
      console.warn('[transfer] 解析待分享文件失败:', error);
    }
    if (!prepared.ok) {
      if (prepared.reason === 'no-input') {
        show([setupRow()], 'no-input', {
          title: '没有可分享的文件',
          subtitle: '把图片或文件粘贴到 ZTools，再选择「分享图片」或「分享文件」'
        });
      } else {
        show([setupRow()], 'error', { title: '待分享的文件已不可用', subtitle: '请重新分享一次', tone: 'danger' });
      }
      return;
    }
    source = prepared;
    if (!config.targets.length) {
      show([setupRow('回车打开配置，添加本地目录或 SSH 服务器')], 'no-targets', { title: '还没有可用的上传目标' });
      return;
    }
    renderTargets();
  }

  function search(text) {
    store.set({ query: text });
    if (store.get().phase === 'targets') renderTargets();
  }

  function move(delta) {
    const { phase, rows, highlight } = store.get();
    if (SELECTABLE_PHASES.has(phase) && rows.length) store.set({ highlight: moveHighlight(highlight, delta, rows.length) });
  }

  function uploadLocal(target) {
    const fileName = services.uniqueName(source.name);
    const result = services.copyFile({ sourcePath: source.path, targetDir: target.dir, fileName });
    return { ok: result.ok, path: result.path || '', message: LOCAL_PROBLEMS[result.reason] || '' };
  }

  async function uploadSsh(target) {
    const local = splitLocalPath(source.path);
    const remoteName = services.uniqueName(source.name);
    // 目标上保存了密码就按密码登录，否则免密登录。
    const password = target.password;
    const args = buildUploadArgs({
      target: target.target,
      port: target.port,
      localName: local.name,
      remoteDir: target.remoteDir,
      remoteName,
      password
    });
    const result = await services.runScp(scpRequest({ args, cwd: local.dir, password }));
    return {
      ok: result.ok,
      path: joinRemotePath(target.remoteDir, remoteName),
      message: result.ok ? '' : describeScpFailure({ ...result, direction: 'upload', auth: authMode(password) })
    };
  }

  async function upload(target) {
    if (busy) return;
    busy = true;
    store.set({
      phase: 'uploading',
      rows: [],
      highlight: 0,
      status: { title: `正在上传到「${target.name}」…`, subtitle: targetDestination(target), tone: 'busy' }
    });
    let result;
    try {
      result = target.type === 'local' ? uploadLocal(target) : await uploadSsh(target);
    } catch (error) {
      result = { ok: false, message: errorText(error) };
    }
    busy = false;
    if (result.ok) {
      await finish(target, result.path);
      return;
    }
    store.set({
      phase: 'failed',
      highlight: 0,
      status: { title: '上传失败', subtitle: result.message, tone: 'danger' },
      rows: [
        { key: 'retry', kind: 'retry', target, title: `回车重试：上传到「${target.name}」`, subtitle: targetDestination(target) },
        setupRow()
      ]
    });
  }

  async function finish(target, path) {
    discardSource();
    try {
      await configStore.save({ ...config, lastUsedId: target.id });
    } catch {
      // 记不住「上次使用」不影响本次上传结果。
    }
    host?.copyText?.(path);
    await host?.showNotification?.(`已上传到「${target.name}」，路径已复制`);
    store.set({ placeholder: '' });
    await collapse(host);
  }

  async function select(index) {
    const row = store.get().rows[index];
    if (!row) return;
    if (row.kind === 'setup') openSetup();
    else if (row.kind === 'target' || row.kind === 'retry') await upload(row.target);
  }

  function reset() {
    discardSource();
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
