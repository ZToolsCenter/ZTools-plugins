const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const destDir = path.resolve(__dirname, '../public/preload');

// 1. 清理并重建 public/preload
try {
  fs.rmSync(destDir, { recursive: true, force: true });
} catch (e) {}
fs.mkdirSync(destDir, { recursive: true });

// 2. 编译 TypeScript
execSync('tsc -p tsconfig.preload.json', { stdio: 'inherit' });

// 3. 复制静态资源
const srcDir = path.resolve(__dirname, '../src/preload');
const assets = [
  { from: 'package.json', to: 'package.json' },
  { from: 'proxy/proxy-daemon.html', to: 'proxy/proxy-daemon.html' },
  { from: 'widgets/assets/widget-common.css', to: 'widgets/assets/widget-common.css' },
  { from: 'widgets/status/status.html', to: 'widgets/status/status.html' }
];
for (const asset of assets) {
  const from = path.join(srcDir, asset.from);
  const to = path.join(destDir, asset.to);
  try {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    console.log(`copied: ${asset.from}`);
  } catch (e) {
    console.warn(`skip: ${asset.from} (${e.message})`);
  }
}

// 复制整个目录（如 widgets/assets/images/agents/ 图标）
const dirAssets = ['widgets/assets/images/agents'];
for (const dir of dirAssets) {
  const fromDir = path.join(srcDir, dir);
  if (!fs.existsSync(fromDir)) {
    console.warn(`skip dir: ${dir} (not exists)`);
    continue;
  }
  const toDir = path.join(destDir, dir);
  fs.mkdirSync(toDir, { recursive: true });
  fs.readdirSync(fromDir).forEach(f => {
    fs.copyFileSync(path.join(fromDir, f), path.join(toDir, f));
  });
  console.log(`copied dir: ${dir}`);
}
