#!/usr/bin/env node
import * as asar from '@electron/asar';
import extractZip from 'extract-zip';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  constants as zlibConstants,
  createBrotliCompress,
  createBrotliDecompress,
} from 'node:zlib';

const DIST_DIR = 'dist';
const PLUGINS_JSON_FILE_NAME = 'plugins.json';
const LEGACY_ZPX_PLUGINS_JSON_FILE_NAME = 'plugins-zpx.json';
const PUBLIC_ASSET_BASE_URL = 'https://ztools.zosen.link';
const ZTOOLS_SERVER_URL = process.env.ZTOOLS_SERVER_URL || 'https://z.zosen.link';
const ZTOOLS_SERVER_TOKEN = process.env.ZTOOLS_SERVER_TOKEN || '';
const BASE64_IMAGE_OUTPUT_DIR = join(DIST_DIR, 'images', 'logo');
const BASE64_IMAGE_PUBLIC_PATH = 'images/logo';
const DOWNLOAD_MAX_ATTEMPTS = 5;
const DOWNLOAD_RETRY_DELAY_MS = 2000;
const DEFAULT_DOWNLOAD_CONCURRENCY = 4;
const configuredDownloadConcurrency = Number.parseInt(process.env.DOWNLOAD_CONCURRENCY || '', 10);
const DOWNLOAD_CONCURRENCY = Number.isInteger(configuredDownloadConcurrency) && configuredDownloadConcurrency > 0
  ? configuredDownloadConcurrency
  : DEFAULT_DOWNLOAD_CONCURRENCY;
const GITHUB_RELEASE_ASSET_URL_PATTERN = /^https:\/\/github\.com\/ZToolsCenter\/ZTools-plugins\/releases\/download\/[^/]+\/([^/?#]+)([?#].*)?$/;
const BASE64_IMAGE_DATA_URL_PATTERN = /^data:(image\/[a-z0-9.+-]+(?:;[^,]*)*);base64,([\s\S]+)$/i;
const RELEASE_METADATA_FILES = ['plugins.json'];

function printUsage() {
  console.log(`
用法:
  npm run download:latest-assets
  node scripts/download-latest-assets.js

说明:
  获取当前 GitHub 仓库最新 release 的元数据，并按 plugins.json 增量整理 dist 目录。
  未变更插件只下载上一版 EdgeOne 的 ZIP；所有 ZIP 在本地生成 ZPX，logo 从 main manifest 的 base64 生成 PNG。
  会将 JSON 中的 base64 图片转换为图片文件放入 dist/images/logo，
  并替换为 EdgeOne 静态访问地址。
  ZIP 下载默认最多并发 4 个任务，可通过 DOWNLOAD_CONCURRENCY 调整。
  如果存在 ZTOOLS_SERVER_TOKEN，会在最后把 dist/plugins.json 同步到 ZTools 平台。
  仓库信息优先读取 GITHUB_REPOSITORY=owner/repo，否则从 git remote origin 解析。
`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getRepoInfo() {
  const repository = process.env.GITHUB_REPOSITORY || '';

  if (repository) {
    const [owner, repo] = repository.split('/');
    if (owner && repo) {
      return { owner, repo };
    }
  }

  try {
    const remote = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
    const match = remote.match(/github\.com[:/](.+?)\/(.+?)(\.git)?$/);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  } catch (error) {
    console.error(`无法获取 git remote 信息: ${error.message}`);
  }

  throw new Error('无法确定 GitHub 仓库信息，请设置 GITHUB_REPOSITORY=owner/repo 或配置 git remote origin');
}

async function removeFileIfExists(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  try {
    await unlink(filePath);
  } catch (error) {
    console.warn(`删除未完成文件失败: ${filePath} - ${error.message}`);
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ztools-plugins-assets-downloader',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API 请求失败: ${response.status} ${response.statusText} ${body}`);
  }

  return response.json();
}

async function downloadFile(url, destPath) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'ztools-plugins-assets-downloader',
    },
  });

  if (!response.ok) {
    throw new Error(`下载失败: ${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error('下载失败: 响应内容为空');
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(destPath));
}

async function downloadFileWithRetry(url, destPath, fileName) {
  let lastError;

  for (let attempt = 1; attempt <= DOWNLOAD_MAX_ATTEMPTS; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`  重试 ${attempt}/${DOWNLOAD_MAX_ATTEMPTS}: ${fileName}`);
      }

      await downloadFile(url, destPath);
      return;
    } catch (error) {
      lastError = error;
      await removeFileIfExists(destPath);

      if (attempt < DOWNLOAD_MAX_ATTEMPTS) {
        console.warn(`  第 ${attempt}/${DOWNLOAD_MAX_ATTEMPTS} 次下载失败: ${fileName} - ${error.message}，${DOWNLOAD_RETRY_DELAY_MS / 1000} 秒后重试...`);
        await sleep(DOWNLOAD_RETRY_DELAY_MS);
      }
    }
  }

  throw new Error(`已重试 ${DOWNLOAD_MAX_ATTEMPTS} 次仍失败: ${lastError.message}`);
}

/**
 * 获取插件条目实际使用的下载地址字段。
 * @param {Record<string, unknown>} plugin 插件市场条目
 * @returns {string | null} 下载地址字段名；未声明时返回 null
 */
function getDownloadUrlKey(plugin) {
  for (const key of ['downloadUrl', 'downloadURL', 'download_url']) {
    if (typeof plugin[key] === 'string' && plugin[key].trim()) {
      return key;
    }
  }

  return null;
}

/**
 * 从下载地址中提取 ZIP 文件名。
 * @param {string} downloadUrl 插件下载地址
 * @returns {string} ZIP 文件名
 */
function getZipFileName(downloadUrl) {
  let fileName;

  try {
    fileName = basename(decodeURIComponent(new URL(downloadUrl).pathname));
  } catch {
    throw new Error(`无效的插件下载地址: ${downloadUrl}`);
  }

  if (!fileName.toLowerCase().endsWith('.zip')) {
    throw new Error(`插件下载地址不是 ZIP: ${downloadUrl}`);
  }

  return fileName;
}

/**
 * 收集 plugins.json 引用的 ZIP 及对应插件条目。
 * @param {unknown} pluginsJson 插件市场清单
 * @returns {Map<string, Array<Record<string, unknown>>>} ZIP 文件名到插件条目的映射
 */
export function collectReferencedZipAssets(pluginsJson) {
  const referencedAssets = new Map();

  for (const plugin of extractPluginsList(pluginsJson)) {
    const downloadUrlKey = getDownloadUrlKey(plugin);
    if (!downloadUrlKey) {
      throw new Error(`插件 ${normalizeString(plugin.name) || '<unknown>'} 缺少下载地址`);
    }

    const fileName = getZipFileName(plugin[downloadUrlKey]);
    const references = referencedAssets.get(fileName) || [];
    references.push(plugin);
    referencedAssets.set(fileName, references);
  }

  return referencedAssets;
}

function normalizePluginName(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function getAssetPathFromUrl(url) {
  try {
    const pathname = new URL(url).pathname.replace(/^\/+/, '');
    if (!pathname || pathname.includes('..')) {
      return null;
    }
    return pathname;
  } catch {
    return null;
  }
}

function getPreviousAssetUrl(plugin, key) {
  return typeof plugin?.[key] === 'string' && plugin[key].trim()
    ? plugin[key].trim()
    : null;
}

function validateManifestLogo(plugin) {
  const logo = plugin?.logo;
  if (logo === undefined || logo === null || !String(logo).trim()) {
    return;
  }

  if (!BASE64_IMAGE_DATA_URL_PATTERN.test(String(logo))) {
    throw new Error(`插件 ${normalizeString(plugin.name) || '<unknown>'} 的 logo 不是 Base64 图片，无法执行 ZIP-only 资产构建`);
  }
}

/**
 * 根据 main manifest 和上一版 EdgeOne manifest 规划资产来源。
 * 缺少 sourceDownloadUrl 的旧 manifest 会进入迁移模式，确保不会误复用旧资产。
 */
export function buildAssetPlan(currentPluginsJson, previousPluginsJson) {
  const currentPlugins = extractPluginsList(currentPluginsJson);
  const previousPlugins = previousPluginsJson ? extractPluginsList(previousPluginsJson) : [];
  const previousByName = new Map(previousPlugins.map(plugin => [normalizePluginName(plugin.name), plugin]));
  const changedPlugins = [];
  const reusedPlugins = [];
  const entries = [];

  for (const plugin of currentPlugins) {
    validateManifestLogo(plugin);
    const downloadUrlKey = getDownloadUrlKey(plugin);
    if (!downloadUrlKey) {
      throw new Error(`插件 ${normalizeString(plugin.name) || '<unknown>'} 缺少下载地址`);
    }

    const sourceDownloadUrl = plugin[downloadUrlKey].trim();
    const zipFileName = getZipFileName(sourceDownloadUrl);
    const zpxFileName = zipFileName.replace(/\.zip$/i, '.zpx');
    const previous = previousByName.get(normalizePluginName(plugin.name));
    const previousSource = getPreviousAssetUrl(previous, 'sourceDownloadUrl');
    const previousZipUrl = getPreviousAssetUrl(previous, 'downloadUrl');
    let previousZipFileName = null;
    try {
      previousZipFileName = previousSource ? getZipFileName(previousSource) : null;
    } catch {
      previousZipFileName = null;
    }
    const sameSource = Boolean(
      previous
      && previousSource
      && previousSource === sourceDownloadUrl
      && normalizeString(previous.version) === normalizeString(plugin.version)
      && previousZipFileName === zipFileName,
    );

    const entry = {
      ...plugin,
      sourceDownloadUrl,
      downloadUrl: `${PUBLIC_ASSET_BASE_URL}/${zipFileName}`,
      zpxDownloadUrl: `${PUBLIC_ASSET_BASE_URL}/${zpxFileName}`,
    };

    if (sameSource && previousZipUrl) {
      reusedPlugins.push({ current: plugin, previous, entry, zipFileName, zpxFileName });
    } else {
      changedPlugins.push({ current: plugin, previous, entry, zipFileName, zpxFileName });
    }

    entries.push(entry);
  }

  return { entries, changedPlugins, reusedPlugins };
}

/**
 * 读取并校验插件目录根部的 plugin.json。
 * @param {string} sourceDir 插件目录
 * @returns {Promise<Record<string, unknown>>} 解析后的插件配置
 */
async function readPluginConfig(sourceDir) {
  const pluginJsonPath = join(sourceDir, 'plugin.json');
  if (!existsSync(pluginJsonPath)) {
    throw new Error('ZIP 根目录缺少 plugin.json');
  }

  const pluginConfig = JSON.parse(await readFile(pluginJsonPath, 'utf-8'));
  if (!pluginConfig || typeof pluginConfig !== 'object' || Array.isArray(pluginConfig)) {
    throw new Error('plugin.json 必须是对象');
  }

  return pluginConfig;
}

/**
 * 校验包内插件身份与市场条目一致。
 * @param {Record<string, unknown>} pluginConfig 包内 plugin.json
 * @param {Array<Record<string, unknown>>} references 引用该包的市场条目
 * @param {string} packageName 用于错误信息的包名
 * @returns {void}
 */
function validatePluginIdentity(pluginConfig, references, packageName) {
  const actualName = normalizeString(pluginConfig.name);
  const actualVersion = normalizeString(pluginConfig.version);

  for (const plugin of references) {
    const expectedName = normalizeString(plugin.name);
    const expectedVersion = normalizeString(plugin.version);

    if (expectedName && actualName !== expectedName) {
      throw new Error(`${packageName} 的插件名不一致: ${actualName} !== ${expectedName}`);
    }
    if (expectedVersion && actualVersion !== expectedVersion) {
      throw new Error(`${packageName} 的插件版本不一致: ${actualVersion} !== ${expectedVersion}`);
    }
  }
}

/**
 * 验证 ZPX 可以解压为 ASAR，并读取根部 plugin.json。
 * @param {string} zpxPath 待验证的 ZPX 路径
 * @param {string} workDir 验证临时目录
 * @param {Array<Record<string, unknown>>} references 引用该包的市场条目
 * @returns {Promise<Record<string, unknown>>} ZPX 内的插件配置
 */
async function validateZpx(zpxPath, workDir, references) {
  const validationAsarPath = join(workDir, 'validation.asar');

  // 实际执行 Brotli 解压，避免只生成了扩展名正确但内容损坏的文件。
  await pipeline(
    createReadStream(zpxPath),
    createBrotliDecompress(),
    createWriteStream(validationAsarPath),
  );

  asar.uncache(validationAsarPath);
  const files = asar.listPackage(validationAsarPath);
  if (!files.some(file => file.replace(/^\/+/, '') === 'plugin.json')) {
    throw new Error(`${basename(zpxPath)} 内缺少 plugin.json`);
  }

  const pluginConfig = JSON.parse(asar.extractFile(validationAsarPath, 'plugin.json').toString('utf-8'));
  validatePluginIdentity(pluginConfig, references, basename(zpxPath));
  return pluginConfig;
}

/**
 * 将插件目录打包为 Brotli 压缩的 ZPX。
 * @param {string} sourceDir 插件源目录
 * @param {string} outputPath ZPX 输出路径
 * @param {Array<Record<string, unknown>>} references 引用该包的市场条目
 * @returns {Promise<{fileName: string, size: number, pluginConfig: Record<string, unknown>}>} ZPX 产物信息
 */
export async function packDirectoryAsZpx(sourceDir, outputPath, references = []) {
  const resolvedOutputPath = resolve(outputPath);
  const workDir = await mkdtemp(join(tmpdir(), 'ztools-zpx-'));
  const temporaryAsarPath = join(workDir, 'plugin.asar');
  const temporaryZpxPath = join(
    dirname(resolvedOutputPath),
    `.${basename(resolvedOutputPath)}.${process.pid}-${Date.now()}.tmp`,
  );

  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  await removeFileIfExists(temporaryZpxPath);

  try {
    const pluginConfig = await readPluginConfig(sourceDir);
    validatePluginIdentity(pluginConfig, references, basename(outputPath));

    // ZPX 固定为“标准 ASAR + Brotli”，unpack 在客户端安装阶段处理。
    await asar.createPackage(sourceDir, temporaryAsarPath);
    await pipeline(
      createReadStream(temporaryAsarPath),
      createBrotliCompress({
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 },
      }),
      createWriteStream(temporaryZpxPath),
    );

    await validateZpx(temporaryZpxPath, workDir, references);

    // 只在完整验证后替换正式产物，避免部署不完整的 ZPX。
    await removeFileIfExists(resolvedOutputPath);
    await rename(temporaryZpxPath, resolvedOutputPath);
    const outputStats = await stat(resolvedOutputPath);
    return {
      fileName: basename(resolvedOutputPath),
      size: outputStats.size,
      pluginConfig,
    };
  } finally {
    await removeFileIfExists(temporaryZpxPath);
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * 将市场清单引用的 ZIP 逐个转换为 ZPX，原 ZIP 保持不变。
 * @param {unknown} pluginsJson 插件市场清单
 * @param {string} distDir Release 资产目录
 * @returns {Promise<Map<string, {fileName: string, size: number, pluginConfig: Record<string, unknown>}>>} ZIP 文件名到 ZPX 产物的映射
 */
export async function convertReferencedZipAssets(pluginsJson, distDir = DIST_DIR) {
  const referencedAssets = collectReferencedZipAssets(pluginsJson);
  const convertedAssets = new Map();

  console.log(`开始转换 ${referencedAssets.size} 个 ZIP 为 ZPX...`);

  for (const [zipFileName, references] of referencedAssets) {
    const zipPath = join(distDir, zipFileName);
    if (!existsSync(zipPath)) {
      throw new Error(`plugins.json 引用的 ZIP 不存在: ${zipFileName}`);
    }

    const extractedDir = await mkdtemp(join(tmpdir(), 'ztools-zip-'));
    const zpxFileName = zipFileName.replace(/\.zip$/i, '.zpx');
    const zpxPath = join(distDir, zpxFileName);

    try {
      console.log(`转换: ${zipFileName} → ${zpxFileName}`);
      await extractZip(zipPath, { dir: resolve(extractedDir) });
      const result = await packDirectoryAsZpx(extractedDir, zpxPath, references);
      convertedAssets.set(zipFileName, result);
      console.log(`✓ 转换完成: ${zpxFileName} (${(result.size / 1024).toFixed(2)} KB)`);
    } catch (error) {
      await removeFileIfExists(zpxPath);
      throw new Error(`${zipFileName} 转换失败: ${error.message}`);
    } finally {
      await rm(extractedDir, { recursive: true, force: true });
    }
  }

  return convertedAssets;
}

/**
 * 在插件清单中补充 ZPX 下载地址。
 * @param {unknown} pluginsJson 已更新为 CDN 地址的插件清单
 * @param {Map<string, {fileName: string, size: number}>} convertedAssets ZIP 到 ZPX 产物的映射
 * @returns {unknown} 同时包含 ZIP 和 ZPX 下载地址的新清单
 */
export function addZpxDownloadUrls(pluginsJson, convertedAssets) {
  const updatedPluginsJson = structuredClone(pluginsJson);

  for (const plugin of extractPluginsList(updatedPluginsJson)) {
    const downloadUrlKey = getDownloadUrlKey(plugin);
    if (!downloadUrlKey) {
      throw new Error(`插件 ${normalizeString(plugin.name) || '<unknown>'} 缺少下载地址`);
    }

    const zipFileName = getZipFileName(plugin[downloadUrlKey]);
    const convertedAsset = convertedAssets.get(zipFileName);
    if (!convertedAsset) {
      throw new Error(`插件 ${normalizeString(plugin.name) || '<unknown>'} 缺少 ZPX 产物`);
    }

    // 保留 ZIP 地址和大小语义，只增加新版客户端使用的 ZPX 地址。
    plugin.zpxDownloadUrl = `${PUBLIC_ASSET_BASE_URL}/${convertedAsset.fileName}`;
  }

  return updatedPluginsJson;
}

function rewriteReleaseAssetUrls(value) {
  if (typeof value === 'string') {
    const match = value.match(GITHUB_RELEASE_ASSET_URL_PATTERN);
    if (!match) {
      return {
        value,
        changedCount: 0,
      };
    }

    return {
      value: `${PUBLIC_ASSET_BASE_URL}/${match[1]}`,
      changedCount: 1,
    };
  }

  if (Array.isArray(value)) {
    let changedCount = 0;
    const nextValue = value.map((item) => {
      const result = rewriteReleaseAssetUrls(item);
      changedCount += result.changedCount;
      return result.value;
    });

    return {
      value: nextValue,
      changedCount,
    };
  }

  if (value && typeof value === 'object') {
    let changedCount = 0;
    const nextValue = {};

    for (const [key, item] of Object.entries(value)) {
      const result = rewriteReleaseAssetUrls(item);
      changedCount += result.changedCount;
      nextValue[key] = result.value;
    }

    return {
      value: nextValue,
      changedCount,
    };
  }

  return {
    value,
    changedCount: 0,
  };
}

function getImageExtension(contentType) {
  const mimeType = contentType.toLowerCase().split(';')[0];
  const subtype = mimeType.slice('image/'.length);

  if (subtype === 'jpeg' || subtype === 'pjpeg') return 'jpg';
  if (subtype === 'svg+xml') return 'svg';
  if (subtype === 'x-icon' || subtype === 'vnd.microsoft.icon') return 'ico';

  const normalizedSubtype = subtype
    .replace(/\+xml$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalizedSubtype || 'img';
}

function getPublicAssetUrl(relativePath) {
  return `${PUBLIC_ASSET_BASE_URL}/${relativePath}`;
}

function sanitizeFileNamePart(value) {
  return String(value)
    .trim()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getPluginNameFileNamePart(value) {
  return String(value).trim();
}

function getPluginImageContext(value, parentContext) {
  const nextContext = { ...parentContext };

  if (typeof value.name === 'string' && value.name.trim()) {
    nextContext.name = value.name;
  }

  if (value.version !== undefined && value.version !== null && String(value.version).trim()) {
    nextContext.version = String(value.version);
  }

  return nextContext;
}

function getImageFileName(imageBuffer, extension, imageContext) {
  const hash = createHash('sha256').update(imageBuffer).digest('hex');
  const pluginName = imageContext.name ? getPluginNameFileNamePart(imageContext.name) : '';
  const pluginVersion = imageContext.version ? sanitizeFileNamePart(imageContext.version) : '';

  if (pluginName && pluginVersion) {
    return {
      fileName: `${pluginName}-${pluginVersion}.${extension}`,
      hash,
    };
  }

  return {
    fileName: `image-${hash.slice(0, 16)}.${extension}`,
    hash,
  };
}

async function writeBase64ImageFile(dataUrl, convertedImages, imageContext) {
  const match = dataUrl.match(BASE64_IMAGE_DATA_URL_PATTERN);
  if (!match) {
    return null;
  }

  const [, contentType, base64Payload] = match;
  const imageBuffer = Buffer.from(base64Payload.replace(/\s/g, ''), 'base64');

  if (imageBuffer.length === 0) {
    throw new Error('发现空的 base64 图片内容');
  }

  const extension = getImageExtension(contentType);
  const { fileName, hash } = getImageFileName(imageBuffer, extension, imageContext);
  const relativePath = `${BASE64_IMAGE_PUBLIC_PATH}/${fileName}`;

  const convertedImage = convertedImages.get(fileName);
  if (convertedImage) {
    if (convertedImage.hash !== hash) {
      throw new Error(`图片文件名冲突: ${fileName}`);
    }

    return convertedImage.url;
  }

  if (!convertedImages.has(fileName)) {
    await mkdir(BASE64_IMAGE_OUTPUT_DIR, { recursive: true });
    await writeFile(join(BASE64_IMAGE_OUTPUT_DIR, fileName), imageBuffer);
    convertedImages.set(fileName, {
      hash,
      url: getPublicAssetUrl(relativePath),
    });
  }

  return convertedImages.get(fileName).url;
}

async function rewriteBase64ImageUrls(value, convertedImages, imageContext = {}) {
  if (typeof value === 'string') {
    const imageUrl = await writeBase64ImageFile(value, convertedImages, imageContext);
    return {
      value: imageUrl || value,
      changedCount: imageUrl ? 1 : 0,
    };
  }

  if (Array.isArray(value)) {
    let changedCount = 0;
    const nextValue = [];

    for (const item of value) {
      const result = await rewriteBase64ImageUrls(item, convertedImages, imageContext);
      changedCount += result.changedCount;
      nextValue.push(result.value);
    }

    return {
      value: nextValue,
      changedCount,
    };
  }

  if (value && typeof value === 'object') {
    let changedCount = 0;
    const nextValue = {};
    const nextContext = getPluginImageContext(value, imageContext);

    for (const [key, item] of Object.entries(value)) {
      const result = await rewriteBase64ImageUrls(item, convertedImages, nextContext);
      changedCount += result.changedCount;
      nextValue[key] = result.value;
    }

    return {
      value: nextValue,
      changedCount,
    };
  }

  return {
    value,
    changedCount: 0,
  };
}

/**
 * 读取 dist 中的插件市场清单。
 * @param {string} distDir Release 资产目录
 * @returns {Promise<unknown>} 解析后的 plugins.json
 */
async function readPluginsJson(distDir = DIST_DIR) {
  const pluginsJsonPath = join(distDir, PLUGINS_JSON_FILE_NAME);

  if (!existsSync(pluginsJsonPath)) {
    throw new Error(`未找到 ${pluginsJsonPath}`);
  }

  return JSON.parse(await readFile(pluginsJsonPath, 'utf-8'));
}

async function fetchPreviousEdgeManifest() {
  const manifestUrl = `${PUBLIC_ASSET_BASE_URL}/${PLUGINS_JSON_FILE_NAME}?cacheBust=${Date.now()}`;
  const response = await fetch(manifestUrl, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
      'User-Agent': 'ztools-plugins-assets-downloader',
    },
  });

  if (response.status === 404) {
    console.warn('EdgeOne 尚无历史 plugins.json，将执行首次全量迁移');
    return null;
  }

  if (!response.ok) {
    throw new Error(`读取 EdgeOne 历史 plugins.json 失败: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function downloadReleaseMetadata(latestRelease) {
  const assetsByName = new Map(latestRelease.assets.map(asset => [asset.name, asset]));
  const missing = [];

  for (const fileName of RELEASE_METADATA_FILES) {
    const asset = assetsByName.get(fileName);
    if (!asset) {
      missing.push(fileName);
      continue;
    }

    const destPath = join(DIST_DIR, fileName);
    console.log(`下载元数据: ${fileName}`);
    await downloadFileWithRetry(asset.browser_download_url, destPath, fileName);
  }

  if (missing.length > 0) {
    throw new Error(`最新 release 缺少必要元数据: ${missing.join(', ')}`);
  }
}

export function resolvePlannedAssetPath(url, fallbackFileName, preserveUrlPath = true) {
  return preserveUrlPath
    ? (getAssetPathFromUrl(url) || fallbackFileName)
    : fallbackFileName;
}

async function downloadPlannedAsset(url, fallbackFileName, preserveUrlPath = true) {
  const relativePath = resolvePlannedAssetPath(url, fallbackFileName, preserveUrlPath);
  const destination = join(DIST_DIR, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  await downloadFileWithRetry(url, destination, relativePath);
  return relativePath;
}

/**
 * 以固定并发数执行独立任务，并保持结果与输入顺序一致。
 * 下载任务使用流式写入，限制并发可以提高吞吐，同时避免触发网络限流。
 */
export async function runWithConcurrency(items, task, concurrency = DOWNLOAD_CONCURRENCY) {
  if (items.length === 0) {
    return [];
  }

  const requestedConcurrency = Number.isFinite(concurrency) ? Math.floor(concurrency) : 1;
  const limit = Math.max(1, Math.min(items.length, requestedConcurrency));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function consume() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= items.length) {
        return;
      }

      results[index] = await task(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => consume()));
  return results;
}

async function downloadIncrementalAssets(plan) {
  console.log(`开始并发下载 ZIP，最大并发数: ${DOWNLOAD_CONCURRENCY}`);

  const initialTasks = [
    ...plan.reusedPlugins.map(item => ({ type: 'reuse', item })),
    ...plan.changedPlugins.map(item => ({ type: 'changed', item })),
  ];
  const initialResults = await runWithConcurrency(initialTasks, async task => {
    if (task.type === 'changed') {
      console.log(`下载变更插件: ${task.item.zipFileName}`);
      // GitHub Release URL 包含 releases/download/<tag>/ 前缀，本地 ZIP 必须落在 dist 根目录。
      await downloadPlannedAsset(task.item.entry.sourceDownloadUrl, task.item.zipFileName, false);
      return { type: 'changed', item: task.item };
    }

    try {
      // 旧 EdgeOne 资产只下载 ZIP，ZPX 和 logo 在本地重新生成，减少网络请求。
      await downloadPlannedAsset(task.item.previous.downloadUrl, task.item.zipFileName, false);
      console.log(`✓ 下载复用 ZIP: ${task.item.zipFileName}`);
      return { type: 'reused', item: task.item };
    } catch (error) {
      console.warn(`下载复用 ZIP ${task.item.zipFileName} 失败，将从 main Release 下载: ${error.message}`);
      return { type: 'fallback', item: task.item };
    }
  });

  const reusedPlugins = initialResults
    .filter(result => result.type === 'reused')
    .map(result => result.item);
  const fallbackPlugins = initialResults
    .filter(result => result.type === 'fallback')
    .map(result => result.item);
  const changedPlugins = [
    ...plan.changedPlugins,
    ...fallbackPlugins,
  ];

  await runWithConcurrency(fallbackPlugins, async item => {
    console.log(`下载变更插件: ${item.zipFileName}`);
    // GitHub Release URL 包含 releases/download/<tag>/ 前缀，本地 ZIP 必须落在 dist 根目录。
    await downloadPlannedAsset(item.entry.sourceDownloadUrl, item.zipFileName, false);
  });

  return { changedPlugins, reusedPlugins };
}

export function validateDistAssets(pluginsJson, distDir = DIST_DIR) {
  for (const plugin of extractPluginsList(pluginsJson)) {
    const downloadUrlKey = getDownloadUrlKey(plugin);
    if (!downloadUrlKey) {
      throw new Error(`插件 ${normalizeString(plugin.name) || '<unknown>'} 缺少 ZIP 下载地址`);
    }

    const zipPath = join(distDir, getAssetPathFromUrl(plugin[downloadUrlKey]) || getZipFileName(plugin[downloadUrlKey]));
    const zpxPath = join(distDir, getAssetPathFromUrl(plugin.zpxDownloadUrl) || getZipFileName(plugin[downloadUrlKey]).replace(/\.zip$/i, '.zpx'));
    if (!existsSync(zipPath)) {
      throw new Error(`最终 dist 缺少插件 ZIP: ${basename(zipPath)}`);
    }
    if (!existsSync(zpxPath)) {
      throw new Error(`最终 dist 缺少插件 ZPX: ${basename(zpxPath)}`);
    }

    if (typeof plugin.logo === 'string' && plugin.logo.startsWith(PUBLIC_ASSET_BASE_URL)) {
      const logoPath = getAssetPathFromUrl(plugin.logo);
      if (!logoPath || !existsSync(join(distDir, logoPath))) {
        throw new Error(`最终 dist 缺少插件 logo: ${plugin.name || '<unknown>'}`);
      }
    }
  }
}

/**
 * 将原清单中的 GitHub Release 地址改为 EdgeOne ZIP 地址。
 * @returns {Promise<void>} 更新完成后结束的 Promise
 */
async function updatePluginsJsonDownloadUrls() {
  const pluginsJsonPath = join(DIST_DIR, PLUGINS_JSON_FILE_NAME);

  if (!existsSync(pluginsJsonPath)) {
    console.warn(`未找到 ${pluginsJsonPath}，跳过下载地址更新`);
    return;
  }

  const pluginsJson = JSON.parse(await readFile(pluginsJsonPath, 'utf-8'));
  const { value: updatedPluginsJson, changedCount } = rewriteReleaseAssetUrls(pluginsJson);

  await writeFile(
    pluginsJsonPath,
    `${JSON.stringify(updatedPluginsJson, null, 2)}\n`,
    'utf-8',
  );

  console.log(`✓ 已更新 plugins.json 中 ${changedCount} 个 GitHub Release 下载地址`);
}

/**
 * 将 ZPX 下载地址写入原插件清单，并删除历史双清单产物。
 * @param {Map<string, {fileName: string, size: number}>} convertedAssets ZIP 到 ZPX 产物的映射
 * @param {string} distDir Release 资产目录
 * @returns {Promise<void>} 原清单更新和历史文件清理完成后结束的 Promise
 */
export async function addZpxDownloadUrlsToPluginsJson(convertedAssets, distDir = DIST_DIR) {
  const pluginsJson = await readPluginsJson(distDir);
  const updatedPluginsJson = addZpxDownloadUrls(pluginsJson, convertedAssets);
  const pluginsJsonPath = join(distDir, PLUGINS_JSON_FILE_NAME);
  const legacyPluginsJsonPath = join(distDir, LEGACY_ZPX_PLUGINS_JSON_FILE_NAME);

  await writeFile(pluginsJsonPath, `${JSON.stringify(updatedPluginsJson, null, 2)}\n`, 'utf-8');
  // 增量构建可能残留旧文件，必须显式清理，确保只发布一份市场清单。
  await removeFileIfExists(legacyPluginsJsonPath);
  console.log(`✓ 已在 ${pluginsJsonPath} 中写入 ZPX 下载地址`);
}

async function getJsonFiles(dir) {
  if (!existsSync(dir)) {
    return [];
  }

  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...await getJsonFiles(entryPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(entryPath);
    }
  }

  return files;
}

async function updateBase64ImagesInJsonFiles() {
  const jsonFiles = await getJsonFiles(DIST_DIR);

  if (jsonFiles.length === 0) {
    console.warn(`未找到 ${DIST_DIR} 目录下的 JSON 文件，跳过 base64 图片转换`);
    return;
  }

  const convertedImages = new Map();
  let changedFileCount = 0;
  let changedImageCount = 0;

  for (const jsonFile of jsonFiles) {
    const json = JSON.parse(await readFile(jsonFile, 'utf-8'));
    const { value: updatedJson, changedCount } = await rewriteBase64ImageUrls(json, convertedImages);

    if (changedCount === 0) {
      continue;
    }

    await writeFile(
      jsonFile,
      `${JSON.stringify(updatedJson, null, 2)}\n`,
      'utf-8',
    );

    changedFileCount += 1;
    changedImageCount += changedCount;
  }

  console.log(`✓ 已转换 ${changedImageCount} 个 base64 图片，生成 ${convertedImages.size} 个 EdgeOne 静态图片文件，更新 ${changedFileCount} 个 JSON 文件`);
}

function normalizeString(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
}

function normalizeNullableString(value) {
  const normalized = normalizeString(value);
  return normalized || null;
}

function normalizeSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size < 0) {
    return 0;
  }

  return Math.trunc(size);
}

function extractPluginsList(pluginsJson) {
  if (Array.isArray(pluginsJson)) {
    return pluginsJson;
  }

  if (pluginsJson && Array.isArray(pluginsJson.plugins)) {
    return pluginsJson.plugins;
  }

  throw new Error('plugins.json 格式不正确，期望为插件数组或包含 plugins 数组的对象');
}

/**
 * 将市场插件条目规范为服务端第三方导入结构。
 * @param {Record<string, unknown>} plugin 插件市场条目
 * @returns {Record<string, unknown>} 可发送给服务端的插件数据
 */
export function normalizePluginForServer(plugin) {
  return {
    title: normalizeString(plugin.title),
    description: normalizeString(plugin.description),
    version: normalizeString(plugin.version),
    author: normalizeString(plugin.author),
    logo: normalizeString(plugin.logo),
    name: normalizeString(plugin.name),
    homepage: normalizeNullableString(plugin.homepage),
    platform: normalizePlatform(plugin.platform),
    downloadUrl: normalizeString(plugin.downloadUrl || plugin.downloadURL || plugin.download_url),
    zpxDownloadUrl: normalizeString(plugin.zpxDownloadUrl),
    size: normalizeSize(plugin.size),
  };
}

function normalizePlatform(platform) {
  if (!Array.isArray(platform)) {
    return [];
  }

  return [...new Set(platform.map(normalizeString).filter(Boolean))];
}

function getThirdPartyPluginsEndpoint() {
  return `${ZTOOLS_SERVER_URL.replace(/\/+$/, '')}/api/third-party/plugins`;
}

async function syncPluginsToZToolsServer() {
  if (!ZTOOLS_SERVER_TOKEN) {
    console.warn('未设置 ZTOOLS_SERVER_TOKEN，跳过同步 ZTools 平台插件数据');
    return;
  }

  const pluginsJsonPath = join(DIST_DIR, PLUGINS_JSON_FILE_NAME);
  if (!existsSync(pluginsJsonPath)) {
    console.warn(`未找到 ${pluginsJsonPath}，跳过同步 ZTools 平台插件数据`);
    return;
  }

  const pluginsJson = JSON.parse(await readFile(pluginsJsonPath, 'utf-8'));
  const plugins = extractPluginsList(pluginsJson).map(normalizePluginForServer);
  const endpoint = getThirdPartyPluginsEndpoint();

  console.log(`同步 ${plugins.length} 个插件到 ZTools 平台...`);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ZTOOLS_SERVER_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'ztools-plugins-assets-downloader',
    },
    body: JSON.stringify(plugins),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`同步 ZTools 平台插件数据失败: ${response.status} ${response.statusText} ${body}`);
  }

  const result = await response.json();
  console.log(`✓ 已同步 ZTools 平台插件数据: total=${result.total}, created=${result.created}, updated=${result.updated}`);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--help') || args.has('-h')) {
    printUsage();
    return;
  }

  const { owner, repo } = getRepoInfo();
  const latestReleaseUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;

  console.log(`仓库: ${owner}/${repo}`);
  console.log('获取最新 release...');

  const latestRelease = await fetchJson(latestReleaseUrl);

  console.log(`找到最新 release: ${latestRelease.tag_name}`);
  console.log(`资产数量: ${latestRelease.assets.length}`);

  // 先读取上一版清单，再清空 dist，避免删除插件或旧版本文件残留到静态部署。
  const previousPluginsJson = await fetchPreviousEdgeManifest();
  await rm(DIST_DIR, { recursive: true, force: true });
  await mkdir(DIST_DIR, { recursive: true });
  await downloadReleaseMetadata(latestRelease);

  const mainPluginsJson = await readPluginsJson();
  const plan = buildAssetPlan(mainPluginsJson, previousPluginsJson);
  console.log(`资产计划: ${plan.changedPlugins.length} 个变更/新增，${plan.reusedPlugins.length} 个复用`);

  const { changedPlugins, reusedPlugins } = await downloadIncrementalAssets(plan);
  console.log(`ZIP 下载完成: ${changedPlugins.length} 个 main Release ZIP，${reusedPlugins.length} 个 EdgeOne ZIP`);

  // 所有 ZIP 都在本地重建 ZPX，避免再下载旧 ZPX；logo 由 main manifest 中的 Base64 统一生成 PNG。
  const convertedAssets = await convertReferencedZipAssets(plan.entries);
  const edgePluginsJson = addZpxDownloadUrls(plan.entries, convertedAssets);

  const pluginsJsonPath = join(DIST_DIR, PLUGINS_JSON_FILE_NAME);
  await writeFile(pluginsJsonPath, `${JSON.stringify(edgePluginsJson, null, 2)}\n`, 'utf-8');
  await updateBase64ImagesInJsonFiles();
  const finalPluginsJson = await readPluginsJson();
  validateDistAssets(finalPluginsJson);
  await syncPluginsToZToolsServer();

  console.log(`\n✓ 增量资产已整理到 ${DIST_DIR}，共 ${extractPluginsList(finalPluginsJson).length} 个插件`);
}

const isMainModule = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMainModule) {
  main().catch(error => {
    console.error('执行失败:', error.message);
    process.exit(1);
  });
}
