'use strict';

// 大古快传的 Node 侧能力。页面不能直接使用 Node，只能调用 createTransferServices() 暴露的几个窄接口。
// 这里不提供任意命令执行：scp 的参数、文件的最终名字都由页面侧的纯函数决定，这里只负责执行。

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const shared = require('../dagu-transfer-shared.cjs');

const SCP_TIMEOUT_MS = 120 * 1000;
// 粘贴进来的图片只接受这些格式，扩展名据此决定。
const DATA_URL = /^data:image\/(png|jpe?g|webp|gif|bmp);base64,([A-Za-z0-9+/=\s]+)$/;

function isFile(fsImpl, filePath) {
  if (typeof filePath !== 'string' || !filePath) return false;
  try {
    return fsImpl.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

// Windows 自带的 OpenSSH 客户端不一定在 PATH 里：先按常见安装位置定位，最后才退回 PATH 中的 scp。
function scpCandidates({ platform, env }) {
  if (platform !== 'win32') return ['scp'];
  const roots = [];
  if (env.WINDIR) roots.push(path.join(env.WINDIR, 'System32', 'OpenSSH'));
  if (env.ProgramFiles) roots.push(path.join(env.ProgramFiles, 'OpenSSH'));
  if (env['ProgramFiles(x86)']) roots.push(path.join(env['ProgramFiles(x86)'], 'OpenSSH'));
  return [...roots.map((root) => path.join(root, 'scp.exe')), 'scp'];
}

function resolveScpBinary({ platform = process.platform, env = process.env, exists = (candidate) => fs.existsSync(candidate) } = {}) {
  // 不带目录的候选交给 PATH 解析，启动失败时再如实报错。
  return scpCandidates({ platform, env }).find((candidate) => !path.isAbsolute(candidate) || exists(candidate)) || '';
}

// Windows 的 OpenSSH 客户端没有「命令行传密码」的参数，要用它内置的 askpass 机制：
// ssh 需要密码时不去读键盘，而是启动 SSH_ASKPASS 指定的程序，把它打印的第一行当作密码。
// 这里生成一个很小的辅助脚本，只负责把环境变量 DAGU_SSH_ASKPASS 的内容原样打印出来；脚本本身不含密码，
// 密码只出现在这次 scp 子进程的环境变量里，不落盘、不进命令行。
//   - 用 PowerShell 打印而不是 echo：密码里的 & | % ! ^ " 等字符不会被改写；
//   - 按 UTF-8 输出：含中文的密码也能原样送达；
//   - SSH_ASKPASS_REQUIRE=force 必须带：不带的话 Windows 11 上的 ssh 会一直等一个不会出现的输入；
//   - 同时必须去掉 BatchMode=yes，带着它 ssh 根本不询问密码。
// 以上都是对 OpenSSH_for_Windows_9.5p1 实测得到的。
const ASKPASS_ENV = 'DAGU_SSH_ASKPASS';
const ASKPASS_DIR = 'dagu-transfer-askpass';
const ASKPASS_NAME = /^askpass-\d+-[a-z0-9]+\.cmd$/;
const ASKPASS_MAX_AGE_MS = 60 * 60 * 1000;
const ASKPASS_SCRIPT = [
  '@echo off',
  'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Console]::Out.Write($env:DAGU_SSH_ASKPASS)"',
  ''
].join('\r\n');

// 写出一个 askpass 辅助脚本并返回路径。上次异常退出留下的脚本顺手清掉（里面没有密码）。
function createAskpassHelper({ fsImpl = fs, tmpdir = os.tmpdir(), now = Date.now, random = Math.random } = {}) {
  const dir = path.join(tmpdir, ASKPASS_DIR);
  fsImpl.mkdirSync(dir, { recursive: true });
  const cutoff = now() - ASKPASS_MAX_AGE_MS;
  for (const entry of fsImpl.readdirSync(dir)) {
    if (!ASKPASS_NAME.test(entry)) continue;
    const stale = path.join(dir, entry);
    try {
      if (fsImpl.statSync(stale).mtimeMs < cutoff) fsImpl.rmSync(stale, { force: true });
    } catch {
      // 清不掉旧脚本不影响这次登录。
    }
  }
  const helper = path.join(dir, `askpass-${now()}-${Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0')}.cmd`);
  fsImpl.writeFileSync(helper, ASKPASS_SCRIPT, 'utf8');
  return helper;
}

function removeAskpassHelper(helper, fsImpl) {
  try {
    fsImpl.rmSync(helper, { force: true });
  } catch {
    // 脚本里没有密码，删不掉也不泄密。
  }
}

// 超时后要结束整棵进程树：scp 会再启动 ssh（密码登录时还有 askpass），只结束 scp 的话，
// ssh 会残留下来并占着管道，close 事件迟迟不来。
function killProcessTree(child, platform = process.platform) {
  if (platform !== 'win32') {
    child.kill();
    return;
  }
  const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  killer.on('error', () => child.kill());
}

function hasPassword(password) {
  return typeof password === 'string' && password.length > 0;
}

// 以参数数组启动 scp，不经过任何 shell。cwd 不存在时先创建（下载目录属于这种情况）。
// 带 password 时按密码登录（目前只支持 Windows），否则免密登录，子进程直接继承本进程的环境。
function runScp(
  { args, cwd, password },
  {
    binary,
    spawnImpl = spawn,
    timeoutMs = SCP_TIMEOUT_MS,
    platform = process.platform,
    env = process.env,
    fsImpl = fs,
    tmpdir = os.tmpdir(),
    now = Date.now,
    random = Math.random,
    killTree = killProcessTree
  } = {}
) {
  return new Promise((resolve) => {
    const usePassword = hasPassword(password);
    if (!binary) {
      resolve({ ok: false, reason: 'scp-not-found', code: null, stderr: '' });
      return;
    }
    if (usePassword && platform !== 'win32') {
      resolve({ ok: false, reason: 'password-unsupported', code: null, stderr: '' });
      return;
    }

    let helper = '';
    let spawnOptions = { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] };
    if (usePassword) {
      try {
        helper = createAskpassHelper({ fsImpl, tmpdir, now, random });
      } catch (error) {
        resolve({ ok: false, reason: 'askpass-failed', code: null, stderr: '', error });
        return;
      }
      spawnOptions = {
        ...spawnOptions,
        env: { ...env, SSH_ASKPASS: helper, SSH_ASKPASS_REQUIRE: 'force', [ASKPASS_ENV]: password }
      };
    }

    let child;
    try {
      fsImpl.mkdirSync(cwd, { recursive: true });
      child = spawnImpl(binary, args, spawnOptions);
    } catch (error) {
      if (helper) removeAskpassHelper(helper, fsImpl);
      resolve({ ok: false, reason: 'spawn-failed', code: null, stderr: '', error });
      return;
    }
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let timer;
    let fallback;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(fallback);
      if (helper) removeAskpassHelper(helper, fsImpl);
      resolve(result);
    };
    const outcome = (code) => ({
      ok: !timedOut && code === 0,
      reason: timedOut ? 'timeout' : code === 0 ? '' : 'exit',
      code,
      stderr: stderr.trim().slice(-2000)
    });
    timer = setTimeout(() => {
      timedOut = true;
      killTree(child, platform);
    }, timeoutMs);
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.stdout?.resume();
    child.on('error', (error) => {
      finish({ ok: false, reason: error?.code === 'ENOENT' ? 'scp-not-found' : 'spawn-failed', code: null, stderr });
    });
    child.on('close', (code) => finish(outcome(code)));
    // 进程已经退出却还有别的进程握着管道时，close 会迟到；退出一小段时间后按已有结果收尾。
    child.on('exit', () => {
      fallback = setTimeout(() => finish(outcome(child.exitCode)), 1000);
    });
  });
}

// 把文件复制到目标目录。绝不覆盖已有文件：撞名时换一个后缀重试一次。
function copyFile({ sourcePath, targetDir, fileName }, { fsImpl = fs } = {}) {
  try {
    if (!isFile(fsImpl, sourcePath)) return { ok: false, reason: 'source-missing', path: '' };
    const safeName = shared.baseFileName(fileName);
    if (!safeName) return { ok: false, reason: 'copy-failed', path: '' };
    fsImpl.mkdirSync(targetDir, { recursive: true });
    let finalName = safeName;
    if (fsImpl.existsSync(path.join(targetDir, finalName))) {
      finalName = shared.uniqueFileName(safeName, { force: true });
    }
    const target = path.join(targetDir, finalName);
    if (fsImpl.existsSync(target)) return { ok: false, reason: 'exists', path: target };
    fsImpl.copyFileSync(sourcePath, target);
    return { ok: true, path: target, name: finalName };
  } catch (error) {
    return { ok: false, reason: 'copy-failed', path: '', error };
  }
}

// 把「进入插件时带的输入」变成一个待上传的本地文件。
//  - 大古截图跳转过来：token 指向交接目录里的文件
//  - 主搜索框里粘贴的本地文件路径文本（例如在资源管理器里「复制为路径」）：文件存在就直接用
//  - ZTools 图片输入：dataURL 写成交接文件
//  - ZTools 文件输入：直接使用用户选的文件
function prepareShareSource({ type, payload }, { fsImpl = fs, tmpdir = os.tmpdir() } = {}) {
  if (typeof payload === 'string') {
    const fileName = shared.decodeShareToken(payload);
    if (fileName) {
      const filePath = shared.shareFilePath(tmpdir, fileName);
      if (!isFile(fsImpl, filePath)) return { ok: false, reason: 'source-missing' };
      // 留下确认文件：截图侧据此得知这边确实接手了。
      shared.createShareWriter({ fs: fsImpl, tmpdir }).ack(fileName);
      return { ok: true, path: filePath, name: fileName, temporary: true };
    }
    const localFile = shared.unquotePath(payload);
    // 只认存在的普通文件：路径文本恰好是别的内容时不当成文件，交回各输入类型继续判断。
    if (path.isAbsolute(localFile) && isFile(fsImpl, localFile)) {
      return { ok: true, path: localFile, name: path.basename(localFile), temporary: false };
    }
  }
  if (type === 'regex' || type === 'over') return { ok: false, reason: 'no-input' };
  if (type === 'img') {
    const match = DATA_URL.exec(String(payload || ''));
    if (!match) return { ok: false, reason: 'source-invalid' };
    const ext = match[1].toLowerCase().replace('jpeg', 'jpg');
    const writer = shared.createShareWriter({ fs: fsImpl, tmpdir });
    const fileName = writer.write(match[2], { prefix: '图片', ext }).fileName;
    return { ok: true, path: shared.shareFilePath(tmpdir, fileName), name: fileName, temporary: true };
  }
  if (type === 'files') {
    const first = Array.isArray(payload) ? payload[0] : null;
    const filePath = typeof first === 'string' ? first : first?.path;
    if (typeof filePath !== 'string' || !filePath) return { ok: false, reason: 'no-input' };
    if (!isFile(fsImpl, filePath)) return { ok: false, reason: 'source-missing' };
    return { ok: true, path: filePath, name: path.basename(filePath), temporary: false };
  }
  return { ok: false, reason: 'no-input' };
}

// 只删除交接目录里、名字符合约定的文件，不碰其它任何路径。
function discardShareSource({ path: filePath }, { fsImpl = fs, tmpdir = os.tmpdir() } = {}) {
  try {
    if (typeof filePath !== 'string') return false;
    if (path.dirname(filePath) !== shared.shareDir(tmpdir)) return false;
    if (!shared.isShareFileName(path.basename(filePath))) return false;
    fsImpl.rmSync(filePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

function createTransferServices(options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const scope = { fsImpl: options.fs ?? fs, tmpdir: options.tmpdir ?? os.tmpdir() };
  const binary = () => options.scpBinary
    ?? resolveScpBinary({ platform, env, ...(options.exists ? { exists: options.exists } : {}) });

  return Object.freeze({
    // 已经符合唯一命名的文件名原样返回；force 为 true 时换一个新的后缀。
    uniqueName: (fileName, { force = false } = {}) => shared.uniqueFileName(fileName, { force }),
    // 去掉路径文本首尾的空白与成对引号（「复制为路径」会带引号）。
    cleanPath: (text) => shared.unquotePath(text),
    fileExists: (filePath) => isFile(scope.fsImpl, filePath),
    defaultDownloadDir: () => path.join(os.homedir(), 'Downloads'),
    scpBinary: () => binary(),
    copyFile: (request) => copyFile(request, scope),
    prepareShareSource: (action) => prepareShareSource(action, scope),
    discardShareSource: (request) => discardShareSource(request, scope),
    runScp: (request) => runScp(request, {
      binary: binary(),
      platform,
      env,
      fsImpl: scope.fsImpl,
      tmpdir: scope.tmpdir,
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.spawnImpl ? { spawnImpl: options.spawnImpl } : {})
    })
  });
}

module.exports = {
  ASKPASS_SCRIPT,
  createAskpassHelper,
  createTransferServices,
  copyFile,
  discardShareSource,
  prepareShareSource,
  resolveScpBinary,
  runScp,
  scpCandidates
};
