const assert = require('node:assert/strict');
const { createReadStream, createWriteStream } = require('node:fs');
const { readFile, rm } = require('node:fs/promises');
const path = require('node:path');
const { createBrotliDecompress } = require('node:zlib');
const { pipeline } = require('node:stream/promises');
const AdmZip = require('adm-zip');
const { root, output, release, files, config, zpxPath, zipPath } = require('./build.cjs');

async function main() {
  const asar = await import('@electron/asar');
  const tempAsar = path.join(release, `.verify-${process.pid}.asar`);
  try {
    await pipeline(createReadStream(zpxPath), createBrotliDecompress(), createWriteStream(tempAsar));
    const zpxFiles = asar.listPackage(tempAsar, { isPack: false })
      .map(file => file.replace(/^[/\\]+/, '').replace(/\\/g, '/'));
    const zip = new AdmZip(zipPath);
    const zipFiles = zip.getEntries().filter(entry => !entry.isDirectory).map(entry => entry.entryName);
    assert.deepEqual(zpxFiles.sort(), [...files].sort(), 'ZPX 文件清单不匹配');
    assert.deepEqual(zipFiles.sort(), [...files].sort(), 'ZIP 文件清单不匹配');
    const packedConfig = JSON.parse(asar.extractFile(tempAsar, 'plugin.json').toString('utf8'));
    assert.deepEqual(packedConfig, config, '安装包配置与源码不一致');
    for (const field of ['main', 'preload', 'logo']) {
      assert.ok(files.includes(packedConfig[field]), `缺少 ${field} 对应文件`);
    }
    assert.ok(packedConfig.features?.length, '插件缺少 features');
    for (const file of files) {
      const source = await readFile(path.join(root, file));
      assert.deepEqual(await readFile(path.join(output, file)), source, `构建产物已过期：${file}`);
      assert.deepEqual(asar.extractFile(tempAsar, file), source, `ZPX 文件内容不一致：${file}`);
      assert.deepEqual(zip.readFile(file), source, `ZIP 文件内容不一致：${file}`);
    }
    const html = asar.extractFile(tempAsar, config.main).toString('utf8');
    assert.ok(!/\b(?:src|href)="\/(?!\/)/.test(html), 'HTML 包含绝对资源路径');
    console.log(`校验通过：${config.name} ${config.version}，ZPX 和 ZIP 各 ${files.length} 个文件，与源码逐字节一致。`);
  } finally {
    asar.uncache(tempAsar);
    await rm(tempAsar, { force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
