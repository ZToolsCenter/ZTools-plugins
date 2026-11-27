// 上传/下载目标（本地目录或 SSH 服务器）的归一化、校验与展示文案。

import { remotePathProblem } from './scp-args.js';

export const TARGET_TYPES = Object.freeze(['local', 'ssh']);

// user@host，或 ~/.ssh/config 里的别名（不含 @）。
const SSH_TARGET = /^[A-Za-z0-9][A-Za-z0-9._-]*(@[A-Za-z0-9][A-Za-z0-9._-]*)?$/;
const ABSOLUTE_LOCAL_PATH = /^([A-Za-z]:[\\/]|\\\\|\/(?!\/))/;
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

const text = (value) => String(value ?? '').trim();

export function createTargetId(random = Math.random) {
  return `t-${Array.from({ length: 10 }, () => ID_ALPHABET[Math.floor(random() * 36)]).join('')}`;
}

export function normalizeTarget(raw = {}) {
  const type = TARGET_TYPES.includes(raw.type) ? raw.type : 'local';
  return {
    id: text(raw.id) || createTargetId(),
    name: text(raw.name),
    type,
    dir: type === 'local' ? text(raw.dir) : '',
    target: type === 'ssh' ? text(raw.target) : '',
    port: type === 'ssh' ? text(raw.port) : '',
    remoteDir: type === 'ssh' ? text(raw.remoteDir) : ''
  };
}

// 返回「字段名 → 错误文案」，为空对象表示合法。others 用来检查名称是否与其它目标重复。
export function validateTarget(target, others = []) {
  const errors = {};
  if (!target.name) {
    errors.name = '请填写名称';
  } else if (others.some((other) => other.id !== target.id && other.name.toLowerCase() === target.name.toLowerCase())) {
    errors.name = '名称已被其它目标使用';
  }
  if (target.type === 'local') {
    if (!target.dir) errors.dir = '请选择本地目录';
    else if (!ABSOLUTE_LOCAL_PATH.test(target.dir)) errors.dir = '必须是绝对路径';
    return errors;
  }
  if (!target.target) errors.target = '请填写 user@host 或 ~/.ssh/config 里的别名';
  else if (!SSH_TARGET.test(target.target)) errors.target = '只能填 user@host 或 ~/.ssh/config 中的别名';
  if (target.port && !(/^\d{1,5}$/.test(target.port) && Number(target.port) >= 1 && Number(target.port) <= 65535)) {
    errors.port = '端口须是 1 到 65535 的整数';
  }
  const problem = remotePathProblem(target.remoteDir);
  if (problem) errors.remoteDir = problem;
  return errors;
}

// 读出来的配置只保留合法目标，避免一条坏数据让整个列表不可用。密码不在这里：它单独存放，见 pickPasswords。
export function normalizeConfig(raw = {}) {
  const targets = [];
  for (const item of Array.isArray(raw?.targets) ? raw.targets : []) {
    const target = normalizeTarget(item);
    if (!Object.keys(validateTarget(target, targets)).length) targets.push(target);
  }
  const lastUsedId = text(raw?.lastUsedId);
  return {
    targets,
    downloadDir: text(raw?.downloadDir),
    lastUsedId: targets.some((target) => target.id === lastUsedId) ? lastUsedId : '',
    syncSecrets: raw?.syncSecrets === true
  };
}

// 把各个 SSH 目标上的密码拆成「目标 id → 密码」的表；密码不进偏好文档。
export function pickPasswords(config) {
  const passwords = {};
  for (const target of Array.isArray(config?.targets) ? config.targets : []) {
    if (!target || target.type !== 'ssh') continue;
    const password = text(target.password);
    if (password) passwords[target.id] = password;
  }
  return passwords;
}

// 把密码表并回各个 SSH 目标；表里没有的目标不带 password 字段。
export function withPasswords(config, passwords = {}) {
  return {
    ...config,
    targets: config.targets.map((target) => {
      const password = target.type === 'ssh' ? text(passwords?.[target.id]) : '';
      return password ? { ...target, password } : target;
    })
  };
}

// 列表里展示的目标位置；用密码登录的目标带一个标记，但不显示密码。
export function targetDestination(target) {
  if (target.type === 'local') return target.dir;
  const port = target.port ? `（端口 ${target.port}）` : '';
  return `${target.target}:${target.remoteDir}${port}`;
}

export function targetAuthLabel(target) {
  if (target.type !== 'ssh') return '';
  return target.password ? '密码登录' : '免密登录';
}
