const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { spawnSync, execFile } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');

const DOWNLOAD_TIMEOUT_MS = 120000;
const MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024;
const DEFAULT_FILE_SERVER = 'https://z.zosen.link';

const TOOL_MANIFEST = {
  rg: {
    version: '14.1.1',
    repository: 'BurntSushi/ripgrep',
    tag: '14.1.1',
    binary: 'rg',
    systemNames: ['rg'],
    assets: {
      'darwin-arm64': ['ripgrep-14.1.1-aarch64-apple-darwin.tar.gz', '24ad76777745fbff131c8fbc466742b011f925bfa4fffa2ded6def23b5b937be'],
      'darwin-x64': ['ripgrep-14.1.1-x86_64-apple-darwin.tar.gz', 'fc87e78f7cb3fea12d69072e7ef3b21509754717b746368fd40d88963630e2b3'],
      'linux-arm64': ['ripgrep-14.1.1-aarch64-unknown-linux-gnu.tar.gz', 'c827481c4ff4ea10c9dc7a4022c8de5db34a5737cb74484d62eb94a95841ab2f'],
      'linux-x64': ['ripgrep-14.1.1-x86_64-unknown-linux-musl.tar.gz', '4cf9f2741e6c465ffdb7c26f38056a59e2a2544b51f7cc128ef28337eeae4d8e'],
      'win32-arm64': ['ripgrep-14.1.1-x86_64-pc-windows-msvc.zip', 'd0f534024c42afd6cb4d38907c25cd2b249b79bbe6cc1dbee8e3e37c2b6e25a1'],
      'win32-x64': ['ripgrep-14.1.1-x86_64-pc-windows-msvc.zip', 'd0f534024c42afd6cb4d38907c25cd2b249b79bbe6cc1dbee8e3e37c2b6e25a1'],
    },
  },
  fd: {
    version: '10.2.0',
    repository: 'sharkdp/fd',
    tag: 'v10.2.0',
    binary: 'fd',
    systemNames: ['fd', 'fdfind'],
    assets: {
      'darwin-arm64': ['fd-v10.2.0-aarch64-apple-darwin.tar.gz', 'ae6327ba8c9a487cd63edd8bddd97da0207887a66d61e067dfe80c1430c5ae36'],
      'darwin-x64': ['fd-v10.2.0-x86_64-apple-darwin.tar.gz', '991a648a58870230af9547c1ae33e72cb5c5199a622fe5e540e162d6dba82d48'],
      'linux-arm64': ['fd-v10.2.0-aarch64-unknown-linux-gnu.tar.gz', '6de8be7a3d8ca27954a6d1e22bc327af4cf6fc7622791e68b820197f915c422b'],
      'linux-x64': ['fd-v10.2.0-x86_64-unknown-linux-gnu.tar.gz', '5f9030bcb0e1d03818521ed2e3d74fdb046480a45a4418ccff4f070241b4ed25'],
      'win32-arm64': ['fd-v10.2.0-x86_64-pc-windows-msvc.zip', '92ac9e6b0a0c6ecdab638ffe210dc786403fff4c66373604cf70df27be45e4fe'],
      'win32-x64': ['fd-v10.2.0-x86_64-pc-windows-msvc.zip', '92ac9e6b0a0c6ecdab638ffe210dc786403fff4c66373604cf70df27be45e4fe'],
    },
  },
};

const pendingDownloads = new Map();

/**
 * 校验并规范化调用方提供的插件工具目录。
 * @param {Record<string, unknown>} options 工具安装或查找选项。
 * @returns {string} 规范化后的工具根目录。
 * @throws {Error} 工具目录为空或不是绝对路径时抛出。
 */
function requireToolRoot(options) {
  const rootDirectory = String(options?.rootDirectory || '').trim();
  if (!rootDirectory || !path.isAbsolute(rootDirectory)) throw new Error('ZVC 工具目录不可用');
  return path.resolve(rootDirectory);
}

/**
 * 判断命令是否能从当前宿主 PATH 正常启动。
 * @param {string} command 候选命令名称。
 * @param {NodeJS.ProcessEnv} env 子进程环境。
 * @returns {boolean} 命令是否可用。
 */
function commandExists(command, env) {
  const result = spawnSync(command, ['--version'], { env, stdio: 'ignore', windowsHide: true });
  return !result.error && result.status === 0;
}

/**
 * 解析当前系统和架构对应的工具资产键。
 * @returns {string} 形如 darwin-arm64 的资产键。
 * @throws {Error} 当前平台或架构不受支持时抛出。
 */
function resolvePlatformKey() {
  const platform = process.platform;
  const architecture = process.arch;
  if (!['darwin', 'linux', 'win32'].includes(platform) || !['arm64', 'x64'].includes(architecture)) {
    throw new Error(`当前平台暂不支持自动安装搜索工具：${platform}/${architecture}`);
  }
  return `${platform}-${architecture}`;
}

/**
 * 通过系统解压命令列出压缩包中的文件。
 * @param {string} archivePath 压缩包绝对路径。
 * @returns {Promise<string[]>} 压缩包条目列表。
 * @throws {Error} 压缩包无法读取时抛出。
 */
function listArchiveEntries(archivePath) {
  return new Promise((resolve, reject) => {
    execFile(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-tf', archivePath], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`无法检查搜索工具压缩包：${String(stderr || error.message).trim()}`));
        return;
      }
      resolve(String(stdout).split(/\r?\n/).filter(Boolean));
    });
  });
}

/**
 * 校验压缩包条目不会逃逸到目标目录之外。
 * @param {string[]} entries 压缩包条目列表。
 * @returns {void} 无返回值。
 * @throws {Error} 条目包含绝对路径或父目录跳转时抛出。
 */
function validateArchiveEntries(entries) {
  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, '/');
    if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.split('/').includes('..')) {
      throw new Error(`搜索工具压缩包包含不安全路径：${entry}`);
    }
  }
}

/**
 * 将已校验的搜索工具压缩包解压到临时目录。
 * @param {string} archivePath 压缩包绝对路径。
 * @param {string} destination 解压目标目录。
 * @returns {Promise<void>} 解压完成后的 Promise。
 * @throws {Error} 解压命令失败时抛出。
 */
async function extractArchive(archivePath, destination) {
  const entries = await listArchiveEntries(archivePath);
  validateArchiveEntries(entries);
  await new Promise((resolve, reject) => {
    execFile(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-xf', archivePath, '-C', destination], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(`搜索工具解压失败：${String(stderr || error.message).trim()}`));
        return;
      }
      resolve();
    });
  });
}

/**
 * 在解压目录中查找目标可执行文件。
 * @param {string} directory 当前搜索目录。
 * @param {string} binaryName 可执行文件名。
 * @returns {string|null} 匹配文件路径；不存在时返回空值。
 */
function findExtractedBinary(directory, binaryName) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === binaryName) return target;
    if (entry.isDirectory()) {
      const nested = findExtractedBinary(target, binaryName);
      if (nested) return nested;
    }
  }
  return null;
}

/**
 * 下载单个工具资产并在写入过程中计算 SHA-256。
 * @param {string} url 下载地址。
 * @param {string} destination 临时文件路径。
 * @param {(update: Record<string, unknown>) => void} onUpdate 下载进度回调。
 * @param {AbortSignal} signal 取消信号。
 * @param {{token?: string, retryAnonymous?: boolean, expectedBytes?: number}} options 下载鉴权与大小校验选项。
 * @param {number} redirectsRemaining 剩余重定向次数。
 * @returns {Promise<{sha256: string, bytes: number}>} 下载摘要。
 * @throws {Error} 请求、校验前下载或写入失败时抛出。
 */
function downloadAsset(url, destination, onUpdate, signal, options = {}, redirectsRemaining = 5) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const headers = { 'User-Agent': 'ZVC/0.1 search-tool-manager' };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    const request = client.get(url, { headers }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        if (redirectsRemaining <= 0) {
          reject(new Error('搜索工具下载重定向次数过多'));
          return;
        }
        const redirected = new URL(response.headers.location, url).toString();
        const redirectedOptions = new URL(redirected).origin === new URL(url).origin
          ? options
          : { ...options, token: '' };
        downloadAsset(redirected, destination, onUpdate, signal, redirectedOptions, redirectsRemaining - 1).then(resolve, reject);
        return;
      }
      if ([401, 403].includes(response.statusCode) && options.token && options.retryAnonymous !== false) {
        response.resume();
        const anonymousOptions = { ...options, token: '', retryAnonymous: false };
        downloadAsset(url, destination, onUpdate, signal, anonymousOptions, redirectsRemaining).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`搜索工具下载失败：HTTP ${response.statusCode}`));
        return;
      }
      const total = Number(response.headers['content-length']) || 0;
      if (total > MAX_DOWNLOAD_BYTES) {
        response.destroy();
        reject(new Error('搜索工具下载文件超过允许大小'));
        return;
      }
      if (options.expectedBytes > 0 && total > 0 && total !== options.expectedBytes) {
        response.destroy();
        reject(new Error('搜索工具下载大小与服务端元数据不一致'));
        return;
      }
      const output = fs.createWriteStream(destination, { flags: 'wx' });
      const hash = createHash('sha256');
      let bytes = 0;
      let lastReportedAt = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_DOWNLOAD_BYTES) {
          response.destroy(new Error('搜索工具下载文件超过允许大小'));
          return;
        }
        hash.update(chunk);
        if (Date.now() - lastReportedAt >= 250) {
          lastReportedAt = Date.now();
          onUpdate({ phase: 'download', bytes, total });
        }
      });
      response.pipe(output);
      output.on('finish', () => {
        output.close(() => {
          if (options.expectedBytes > 0 && bytes !== options.expectedBytes) {
            reject(new Error('搜索工具下载内容不完整'));
            return;
          }
          resolve({ sha256: hash.digest('hex'), bytes });
        });
      });
      output.on('error', reject);
      response.on('error', reject);
    });
    const timeout = setTimeout(() => request.destroy(new Error('搜索工具下载超时')), DOWNLOAD_TIMEOUT_MS);
    /**
     * 将外部取消信号转换为网络请求终止。
     * @returns {void} 无返回值。
     */
    const abort = () => request.destroy(new Error('搜索工具下载已取消'));
    signal?.addEventListener('abort', abort, { once: true });
    request.on('close', () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    });
    request.on('error', reject);
  });
}

/**
 * 请求文件服务并解析 JSON 响应。
 * @param {string} url 元数据接口地址。
 * @param {AbortSignal} signal 取消信号。
 * @param {number} redirectsRemaining 剩余重定向次数。
 * @returns {Promise<Record<string, unknown>>} 服务端元数据对象。
 * @throws {Error} 网络失败、响应异常或 JSON 无效时抛出。
 */
function requestJSON(url, signal, redirectsRemaining = 5) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(url, { headers: { Accept: 'application/json', 'User-Agent': 'ZVC/0.1 search-tool-manager' } }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        if (redirectsRemaining <= 0) {
          reject(new Error('文件元数据接口重定向次数过多'));
          return;
        }
        requestJSON(new URL(response.headers.location, url).toString(), signal, redirectsRemaining - 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`搜索工具元数据获取失败：HTTP ${response.statusCode}`));
        return;
      }
      const chunks = [];
      let bytes = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 256 * 1024) {
          response.destroy(new Error('文件元数据响应过大'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new Error('文件元数据响应不是有效 JSON'));
        }
      });
      response.on('error', reject);
    });
    const timeout = setTimeout(() => request.destroy(new Error('文件元数据请求超时')), DOWNLOAD_TIMEOUT_MS);
    /**
     * 将外部取消信号转换为元数据请求终止。
     * @returns {void} 无返回值。
     */
    const abort = () => request.destroy(new Error('搜索工具下载已取消'));
    signal?.addEventListener('abort', abort, { once: true });
    request.on('close', () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    });
    request.on('error', reject);
  });
}

/**
 * 从通用文件服务解析并校验固定清单中的搜索工具资产。
 * @param {string} serverBase 文件服务根地址。
 * @param {string} assetName 清单中的文件名。
 * @param {string} expectedSha256 客户端固定的 SHA-256。
 * @param {AbortSignal} signal 取消信号。
 * @returns {Promise<{downloadUrl: string, fileSize: number, sha256: string}>} 可信下载元数据。
 * @throws {Error} 文件名、大小、摘要或下载地址不可信时抛出。
 */
async function resolveManagedAsset(serverBase, assetName, expectedSha256, signal) {
  const normalizedBase = String(serverBase || '').replace(/\/$/, '');
  const resolveUrl = `${normalizedBase}/api/files/resolve?name=${encodeURIComponent(assetName)}`;
  const metadata = await requestJSON(resolveUrl, signal);
  if (metadata.fileName !== assetName) throw new Error('搜索工具元数据文件名不匹配');
  if (metadata.sha256 !== expectedSha256) throw new Error('搜索工具服务端 SHA-256 与客户端清单不一致');
  const fileSize = Number(metadata.fileSize);
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > MAX_DOWNLOAD_BYTES) {
    throw new Error('搜索工具元数据文件大小无效');
  }
  const downloadUrl = new URL(String(metadata.downloadUrl || ''), normalizedBase);
  if (downloadUrl.origin !== new URL(normalizedBase).origin) throw new Error('搜索工具下载地址来源不可信');
  return { downloadUrl: downloadUrl.toString(), fileSize, sha256: metadata.sha256 };
}

/**
 * 根据固定清单安装一个搜索工具二进制。
 * @param {'rg'|'fd'} toolName 工具名称。
 * @param {{rootDirectory: string, serverUrl?: string, getDownloadToken?: Function, onUpdate?: Function, signal?: AbortSignal}} options 安装选项。
 * @returns {Promise<string>} 已安装的可执行文件路径。
 * @throws {Error} 平台不支持、下载校验或解压失败时抛出。
 */
async function installTool(toolName, options = {}) {
  const config = TOOL_MANIFEST[toolName];
  const platformKey = resolvePlatformKey();
  const asset = config.assets[platformKey];
  if (!asset) throw new Error(`搜索工具 ${toolName} 不支持 ${platformKey}`);
  const [assetName, expectedSha256] = asset;
  const rootDirectory = requireToolRoot(options);
  const installDirectory = path.join(rootDirectory, platformKey, `${toolName}-${config.version}`);
  const binaryName = `${config.binary}${process.platform === 'win32' ? '.exe' : ''}`;
  const binaryPath = path.join(installDirectory, binaryName);
  fs.mkdirSync(installDirectory, { recursive: true });
  if (fs.existsSync(binaryPath)) return binaryPath;

  const serverBase = options.serverUrl || process.env.ZVC_FILE_SERVER_URL || DEFAULT_FILE_SERVER;
  const archivePath = path.join(installDirectory, `${assetName}.${randomUUID()}.part`);
  const extractDirectory = path.join(installDirectory, `.extract-${randomUUID()}`);
  try {
    options.onUpdate?.({ phase: 'prepare', tool: toolName, source: 'file-server' });
    const metadata = await resolveManagedAsset(serverBase, assetName, expectedSha256, options.signal);
    let token = '';
    try {
      token = String(await options.getDownloadToken?.() || '');
    } catch {
      // 用户未登录或旧版宿主不支持临时令牌时继续匿名下载。
      token = '';
    }
    const downloaded = await downloadAsset(metadata.downloadUrl, archivePath, options.onUpdate || (() => {}), options.signal, {
      token,
      retryAnonymous: true,
      expectedBytes: metadata.fileSize,
    });
    if (downloaded.sha256 !== expectedSha256) throw new Error(`搜索工具校验失败：${toolName} SHA-256 不匹配`);
    fs.mkdirSync(extractDirectory, { recursive: true });
    await extractArchive(archivePath, extractDirectory);
    const extractedBinary = findExtractedBinary(extractDirectory, binaryName);
    if (!extractedBinary) throw new Error(`压缩包中缺少 ${binaryName}`);
    const stagedPath = `${binaryPath}.${randomUUID()}.tmp`;
    fs.copyFileSync(extractedBinary, stagedPath);
    if (process.platform !== 'win32') fs.chmodSync(stagedPath, 0o755);
    fs.renameSync(stagedPath, binaryPath);
    options.onUpdate?.({ phase: 'ready', tool: toolName, path: binaryPath });
    return binaryPath;
  } finally {
    // 无论安装是否成功，都清理下载和解压临时资源。
    fs.rmSync(archivePath, { force: true });
    fs.rmSync(extractDirectory, { recursive: true, force: true });
  }
}

/**
 * 获取可用的 rg 或 fd，可在缺失时从镜像自动安装。
 * @param {'rg'|'fd'} toolName 工具名称。
 * @param {{rootDirectory: string, serverUrl?: string, getDownloadToken?: Function, onUpdate?: Function, signal?: AbortSignal, env?: NodeJS.ProcessEnv}} options 查找与安装选项。
 * @returns {Promise<string>} 系统命令名或缓存二进制绝对路径。
 * @throws {Error} 工具无法找到或安装时抛出。
 */
async function ensureSearchBinary(toolName, options = {}) {
  const config = TOOL_MANIFEST[toolName];
  if (!config) throw new Error(`未知搜索工具：${toolName}`);
  const platformKey = resolvePlatformKey();
  const rootDirectory = requireToolRoot(options);
  const binaryName = `${config.binary}${process.platform === 'win32' ? '.exe' : ''}`;
  const cachedPath = path.join(rootDirectory, platformKey, `${toolName}-${config.version}`, binaryName);
  if (fs.existsSync(cachedPath)) return cachedPath;
  for (const command of config.systemNames) {
    if (commandExists(command, options.env || process.env)) return command;
  }

  const pendingKey = `${toolName}:${platformKey}:${rootDirectory}`;
  if (!pendingDownloads.has(pendingKey)) {
    pendingDownloads.set(pendingKey, installTool(toolName, options).finally(() => pendingDownloads.delete(pendingKey)));
  }
  return pendingDownloads.get(pendingKey);
}

module.exports = {
  DEFAULT_FILE_SERVER,
  TOOL_MANIFEST,
  downloadAsset,
  ensureSearchBinary,
  installTool,
  requireToolRoot,
  resolveManagedAsset,
  resolvePlatformKey,
  validateArchiveEntries,
};
