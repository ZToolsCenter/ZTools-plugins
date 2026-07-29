/**
 * CommonJS：命令模板解析（与 lib/quick-open/command.js 保持一致）
 */

const PLACEHOLDER = '{path}';

function buildCommandSearchPath(homeDir = '', currentPath = '') {
  const home = String(homeDir || '').replace(/\/$/, '');
  const extras = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    home ? `${home}/.local/bin` : '',
    '/Applications/Cursor.app/Contents/Resources/app/bin',
    '/Applications/Visual Studio Code.app/Contents/Resources/app/bin',
  ].filter(Boolean);
  const existing = String(currentPath || '')
    .split(':')
    .map((part) => part.trim())
    .filter(Boolean);
  return [...new Set([...extras, ...existing])].join(':');
}

function resolveExecutablePath(command, options = {}) {
  const cmd = String(command || '').trim();
  if (!cmd) return cmd;
  if (cmd.includes('/') || cmd.includes('\\')) return cmd;
  const existsSync = options.existsSync || (() => false);
  const dirs = String(options.pathEnv || '')
    .split(':')
    .map((part) => part.trim())
    .filter(Boolean);
  for (const dir of dirs) {
    const candidate = `${dir.replace(/\/$/, '')}/${cmd}`;
    if (existsSync(candidate)) return candidate;
  }
  return cmd;
}

function tokenizeCommandTemplate(template) {
  const text = String(template || '').trim();
  if (!text) return [];
  const tokens = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (quote) throw new Error('命令模板引号未闭合');
  if (current) tokens.push(current);
  return tokens;
}

function resolveCommandTemplate(template, pathValue) {
  const tokens = tokenizeCommandTemplate(template);
  if (!tokens.length) throw new Error('命令模板不能为空');
  if (!tokens.some((t) => t.includes(PLACEHOLDER))) {
    throw new Error('命令模板必须包含 {path}');
  }
  const path = String(pathValue ?? '');
  for (const token of tokens) {
    const withoutPlaceholder = token.split(PLACEHOLDER).join('');
    if (/[;&|`$<>]/.test(withoutPlaceholder)) {
      throw new Error('命令模板包含不允许的字符');
    }
  }
  const expanded = tokens.map((token) => token.split(PLACEHOLDER).join(path));
  const [command, ...args] = expanded;
  if (!command) throw new Error('无法解析可执行程序');
  return { command, args };
}

module.exports = {
  tokenizeCommandTemplate,
  resolveCommandTemplate,
  buildCommandSearchPath,
  resolveExecutablePath,
};
