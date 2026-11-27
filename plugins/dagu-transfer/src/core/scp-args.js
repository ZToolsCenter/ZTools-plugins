// 系统 scp 的参数拼装与错误翻译。scp 以参数数组启动，不经过本地 shell；-s 走 SFTP 协议，
// 远端路径原样传给服务端，同样不经过远端 shell，所以路径不做任何引号处理，只拒绝控制字符。

// 免密登录：不向用户询问任何东西，认证只走 ~/.ssh/config、SSH Agent 或已加载的私钥。
const KEY_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new'];
// 密码登录：允许 ssh 询问密码（由 askpass 辅助程序回答，见 transfer/node/transfer-services.cjs）。
// 只试密码、只试一次：错密码连试三次容易被服务器封禁；不去试公钥，免得把密码当成私钥口令送去。
const PASSWORD_OPTIONS = [
  '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'PubkeyAuthentication=no',
  '-o', 'PreferredAuthentications=password,keyboard-interactive',
  '-o', 'NumberOfPasswordPrompts=1'
];
export const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

// 有密码就按密码登录，否则照旧免密登录。
export function authMode(password) {
  return typeof password === 'string' && password.length > 0 ? 'password' : 'key';
}

function sshOptions(password) {
  return authMode(password) === 'password' ? PASSWORD_OPTIONS : KEY_OPTIONS;
}

// SFTP 协议不展开 ~，也不按登录目录补全相对路径，所以远端路径必须以 / 开头。
export function remotePathProblem(remotePath) {
  const value = String(remotePath ?? '').trim();
  if (!value) return '路径不能为空';
  if (CONTROL_CHARS.test(value)) return '路径不能包含换行或控制字符';
  if (!value.startsWith('/')) return '必须是绝对路径（以 / 开头）';
  return '';
}

// 端口留空时不传 -P，交给 ~/.ssh/config 或默认的 22 决定，避免覆盖别名里配置的端口。
function portOptions(port) {
  return port ? ['-P', String(port)] : [];
}

export function joinRemotePath(dir, name) {
  return `${String(dir).replace(/\/+$/, '')}/${name}`;
}

// localName 只传文件名，调用方把工作目录设为它所在目录，避开 Windows 盘符里的冒号被当成主机名。
export function buildUploadArgs({ target, port, localName, remoteDir, remoteName, password }) {
  return ['-s', ...sshOptions(password), ...portOptions(port), localName, `${target}:${joinRemotePath(remoteDir, remoteName)}`];
}

export function buildDownloadArgs({ target, port, remotePath, localName, password }) {
  return ['-s', ...sshOptions(password), ...portOptions(port), `${target}:${remotePath}`, localName];
}

// 交给 runScp 的请求：没有密码时不带 password 字段，免密登录的调用与以前完全一样。
export function scpRequest({ args, cwd, password }) {
  return authMode(password) === 'password' ? { args, cwd, password } : { args, cwd };
}

const lastLine = (stderr) => String(stderr || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) || '';

// 「Permission denied (方法, 方法)」里列的是服务器允许的认证方法。
function denialAllowsPassword(text) {
  const methods = /Permission denied \(([^)]*)\)/i.exec(text)?.[1] ?? '';
  return /password|keyboard-interactive/i.test(methods);
}

// 把 scp 的失败翻译成用户能看懂的原因。退出码 255 是连接或认证阶段失败，1 是传输阶段失败。
// auth 是 'password'（按保存的密码登录）或 'key'（免密登录），决定认证失败时怎么提示。
export function describeScpFailure({ reason = '', code = null, stderr = '', direction = 'upload', auth = 'key' }) {
  const text = String(stderr || '');
  if (reason === 'scp-not-found') return '未找到系统自带的 OpenSSH scp，无法传输';
  if (reason === 'timeout') return '传输超时';
  if (reason === 'spawn-failed') return '无法启动 scp';
  if (reason === 'askpass-failed') return '无法准备密码登录，请改用密钥免密登录';
  if (reason === 'password-unsupported') return '密码登录目前只支持 Windows，请改用密钥免密登录';
  if (/unknown option|invalid option|usage: scp|illegal option/i.test(text)) {
    return '系统自带的 OpenSSH 版本过旧，传输需要 9.0 及以上';
  }
  if (code === 255) {
    if (/Permission denied/i.test(text)) {
      if (auth === 'password') {
        return denialAllowsPassword(text)
          ? '密码登录失败：请检查账号和密码'
          : '服务器不允许密码登录（只接受密钥），请清空密码或改用密钥';
      }
      return '认证失败：请确认 SSH 密钥或 ~/.ssh/config 可用，或在配置里填写登录密码';
    }
    if (/Could not resolve hostname/i.test(text)) return '无法解析主机名';
    if (/Connection refused/i.test(text)) return '连接被拒绝，请检查地址和端口';
    if (/timed out/i.test(text)) return '连接超时';
    if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(text)) {
      return '主机密钥校验失败，请先用 ssh 确认该主机';
    }
    return lastLine(text) ? `连接失败：${lastLine(text)}` : '连接失败';
  }
  if (/No such file or directory/i.test(text)) {
    return direction === 'download' ? '远端文件不存在' : '远端目录不存在';
  }
  if (/Permission denied/i.test(text)) {
    return direction === 'download' ? '远端文件没有读取权限' : '远端目录没有写入权限';
  }
  if (/disk quota|No space left/i.test(text)) return '远端空间不足';
  return lastLine(text) ? `传输失败：${lastLine(text)}` : '传输失败';
}
