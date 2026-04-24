import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import AdmZip from 'adm-zip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.join(__dirname, '..');
const packDir = path.join(rootDir, 'pack');
const zipPath = path.join(rootDir, 'kuke-ai-agent.zip');

console.log('开始准备打包环境...');

// 1. Clean pack dir
if (fs.existsSync(packDir)) {
  fs.rmSync(packDir, { recursive: true, force: true });
}
fs.mkdirSync(packDir, { recursive: true });

// 2. Copy necessary files from public directory
const publicDir = path.join(rootDir, 'public');
const filesToCopy = ['plugin.json', 'preload.js', 'logo.png'];
for (const file of filesToCopy) {
  const src = path.join(publicDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(packDir, file));
    console.log(`复制文件: ${file}`);
  } else {
    console.warn(`警告: 找不到文件 ${file}`);
  }
}

// 3. Copy dist contents directly to packDir root (no dist/ subfolder)
const copyRecursiveSync = (src, dest) => {
  if (!fs.existsSync(src)) return;
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach(childItemName => {
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
};

const distDir = path.join(rootDir, 'dist');
if (fs.existsSync(distDir)) {
  copyRecursiveSync(distDir, packDir);
  console.log('复制目录: dist 内容到根目录');
} else {
  console.error('错误: 找不到 dist 目录，请先执行 npm run build');
  process.exit(1);
}

// 4. Create package.json for production dependencies
const originalPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
const prodPkg = {
  name: originalPkg.name,
  version: originalPkg.version,
  type: "commonjs",
  dependencies: {
    openai: originalPkg.dependencies.openai,
    "@tavily/core": originalPkg.dependencies["@tavily/core"],
    "@ai-sdk/anthropic": originalPkg.dependencies["@ai-sdk/anthropic"],
    zod: originalPkg.dependencies.zod,
    "adm-zip": originalPkg.dependencies["adm-zip"],
  }
};
fs.writeFileSync(path.join(packDir, 'package.json'), JSON.stringify(prodPkg, null, 2));
console.log('生成生产环境 package.json');

// 5. Install production dependencies
console.log('安装生产依赖...');
execSync('npm install', { cwd: packDir, stdio: 'inherit' });

// 6. Create zip archive (cross-platform)
console.log('正在创建 zip 包...');
const zip = AdmZip();
zip.addLocalFolder(packDir);
zip.writeZip(zipPath);
console.log(`打包完成: ${zipPath}`);
