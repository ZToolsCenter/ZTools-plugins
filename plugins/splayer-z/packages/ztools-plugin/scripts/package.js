import { createWriteStream, existsSync, readdirSync, statSync } from 'fs';
import { basename, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import archiver from 'archiver';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '../dist');
const outputDir = join(__dirname, '..');
const outputFile = join(outputDir, 'SPlayerZ.zip');

console.log('📦 开始打包 ZTools 插件...');

// 检查 dist 目录是否存在
if (!existsSync(distDir)) {
  console.error('❌ dist 目录不存在,请先运行 pnpm build');
  process.exit(1);
}

// 创建输出流
const output = createWriteStream(outputFile);
const archive = archiver('zip', {
  zlib: { level: 9 } // 最高压缩级别
});

// 监听事件
output.on('close', () => {
  const sizeInMB = (archive.pointer() / 1024 / 1024).toFixed(2);
  console.log(`✅ 打包完成!`);
  console.log(`📁 文件: ${basename(outputFile)}`);
  console.log(`📊 大小: ${sizeInMB} MB`);
  console.log(`🎉 可以分发了!`);
});

archive.on('error', (err) => {
  console.error('❌ 打包失败:', err);
  process.exit(1);
});

// 连接输出流
archive.pipe(output);

// 添加 dist 目录中的所有文件
console.log('📂 添加文件到压缩包...');
archive.directory(distDir, false);

// 完成打包
archive.finalize();

