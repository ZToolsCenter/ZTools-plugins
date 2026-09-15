/**
 * 打包插件为 .zpx（ZTools 官方格式: gzip(asar archive)）
 * 用法: node scripts/pack.js
 * 产物: 项目根目录 ztools-mise-manager-<version>.zpx
 * 该脚本与 ZTools 源码 src/main/utils/zpxArchive.ts 的 packZpx 逻辑一致
 */
const asar = require("@electron/asar");
const { createGzip } = require("zlib");
const { createReadStream, createWriteStream } = require("fs");
const { rm } = require("fs/promises");
const os = require("os");
const path = require("path");
const { pipeline } = require("stream/promises");

async function main() {
  const root = path.join(__dirname, "..");
  const distDir = path.join(root, "dist");

  // 校验 dist 存在且包含 plugin.json
  const pluginJsonPath = path.join(distDir, "plugin.json");
  const fs = require("fs");
  if (!fs.existsSync(pluginJsonPath)) {
    console.error("❌ 未找到 dist/plugin.json，请先执行 npm run build");
    process.exit(1);
  }
  const version = JSON.parse(fs.readFileSync(pluginJsonPath, "utf-8")).version || "0.0.0";
  const outPath = path.join(root, `ztools-mise-manager-${version}.zpx`);

  // 临时 asar 文件
  const tempAsar = path.join(os.tmpdir(), `pack-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.asar`);
  const prevNoAsar = process.noAsar;
  process.noAsar = true;

  try {
    console.log("[ZPX] 打包目录:", distDir);
    // 目录 → asar 归档（文件在包内根目录）
    await asar.createPackage(distDir, tempAsar);
    // asar → gzip → .zpx
    await pipeline(createReadStream(tempAsar), createGzip(), createWriteStream(outPath));
    const size = fs.statSync(outPath).size;
    console.log("[ZPX] 打包完成:", outPath, `(${(size / 1024).toFixed(1)} KB)`);
  } finally {
    await rm(tempAsar, { force: true });
    process.noAsar = prevNoAsar;
  }
}

main().catch((e) => {
  console.error("❌ 打包失败:", e);
  process.exit(1);
});
