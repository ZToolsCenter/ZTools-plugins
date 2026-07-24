const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// 将 Neon 编译产物复制到 Vite public 目录，便于 dev/build 时作为静态资源使用。
const rootDir = path.resolve(__dirname, "..");
const source = path.join(rootDir, "addon", "index.node");
const target = path.join(rootDir, "public", "addon.node");
const manifest = path.join(rootDir, "public", "addon-manifest.json");

if (!fs.existsSync(source)) {
  throw new Error(`addon 编译产物不存在：${source}`);
}

fs.mkdirSync(path.dirname(target), { recursive: true });
const sourceHash = fileHash(source);
const versionedTarget = path.join(rootDir, "public", `addon.${sourceHash.slice(0, 12)}.node`);

if (!fs.existsSync(versionedTarget) || fileHash(versionedTarget) !== sourceHash) {
  fs.copyFileSync(source, versionedTarget);
  console.log(
    `已复制 ${path.relative(rootDir, source)} -> ${path.relative(rootDir, versionedTarget)}`,
  );
}

fs.writeFileSync(
  manifest,
  JSON.stringify({ addon: path.basename(versionedTarget), hash: sourceHash }, null, 2),
  "utf-8",
);

if (fs.existsSync(target) && fileHash(target) === sourceHash) {
  console.log(`已存在相同 addon，跳过复制 ${path.relative(rootDir, target)}`);
} else {
  try {
    fs.copyFileSync(source, target);
    console.log(`已复制 ${path.relative(rootDir, source)} -> ${path.relative(rootDir, target)}`);
  } catch (error) {
    if (error?.code !== "EBUSY") throw error;
    console.warn(
      `目标 addon 被占用，已保留兼容文件并使用 ${path.relative(rootDir, versionedTarget)}`,
    );
  }
}

function fileHash(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
