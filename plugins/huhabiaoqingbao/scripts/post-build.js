const { writeFileSync, existsSync, mkdirSync } = require('fs');
const { join, dirname } = require('path');

// 确保 scripts 目录存在
const scriptsDir = join(__dirname);
if (!existsSync(scriptsDir)) {
  mkdirSync(scriptsDir, { recursive: true });
}

console.log('Post-build process completed successfully!');

const fs = require('fs');
const path = require('path');

// 复制必要文件到发布目录
function copyFiles() {
  const files = ['plugin.json', 'preload.js', 'logo.png'];
  const distDir = path.resolve(__dirname, '../dist');
  
  // 确保目标目录存在
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }
  
  files.forEach(file => {
    const sourcePath = path.resolve(__dirname, '..', file);
    const targetPath = path.join(distDir, file);
    
    try {
      if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, targetPath);
        console.log(`✓ Successfully copied ${file} to dist directory`);
      } else {
        console.error(`✗ Source file ${file} not found at ${sourcePath}`);
      }
    } catch (error) {
      console.error(`Error copying ${file}:`, error);
    }
  });
}

// 确保 index.html 引用的资源路径正确
function fixHtmlPaths() {
  const htmlPath = path.resolve(__dirname, '../dist/index.html');
  
  try {
    if (fs.existsSync(htmlPath)) {
      let html = fs.readFileSync(htmlPath, 'utf-8');
      
      // 修正所有可能的资源路径问题
      html = html.replace(/\.\.\/assets\//g, './assets/');  // 修复 ../assets 为 ./assets
      html = html.replace(/\/assets\//g, './assets/');      // 修复 /assets 为 ./assets
      html = html.replace(/"\.\.\//g, '"./');              // 修复其他 ../ 开头的路径
      html = html.replace(/^(\s+)href="\//gm, '$1href="./');  // 修复以 / 开头的 href
      html = html.replace(/^(\s+)src="\//gm, '$1src="./');    // 修复以 / 开头的 src
      
      fs.writeFileSync(htmlPath, html);
      console.log('✓ Fixed asset paths in index.html');
      
      // 输出修改后的内容以供验证
      console.log('\nFixed index.html content preview:');
      console.log(html.slice(0, 500) + '...');
    } else {
      console.error('✗ index.html not found in dist directory');
    }
  } catch (error) {
    console.error('Error fixing HTML paths:', error);
  }
}

// 验证构建输出
function verifyBuild() {
  const distDir = path.resolve(__dirname, '../dist');
  const requiredFiles = ['index.html', 'plugin.json', 'preload.js', 'logo.png'];
  const assetsDir = path.join(distDir, 'assets');
  
  console.log('\nVerifying build output:');
  
  // 检查必需文件
  requiredFiles.forEach(file => {
    const filePath = path.join(distDir, file);
    const exists = fs.existsSync(filePath);
    console.log(`${exists ? '✓' : '✗'} ${file}`);
    
    if (exists) {
      const stats = fs.statSync(filePath);
      console.log(`  Size: ${stats.size} bytes`);
    }
  });
  
  // 检查资源目录
  if (fs.existsSync(assetsDir)) {
    console.log('\nAssets directory content:');
    const assets = fs.readdirSync(assetsDir, { recursive: true });
    assets.forEach(asset => {
      console.log(`  - ${asset}`);
    });
  } else {
    console.error('✗ Assets directory not found');
  }
}

// 主执行流程
try {
  console.log('Starting post-build process...\n');
  
  copyFiles();
  fixHtmlPaths();
  verifyBuild();
  
  console.log('\n✓ Post-build process completed successfully!');
} catch (error) {
  console.error('\n✗ Error during post-build process:', error);
  process.exit(1);
} 