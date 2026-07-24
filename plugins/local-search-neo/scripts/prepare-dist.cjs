const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

if (!fs.existsSync(distDir)) {
  console.log("dist 目录不存在，跳过 dist 清理");
  process.exit(0);
}

const addonPattern = /^addon\.[^.]+\.node$/;
const everythingDbPattern = /\.db(?:\.|$)/i;
let removedCount = 0;
let removedEverythingDbCount = 0;

for (const entry of fs.readdirSync(distDir)) {
  if (!addonPattern.test(entry)) continue;
  fs.rmSync(path.join(distDir, entry), { force: true });
  removedCount += 1;
}

const manifestPath = path.join(distDir, "addon-manifest.json");
if (fs.existsSync(manifestPath)) {
  fs.rmSync(manifestPath, { force: true });
  removedCount += 1;
}

const everythingDir = path.join(distDir, "everything");
if (fs.existsSync(everythingDir)) {
  for (const entry of fs.readdirSync(everythingDir)) {
    if (!everythingDbPattern.test(entry)) continue;
    fs.rmSync(path.join(everythingDir, entry), { force: true });
    removedEverythingDbCount += 1;
  }
}

const readmeSource = path.join(rootDir, "README.md");
const readmeTarget = path.join(distDir, "README.md");
if (fs.existsSync(readmeSource)) {
  fs.copyFileSync(readmeSource, readmeTarget);
}

console.log(`已清理 dist addon 临时产物 ${removedCount} 个，发布产物使用 dist/addon.node`);
console.log(`已清理 dist Everything 数据库运行时文件 ${removedEverythingDbCount} 个`);
console.log("已复制 README.md 到 dist");
