import { build } from 'esbuild';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '../public/preload');
const distDir = join(__dirname, '../dist/preload');

console.log('📦 打包 preload 脚本...');

// 打包 api-server.js
await build({
  entryPoints: [join(publicDir, 'api-server.js')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: join(distDir, 'api-server.js'),
  format: 'cjs',
  minify: true,
  external: [
    // 不打包这些 Node.js 内置模块
    'child_process',
    'fs',
    'path',
    'http',
    'https',
    'net',
    'tls',
    'crypto',
    'stream',
    'util',
    'events',
    'buffer',
    'url',
    'querystring',
    'zlib',
    'os',
  ],
});

console.log('✅ api-server.js 打包完成');

console.log('📊 打包后的文件大小:');
const { statSync } = await import('fs');
const stats = statSync(join(distDir, 'api-server.js'));
const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
console.log(`   api-server.js: ${sizeMB} MB`);
