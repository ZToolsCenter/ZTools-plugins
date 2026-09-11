import fs from 'node:fs';
import path from 'node:path';

const distDir = path.resolve('dist');
const rootDir = path.resolve('.');

const isDebugBuild = process.env.GOOSE_DEBUG === '1';

if (!fs.existsSync(distDir)) {
  console.error('❌ dist 目录不存在，请先执行构建');
  process.exit(1);
}

/**
 * 递归删除 dist 下所有 .map 文件（uTools 正式构建用 sourcemap='hidden'：写 .map 但 JS 无
 * //# 注释，这里删除以免源码随插件包外泄/增体积）。GOOSE_DEBUG=1 调试构建跳过，保留 map 供断点。
 */
function removeMapFiles(dir) {
  let removed = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removed += removeMapFiles(full);
    } else if (entry.name.endsWith('.map')) {
      fs.rmSync(full);
      removed += 1;
    }
  }
  return removed;
}

try {
  // 1. 复制 preload.js（保持 .js 扩展名以兼容 uTools 编辑器）
  const preloadSrc = path.join(rootDir, 'preload/preload.cjs');
  if (fs.existsSync(preloadSrc)) {
      fs.copyFileSync(preloadSrc, path.join(distDir, 'preload.js'));
      console.log('✅ preload.js 已复制');
  } else {
      console.warn('⚠️ 未找到 preload/preload.cjs');
  }

  const webFetchSrc = path.join(rootDir, 'preload/web-fetch.cjs');
  if (fs.existsSync(webFetchSrc)) {
      fs.copyFileSync(webFetchSrc, path.join(distDir, 'web-fetch.cjs'));
      console.log('✅ web-fetch.cjs 已复制');
  }

  // 1.1 创建 dist/package.json 设置 type: commonjs
  const distPackageJson = { type: 'commonjs' };
  fs.writeFileSync(path.join(distDir, 'package.json'), JSON.stringify(distPackageJson, null, 2));
  console.log('✅ dist/package.json 已创建（type: commonjs）');

  // 2. 复制 browser.html
  const browserSrc = path.join(rootDir, 'browser.html');
  if (fs.existsSync(browserSrc)) {
      fs.copyFileSync(browserSrc, path.join(distDir, 'browser.html'));
      console.log('✅ browser.html 已复制');
  } else {
      console.warn('⚠️ 未找到 browser.html');
  }

  // 3. 处理并复制 plugin.json
  const pluginConfigPath = path.join(rootDir, 'plugin.json');
  if (fs.existsSync(pluginConfigPath)) {
      const pluginConfig = JSON.parse(fs.readFileSync(pluginConfigPath, 'utf-8'));
      
      // 修改为生产环境路径
      pluginConfig.main = 'index.html';
      pluginConfig.preload = 'preload.js';
      pluginConfig.logo = 'logo.png';
      
      // 写入到 dist
      fs.writeFileSync(path.join(distDir, 'plugin.json'), JSON.stringify(pluginConfig, null, 2));
      console.log('✅ plugin.json 已生成并配置为生产路径');
  } else {
       console.error('❌ 未找到根目录 plugin.json');
  }

  // 4. 清理 sourcemap：正式构建删除 .map（'hidden' 模式写了盘）；debug 构建保留。
  if (isDebugBuild) {
    console.log('🐛 GOOSE_DEBUG=1：保留 .map 文件供调试。');
  } else {
    const removed = removeMapFiles(distDir);
    console.log(`✅ 已删除 ${removed} 个 .map 文件（正式构建不外泄源码）`);
  }

  console.log('🎉 uTools 发布文件准备就绪！请直接打包 dist 目录。');

} catch (e) {
  console.error('❌ 处理出错:', e);
  process.exit(1);
}

// ZTools CLI ignores dist/; keep a copy in app/.
const appDir = path.resolve('app');
fs.rmSync(appDir, { recursive: true, force: true });
fs.cpSync(distDir, appDir, { recursive: true });
console.log('[utools-build] app/ synced for ZTools');
