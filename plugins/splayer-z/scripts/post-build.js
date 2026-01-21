import { execSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '../dist');
const publicDir = join(__dirname, '../public');
const electronPublic = join(__dirname, '../SPlayer/public');

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

// 复制 preload 脚本文件和 package.json
const preloadFiles = ['services.js', 'api-server.js', 'package.json'];
preloadFiles.forEach(file => {
  const src = join(publicDir, 'preload', file);
  const dest = join(preloadDir, file);
  copyFileSync(src, dest);
  console.log(`✅ preload/${file}`);
});

// 安装依赖
console.log('📦 安装 preload 依赖 (使用 npm)...');
try {
  execSync('npm install --production --no-package-lock --no-audit --no-fund', {
    cwd: preloadDir,
    stdio: 'inherit'
  });
  console.log('✅ preload 依赖安装完成');
} catch (error) {
  console.error('❌ preload 依赖安装失败:', error.message);
  process.exit(1);
}

// 清理 node_modules 中的不必要文件
console.log('🧹 清理 node_modules 中的不必要文件...');
const nodeModulesDir = join(preloadDir, 'node_modules');

// 递归删除指定类型的文件
function cleanNodeModules(dir) {
  if (!existsSync(dir)) return;
  
  let deletedCount = 0;
  const unnecessaryExtensions = [
    '.md', '.markdown', '.txt', '.rst',  // 文档文件
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.bmp',  // 图片文件
    '.pdf', '.doc', '.docx',  // 其他文档
    '.map',  // source map
  ];
  
  const unnecessaryDirs = [
    'test', 'tests', '__tests__', 'testing',
    'example', 'examples', 'demo', 'demos',
    'doc', 'docs', 'documentation',
    'coverage', '.nyc_output',
    'benchmark', 'benchmarks',
    '.github', '.gitlab', '.vscode', '.idea',
  ];
  
  const unnecessaryFiles = [
    'LICENSE', 'LICENSE.md', 'LICENSE.txt',
    'CHANGELOG', 'CHANGELOG.md', 'CHANGELOG.txt',
    'HISTORY', 'HISTORY.md', 'HISTORY.txt',
    'AUTHORS', 'AUTHORS.md', 'AUTHORS.txt',
    'CONTRIBUTORS', 'CONTRIBUTORS.md', 'CONTRIBUTORS.txt',
    'README.md', 'README.txt', 'README',
    '.npmignore', '.gitignore', '.editorconfig',
    '.eslintrc', '.eslintrc.js', '.eslintrc.json',
    '.prettierrc', '.prettierrc.js', '.prettierrc.json',
    'tsconfig.json', 'jsconfig.json',
  ];

  function cleanDir(currentDir) {
    const items = readdirSync(currentDir);
    
    for (const item of items) {
      const itemPath = join(currentDir, item);
      const stat = statSync(itemPath);
      
      if (stat.isDirectory()) {
        // 删除不必要的目录
        if (unnecessaryDirs.includes(item.toLowerCase())) {
          try {
            rmSync(itemPath, { recursive: true, force: true });
            deletedCount++;
          } catch (err) {
            // 忽略删除失败的情况
          }
        } else {
          // 递归处理子目录
          cleanDir(itemPath);
        }
      } else if (stat.isFile()) {
        const ext = item.substring(item.lastIndexOf('.')).toLowerCase();
        const fileName = item.toUpperCase();
        
        // 删除不必要的文件
        if (unnecessaryExtensions.includes(ext) || 
            unnecessaryFiles.some(f => fileName === f.toUpperCase())) {
          try {
            rmSync(itemPath, { force: true });
            deletedCount++;
          } catch (err) {
            // 忽略删除失败的情况
          }
        }
      }
    }
  }
  
  cleanDir(dir);
  return deletedCount;
}

const deletedCount = cleanNodeModules(nodeModulesDir);
console.log(`✅ 已清理 ${deletedCount} 个不必要的文件/目录`);

// 复制 images 目录 (从 electron/public)
const imagesDir = join(electronPublic, 'images');
const distImagesDir = join(distDir, 'images');
if (existsSync(imagesDir)) {
  if (!existsSync(distImagesDir)) {
    mkdirSync(distImagesDir, { recursive: true });
  }
  const imageFiles = readdirSync(imagesDir);
  imageFiles.forEach(file => {
    const src = join(imagesDir, file);
    const dest = join(distImagesDir, file);
    if (statSync(src).isFile()) {
      copyFileSync(src, dest);
      console.log(`✅ images/${file}`);
    }
  });
}

// 不再需要手动复制依赖和清理 package.json

// 清理不需要的 public 资源
console.log('🧹 清理不需要的资源文件...');

// 删除不需要的目录
const unnecessaryDirs = ['fonts', 'wasm'];
unnecessaryDirs.forEach(dir => {
  const dirPath = join(distDir, dir);
  if (existsSync(dirPath)) {
    rmSync(dirPath, { recursive: true, force: true });
    console.log(`✅ 已删除: ${dir}/`);
  }
});

// 删除不需要的文件
const unnecessaryFiles = ['logo.ico', 'robots.txt'];
unnecessaryFiles.forEach(file => {
  const filePath = join(distDir, file);
  if (existsSync(filePath)) {
    rmSync(filePath, { force: true });
    console.log(`✅ 已删除: ${file}`);
  }
});

// 清理 icons 目录，只保留 favicon.png 和 logo.svg
const iconsDir = join(distDir, 'icons');
if (existsSync(iconsDir)) {
  const keepFiles = ['favicon.png', 'logo.svg'];
  const iconFiles = readdirSync(iconsDir);
  
  iconFiles.forEach(file => {
    const filePath = join(iconsDir, file);
    const stat = statSync(filePath);
    
    // 删除子目录（tray、thumbar）
    if (stat.isDirectory()) {
      rmSync(filePath, { recursive: true, force: true });
      console.log(`✅ 已删除: icons/${file}/`);
    }
    // 删除不在保留列表中的文件
    else if (!keepFiles.includes(file)) {
      rmSync(filePath, { force: true });
      console.log(`✅ 已删除: icons/${file}`);
    }
  });
}

console.log('🎉 ZTools 插件构建完成!');
console.log(`📁 输出目录: ${distDir}`);

