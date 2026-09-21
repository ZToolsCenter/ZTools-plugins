const { createReadStream, createWriteStream } = require('node:fs');
const { mkdir, rm } = require('node:fs/promises');
const path = require('node:path');
const { constants, createBrotliCompress } = require('node:zlib');
const { pipeline } = require('node:stream/promises');
const AdmZip = require('adm-zip');
const { output, release, zpxPath, zipPath, build } = require('./build.cjs');

async function main() {
  const asar = await import('@electron/asar');
  build();
  await mkdir(release, { recursive: true });
  const asarPath = path.join(release, `.package-${process.pid}.asar`);
  try {
    await asar.createPackage(output, asarPath);
    await pipeline(
      createReadStream(asarPath),
      createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }),
      createWriteStream(zpxPath)
    );
    const zip = new AdmZip();
    zip.addLocalFolder(output);
    zip.writeZip(zipPath);
    console.log(`已生成 ZTools 安装包：${zpxPath}`);
    console.log(`已生成 ZIP 文件包：${zipPath}`);
  } finally {
    await rm(asarPath, { force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
