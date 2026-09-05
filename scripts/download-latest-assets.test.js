import * as asar from '@electron/asar';
import assert from 'node:assert/strict';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createBrotliDecompress } from 'node:zlib';
import test from 'node:test';
import {
  addZpxDownloadUrls,
  addZpxDownloadUrlsToPluginsJson,
  buildAssetPlan,
  collectReferencedZipAssets,
  normalizePluginForServer,
  packDirectoryAsZpx,
  resolvePlannedAssetPath,
  runWithConcurrency,
  validateDistAssets,
} from './download-latest-assets.js';

test('runWithConcurrency limits active tasks and preserves result order', async () => {
  let activeTasks = 0;
  let maxActiveTasks = 0;

  const results = await runWithConcurrency([1, 2, 3, 4, 5], async value => {
    activeTasks += 1;
    maxActiveTasks = Math.max(maxActiveTasks, activeTasks);
    await new Promise(resolve => setTimeout(resolve, 5));
    activeTasks -= 1;
    return value * 2;
  }, 2);

  assert.equal(maxActiveTasks, 2);
  assert.deepEqual(results, [2, 4, 6, 8, 10]);
});

test('collectReferencedZipAssets groups entries by their ZIP asset', () => {
  const pluginsJson = [
    {
      name: 'demo',
      version: '1.0.0',
      downloadUrl: 'https://github.com/ZToolsCenter/ZTools-plugins/releases/download/v1/demo-1.0.0.zip',
    },
    {
      name: 'demo',
      version: '1.0.0',
      platform: ['win32'],
      downloadUrl: 'https://github.com/ZToolsCenter/ZTools-plugins/releases/download/v1/demo-1.0.0.zip',
    },
  ];

  const assets = collectReferencedZipAssets(pluginsJson);

  assert.equal(assets.size, 1);
  assert.equal(assets.get('demo-1.0.0.zip').length, 2);
});

test('buildAssetPlan reuses unchanged EdgeOne assets by source URL', () => {
  const sourceUrl = 'https://github.com/ZToolsCenter/ZTools-plugins/releases/download/v2026.09.04/demo-1.0.0.zip';
  const current = [{
    name: 'demo',
    version: '1.0.0',
    downloadUrl: sourceUrl,
    logo: 'data:image/png;base64,ZmFrZQ==',
  }];
  const previous = [{
    name: 'demo',
    version: '1.0.0',
    sourceDownloadUrl: sourceUrl,
    downloadUrl: 'https://ztools.zosen.link/demo-1.0.0.zip',
    zpxDownloadUrl: 'https://ztools.zosen.link/demo-1.0.0.zpx',
    logo: 'https://ztools.zosen.link/images/logo/demo-1.0.0.png',
  }];

  const plan = buildAssetPlan(current, previous);

  assert.equal(plan.changedPlugins.length, 0);
  assert.equal(plan.reusedPlugins.length, 1);
  assert.equal(plan.entries[0].downloadUrl, 'https://ztools.zosen.link/demo-1.0.0.zip');
  assert.equal(plan.entries[0].zpxDownloadUrl, 'https://ztools.zosen.link/demo-1.0.0.zpx');
  assert.equal(plan.entries[0].logo, current[0].logo);
  assert.equal(plan.entries[0].sourceDownloadUrl, sourceUrl);
});

test('buildAssetPlan rebuilds changed, new, and legacy entries', () => {
  const oldSource = 'https://github.com/ZToolsCenter/ZTools-plugins/releases/download/v1/demo-1.0.0.zip';
  const newSource = 'https://github.com/ZToolsCenter/ZTools-plugins/releases/download/v2/demo-1.0.1.zip';
  const plan = buildAssetPlan([
    { name: 'demo', version: '1.0.1', downloadUrl: newSource, logo: 'data:image/png;base64,ZmFrZQ==' },
    { name: 'new-plugin', version: '1.0.0', downloadUrl: 'https://github.com/ZToolsCenter/ZTools-plugins/releases/download/v2/new-plugin-1.0.0.zip' },
  ], [
    {
      name: 'demo',
      version: '1.0.0',
      sourceDownloadUrl: oldSource,
      downloadUrl: 'https://ztools.zosen.link/demo-1.0.0.zip',
      zpxDownloadUrl: 'https://ztools.zosen.link/demo-1.0.0.zpx',
      logo: 'https://ztools.zosen.link/images/logo/demo-1.0.0.png',
    },
    {
      name: 'legacy',
      version: '1.0.0',
      downloadUrl: 'https://ztools.zosen.link/legacy-1.0.0.zip',
      zpxDownloadUrl: 'https://ztools.zosen.link/legacy-1.0.0.zpx',
      logo: 'https://ztools.zosen.link/images/logo/legacy-1.0.0.png',
    },
  ]);

  assert.equal(plan.changedPlugins.length, 2);
  assert.equal(plan.reusedPlugins.length, 0);
  assert.deepEqual(plan.changedPlugins.map(item => item.zipFileName), ['demo-1.0.1.zip', 'new-plugin-1.0.0.zip']);
  assert.equal(plan.entries[0].downloadUrl, 'https://ztools.zosen.link/demo-1.0.1.zip');
  assert.equal(plan.entries[1].downloadUrl, 'https://ztools.zosen.link/new-plugin-1.0.0.zip');
});

test('buildAssetPlan treats a legacy entry without sourceDownloadUrl as changed', () => {
  const sourceUrl = 'https://github.com/ZToolsCenter/ZTools-plugins/releases/download/v1/demo-1.0.0.zip';
  const plan = buildAssetPlan(
    [{ name: 'demo', version: '1.0.0', downloadUrl: sourceUrl }],
    [{
      name: 'demo',
      version: '1.0.0',
      downloadUrl: 'https://ztools.zosen.link/demo-1.0.0.zip',
      zpxDownloadUrl: 'https://ztools.zosen.link/demo-1.0.0.zpx',
      logo: 'https://ztools.zosen.link/images/logo/demo-1.0.0.png',
    }],
  );

  assert.equal(plan.changedPlugins.length, 1);
  assert.equal(plan.reusedPlugins.length, 0);
});

test('buildAssetPlan rejects non-base64 logos for ZIP-only builds', () => {
  assert.throws(
    () => buildAssetPlan([{
      name: 'demo',
      version: '1.0.0',
      downloadUrl: 'https://github.com/ZToolsCenter/ZTools-plugins/releases/download/v1/demo-1.0.0.zip',
      logo: 'https://example.test/demo.png',
    }], null),
    /logo 不是 Base64 图片/,
  );
});

test('validateDistAssets checks the complete ZIP, ZPX, and logo output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ztools-dist-assets-test-'));
  try {
    await mkdir(join(root, 'images', 'logo'), { recursive: true });
    await writeFile(join(root, 'demo-1.0.0.zip'), 'zip');
    await writeFile(join(root, 'demo-1.0.0.zpx'), 'zpx');
    await writeFile(join(root, 'images', 'logo', 'demo-1.0.0.png'), 'png');

    validateDistAssets([{
      name: 'demo',
      downloadUrl: 'https://ztools.zosen.link/demo-1.0.0.zip',
      zpxDownloadUrl: 'https://ztools.zosen.link/demo-1.0.0.zpx',
      logo: 'https://ztools.zosen.link/images/logo/demo-1.0.0.png',
    }], root);

    await rm(join(root, 'demo-1.0.0.zpx'));
    assert.throws(
      () => validateDistAssets([{
        name: 'demo',
        downloadUrl: 'https://ztools.zosen.link/demo-1.0.0.zip',
        zpxDownloadUrl: 'https://ztools.zosen.link/demo-1.0.0.zpx',
      }], root),
      /缺少插件 ZPX/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('resolvePlannedAssetPath keeps GitHub Release prefixes out of dist', () => {
  const githubUrl = 'https://github.com/ZToolsCenter/ZTools-plugins/releases/download/v1/demo-1.0.0.zip';
  const edgeLogoUrl = 'https://ztools.zosen.link/images/logo/demo-1.0.0.png';

  assert.equal(resolvePlannedAssetPath(githubUrl, 'demo-1.0.0.zip', false), 'demo-1.0.0.zip');
  assert.equal(resolvePlannedAssetPath(edgeLogoUrl, 'demo-1.0.0.png'), 'images/logo/demo-1.0.0.png');
});

test('addZpxDownloadUrls preserves ZIP fields and adds the ZPX URL', () => {
  const pluginsJson = [
    {
      name: 'demo',
      version: '1.0.0',
      downloadUrl: 'https://ztools.zosen.link/demo-1.0.0.zip',
      size: 100,
    },
  ];
  const convertedAssets = new Map([
    ['demo-1.0.0.zip', { fileName: 'demo-1.0.0.zpx', size: 80 }],
  ]);

  const updatedPluginsJson = addZpxDownloadUrls(pluginsJson, convertedAssets);

  assert.equal(pluginsJson[0].downloadUrl, 'https://ztools.zosen.link/demo-1.0.0.zip');
  assert.equal(pluginsJson[0].size, 100);
  assert.equal(pluginsJson[0].zpxDownloadUrl, undefined);
  assert.equal(updatedPluginsJson[0].downloadUrl, 'https://ztools.zosen.link/demo-1.0.0.zip');
  assert.equal(updatedPluginsJson[0].zpxDownloadUrl, 'https://ztools.zosen.link/demo-1.0.0.zpx');
  assert.equal(updatedPluginsJson[0].size, 100);
});

test('normalizePluginForServer includes both download URLs', () => {
  const plugin = normalizePluginForServer({
    name: 'demo',
    version: '1.0.0',
    downloadUrl: 'https://ztools.zosen.link/demo-1.0.0.zip',
    zpxDownloadUrl: 'https://ztools.zosen.link/demo-1.0.0.zpx',
  });

  assert.equal(plugin.downloadUrl, 'https://ztools.zosen.link/demo-1.0.0.zip');
  assert.equal(plugin.zpxDownloadUrl, 'https://ztools.zosen.link/demo-1.0.0.zpx');
});

test('addZpxDownloadUrlsToPluginsJson updates the original manifest and removes the legacy one', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ztools-zpx-manifest-test-'));
  const pluginsJsonPath = join(root, 'plugins.json');
  const legacyPluginsJsonPath = join(root, 'plugins-zpx.json');
  const convertedAssets = new Map([
    ['demo-1.0.0.zip', { fileName: 'demo-1.0.0.zpx', size: 80 }],
  ]);

  try {
    await writeFile(pluginsJsonPath, JSON.stringify([{
      name: 'demo',
      version: '1.0.0',
      downloadUrl: 'https://ztools.zosen.link/demo-1.0.0.zip',
      size: 100,
    }]));
    await writeFile(legacyPluginsJsonPath, '[]');

    await addZpxDownloadUrlsToPluginsJson(convertedAssets, root);

    const pluginsJson = JSON.parse(await readFile(pluginsJsonPath, 'utf-8'));
    assert.equal(pluginsJson[0].downloadUrl, 'https://ztools.zosen.link/demo-1.0.0.zip');
    assert.equal(pluginsJson[0].zpxDownloadUrl, 'https://ztools.zosen.link/demo-1.0.0.zpx');
    await assert.rejects(readFile(legacyPluginsJsonPath), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('packDirectoryAsZpx creates a Brotli-compressed readable ASAR', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ztools-zpx-test-'));
  const sourceDir = join(root, 'plugin');
  const outputPath = join(root, 'demo-1.0.0.zpx');
  const extractedAsarPath = join(root, 'result.asar');
  const pluginConfig = {
    name: 'demo',
    version: '1.0.0',
    main: 'index.html',
    unpack: '*.exe',
  };

  try {
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, 'plugin.json'), JSON.stringify(pluginConfig));
    await writeFile(join(sourceDir, 'index.html'), '<h1>demo</h1>');
    await writeFile(join(sourceDir, 'tool.exe'), 'binary');

    const result = await packDirectoryAsZpx(sourceDir, outputPath, [pluginConfig]);

    assert.equal(result.fileName, 'demo-1.0.0.zpx');
    assert.ok(result.size > 0);

    // 独立解压产物，确认不是只通过了打包函数内部的验证。
    await pipeline(
      createReadStream(outputPath),
      createBrotliDecompress(),
      createWriteStream(extractedAsarPath),
    );
    const packedConfig = JSON.parse(asar.extractFile(extractedAsarPath, 'plugin.json').toString('utf-8'));
    assert.deepEqual(packedConfig, pluginConfig);
    assert.equal(asar.extractFile(extractedAsarPath, 'tool.exe').toString('utf-8'), 'binary');
    assert.equal(await readFile(outputPath).then(buffer => buffer.length), result.size);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
