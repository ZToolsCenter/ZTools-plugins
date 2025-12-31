import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

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

const preloadFiles = ['package.json', 'services.js'];
preloadFiles.forEach(file => {
  const src = join(publicDir, 'preload', file);
  const dest = join(preloadDir, file);
  copyFileSync(src, dest);
  console.log(`✅ preload/${file}`);
});

console.log('🎉 ZTools 插件构建完成!');
console.log(`📁 输出目录: ${distDir}`);

