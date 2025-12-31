import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '../dist');
const publicDir = join(__dirname, '../public');

console.log('📦 复制 ZTools 插件配置文件...');

// 复制 plugin.json
const pluginJsonSrc = join(publicDir, 'plugin.json');
const pluginJsonDest = join(distDir, 'plugin.json');
copyFileSync(pluginJsonSrc, pluginJsonDest);
console.log('✅ plugin.json');

// 复制 logo.png
const logoSrc = join(publicDir, 'logo.png');
const logoDest = join(distDir, 'logo.png');
copyFileSync(logoSrc, logoDest);
console.log('✅ logo.png');

// 复制 preload 目录
const preloadDir = join(distDir, 'preload');
if (!existsSync(preloadDir)) {
  mkdirSync(preloadDir, { recursive: true });
}

const preloadFiles = ['package.json', 'services.js', 'api-server.js'];
preloadFiles.forEach(file => {
  const src = join(publicDir, 'preload', file);
  const dest = join(preloadDir, file);
  copyFileSync(src, dest);
  console.log(`✅ preload/${file}`);
});

// 安装 preload 依赖
console.log('📦 安装 preload 依赖...');
try {
  execSync('npm install --production --no-package-lock', {
    cwd: preloadDir,
    stdio: 'inherit'
  });
  console.log('✅ preload 依赖安装完成');
} catch (error) {
  console.error('❌ preload 依赖安装失败:', error.message);
  process.exit(1);
}

console.log('🎉 ZTools 插件构建完成!');
console.log(`📁 输出目录: ${distDir}`);

