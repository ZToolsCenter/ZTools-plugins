/**
 * 打包插件为 .zpx（ZTools 官方格式: gzip(asar archive)）
 * 用法: node scripts/pack.js
 * 产物: 项目根目录 ztools-quick-pwd-<version>.zpx
 */
const { createGzip } = require("zlib");
const { createReadStream, createWriteStream, existsSync, readFileSync, mkdirSync, copyFileSync, rmSync, statSync } = require("fs");
const os = require("os");
const path = require("path");
const { pipeline } = require("stream/promises");

// 优先引用本地或同级项目的 @electron/asar
let asar;
try {
  asar = require("@electron/asar");
} catch {
  try {
    const { createRequire } = require("module");
    const req = createRequire(path.join(__dirname, "../../ztools-mise-manager/package.json"));
    asar = req("@electron/asar");
  } catch (err) {
    console.error("❌ 未找到 @electron/asar 模块，请先运行: npm i -D @electron/asar");
    process.exit(1);
  }
}

async function main() {
  const root = path.join(__dirname, "..");
  const pluginJsonPath = path.join(root, "plugin.json");

  if (!existsSync(pluginJsonPath)) {
    console.error("❌ 未找到 plugin.json");
    process.exit(1);
  }

  const meta = JSON.parse(readFileSync(pluginJsonPath, "utf-8"));
  const version = meta.version || "0.0.1";
  const name = meta.name || "ztools-quick-pwd";
  const outPath = path.join(root, `${name}-${version}.zpx`);
  const outZipPath = path.join(root, `${name}-${version}.zip`);

  // 创建干净的临时暂存目录
  const stageDir = path.join(os.tmpdir(), `${name}-stage-${Date.now()}`);
  mkdirSync(stageDir, { recursive: true });

  const filesToCopy = [
    "plugin.json",
    "preload.js",
    "index.html",
    "index.css",
    "index.js",
    "logo.png",
    "README.md",
    "CHANGELOG.md",
    "MANUAL.md",
    "libs/crypto.js",
    "libs/mouse-hook.js",
    "libs/store.js",
  ];

  for (const rel of filesToCopy) {
    const srcFile = path.join(root, rel);
    const dstFile = path.join(stageDir, rel);
    if (existsSync(srcFile)) {
      mkdirSync(path.dirname(dstFile), { recursive: true });
      copyFileSync(srcFile, dstFile);
    }
  }

  // 临时 asar 文件
  const tempAsar = path.join(os.tmpdir(), `pack-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.asar`);
  const prevNoAsar = process.noAsar;
  process.noAsar = true;

  try {
    console.log("[ZPX] 开始打包...");
    // 目录 → asar 归档
    await asar.createPackage(stageDir, tempAsar);
    // asar → gzip → .zpx
    await pipeline(createReadStream(tempAsar), createGzip(), createWriteStream(outPath));
    const size = statSync(outPath).size;
    console.log(`[ZPX] 打包完成: ${outPath} (${(size / 1024).toFixed(1)} KB)`);

    // 同时生成通用 .zip 包
    try {
      const { execSync } = require("child_process");
      if (process.platform === "win32") {
        execSync(`powershell.exe -NoProfile -Command "Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${outZipPath}' -Force"`);
      } else {
        // macOS / Linux 标准 zip 归档
        execSync(`cd "${stageDir}" && zip -r -q "${outZipPath}" .`);
      }
      const zipSize = statSync(outZipPath).size;
      console.log(`[ZIP] 打包完成: ${outZipPath} (${(zipSize / 1024).toFixed(1)} KB)`);
    } catch (zipErr) {
      console.warn("⚠️ 生成 .zip 失败 (不影响 .zpx):", zipErr.message);
    }
  } finally {
    try {
      rmSync(tempAsar, { force: true });
      rmSync(stageDir, { recursive: true, force: true });
    } catch {}
    process.noAsar = prevNoAsar;
  }
}

main().catch((e) => {
  console.error("❌ 打包失败:", e);
  process.exit(1);
});
