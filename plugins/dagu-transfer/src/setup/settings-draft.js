// 配置页的草稿：所有改动先留在草稿里，点「保存设置」才写入存储。这里都是纯函数，不碰存储和界面。

import { CONTROL_CHARS } from '../core/scp-args.js';
import { normalizeTarget, validateTarget } from '../core/targets.js';

export function createDraft(config) {
  return {
    targets: (config?.targets || []).map((target) => ({ ...target })),
    downloadDir: config?.downloadDir || '',
    syncSecrets: config?.syncSecrets === true
  };
}

// 新建目标的表单初值。username 是表单专用的输入位：存储里只存拼好的 user@host，见 composeTargetInput。
export function newTargetForm(type) {
  return { ...normalizeTarget({ type }), username: '', password: '' };
}

// 把存储里的 user@host 拆成表单用的「用户名 + 主机」；没有账号前缀时用户名为空。
// 尾随或开头的 @ 拆不出合法账号，原样交给主机框，由目标校验去报错。
export function splitTargetForForm(targetValue) {
  const value = String(targetValue ?? '').trim();
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return { username: '', host: value };
  return { username: value.slice(0, at), host: value.slice(at + 1) };
}

// 表单的「用户名 + 主机框」拼回最终目标串。用户名留空时主机框原样（可含 user@ 前缀或别名）；
// 填了则以它为准——主机框里已带的账号前缀被替换。
export function composeTargetInput(username, hostInput) {
  const host = String(hostInput ?? '').trim();
  const user = String(username ?? '').trim();
  if (!user) return host;
  const bareHost = host.includes('@') ? host.slice(host.lastIndexOf('@') + 1) : host;
  return `${user}@${bareHost}`;
}

// 只比较用户能改的内容；目标的先后顺序不同也算有改动。
const fingerprint = (draft) => JSON.stringify([draft.targets, draft.downloadDir, draft.syncSecrets]);

export function isDirty(draft, saved) {
  return fingerprint(draft) !== fingerprint(createDraft(saved));
}

// 把表单里的目标加进草稿（已有同一个 id 时原地替换）。返回 { draft, errors }，errors 为空对象表示成功。
export function upsertTarget(draft, form) {
  // 用户名可选，填了才校验：拼成 user@host 后要能通过目标校验，所以不能有空白、@、冒号或控制字符。
  const username = String(form.username ?? '').trim();
  const errors = {};
  if (username && /[\s@:]/.test(username)) errors.username = '用户名不能包含空格、@ 或冒号';
  else if (username && CONTROL_CHARS.test(username)) errors.username = '用户名不能包含换行或控制字符';
  if (errors.username) return { draft, errors };

  // 存储里只存拼好的 user@host：用户名框填了就以它为准，主机框里已带的账号前缀被替换。
  const composed = composeTargetInput(username, form.target);
  Object.assign(errors, validateTarget({ ...form, target: composed }, draft.targets.filter((item) => item.id !== form.id)));
  const password = form.type === 'ssh' ? String(form.password ?? '') : '';
  // askpass 辅助脚本按行输出密码，所以密码里不能有换行或其它控制字符。
  if (!errors.password && CONTROL_CHARS.test(password)) errors.password = '密码不能包含换行或控制字符';
  if (Object.keys(errors).length) return { draft, errors };

  const target = { ...normalizeTarget({ ...form, target: composed }), ...(password ? { password } : {}) };
  const index = draft.targets.findIndex((item) => item.id === target.id);
  const targets = index < 0 ? [...draft.targets, target] : draft.targets.map((item) => (item.id === target.id ? target : item));
  return { draft: { ...draft, targets }, errors: {} };
}

export function removeTarget(draft, id) {
  return { ...draft, targets: draft.targets.filter((item) => item.id !== id) };
}

// 上下移动目标；移出列表边界时原样返回。
export function moveTarget(draft, id, offset) {
  const from = draft.targets.findIndex((item) => item.id === id);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= draft.targets.length) return draft;
  const targets = [...draft.targets];
  [targets[from], targets[to]] = [targets[to], targets[from]];
  return { ...draft, targets };
}
