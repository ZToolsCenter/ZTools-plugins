import fs from 'node:fs';
import path from 'node:path';

const distDir = path.resolve('dist');
const rootDir = path.resolve('.');

if (!fs.existsSync(distDir)) {
  console.error('dist 目录不存在');
  process.exit(1);
}

// 递归删除 .map 文件（正式构建用；GOOSE_DEBUG=1 时跳过）。
const removeMapFiles = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removeMapFiles(full);
    } else if (entry.name.endsWith('.map')) {
      fs.unlinkSync(full);
    }
  }
};

try {
  const preloadSrc = path.join(rootDir, 'preload/preload.cjs');
  if (fs.existsSync(preloadSrc)) {
    fs.copyFileSync(preloadSrc, path.join(distDir, 'preload.js'));
  }

  const preloadHelperSrc = path.join(rootDir, 'preload/mcp-tools.cjs');
  if (fs.existsSync(preloadHelperSrc)) {
    fs.copyFileSync(preloadHelperSrc, path.join(distDir, 'mcp-tools.cjs'));
  }

  const webFetchHelperSrc = path.join(rootDir, 'preload/web-fetch.cjs');
  if (fs.existsSync(webFetchHelperSrc)) {
    fs.copyFileSync(webFetchHelperSrc, path.join(distDir, 'web-fetch.cjs'));
  }

  fs.writeFileSync(path.join(distDir, 'package.json'), JSON.stringify({ type: 'commonjs' }));

  const logoSrc = path.join(rootDir, 'public/logo.png');
  if (fs.existsSync(logoSrc)) {
    fs.copyFileSync(logoSrc, path.join(distDir, 'logo.png'));
  }

  const pluginConfigPath = path.join(rootDir, 'plugin.json');
  if (fs.existsSync(pluginConfigPath)) {
    const pluginConfig = JSON.parse(fs.readFileSync(pluginConfigPath, 'utf-8'));
    pluginConfig.main = 'index.html';
    pluginConfig.preload = 'preload.js';
    pluginConfig.logo = 'logo.png';
    fs.writeFileSync(path.join(distDir, 'plugin.json'), JSON.stringify(pluginConfig, null, 2));
  } else {
    console.error('未找到 plugin.json');
    process.exit(1);
  }

  // 调试构建 (GOOSE_DEBUG=1) 保留 .map，供 uTools 开发者工具(Chromium DevTools) 还原 src/；
  // 正式构建删除 .map：vite sourcemap='hidden' 已让 JS 不含 sourceMappingURL，删 .map 既不外泄也不增体积。
  if (process.env.GOOSE_DEBUG === '1') {
    console.log('[utools-build] GOOSE_DEBUG=1：保留 sourcemap (.map) 文件');
  } else {
    removeMapFiles(distDir);
  }
} catch (e) {
  console.error(e);
  process.exit(1);
}

// ── B 插件（鹅的小窗）产物：dist-quicknote/ ──────────────────────────────
// dist-quicknote/ 由独立的 quicknote 构建（GOOSE_BUILD_TARGET=quicknote vite build）直接产出，
// 仅含 quicknote.html 可达的精简 chunk。此处只做收尾（注入 preload / plugin.json / package.json，
// 删 .map），不再从 dist/ 整目录拷贝——那会把主应用的全部重型 chunk（PDF/echarts/mermaid…）
// 带进小窗包，正是体积膨胀到 5MB+ 的根因。
const distQuicknoteDir = path.resolve('dist-quicknote');

try {
  if (!fs.existsSync(distQuicknoteDir)) {
    console.error('dist-quicknote 目录不存在——请先执行 quicknote 构建：GOOSE_BUILD_TARGET=quicknote vite build');
    process.exit(1);
  }

  // 注入 B 专属 preload。
  const preloadQnSrc = path.join(rootDir, 'preload/preload-quicknote.cjs');
  if (fs.existsSync(preloadQnSrc)) {
    fs.copyFileSync(preloadQnSrc, path.join(distQuicknoteDir, 'preload-quicknote.js'));
  } else {
    console.error('未找到 preload/preload-quicknote.cjs');
    process.exit(1);
  }

  // 覆盖 B 专属 plugin.json（读 quicknote-plugin.json，仅补写 preload 字段；B 无 main）。
  const qnPluginSrc = path.join(rootDir, 'quicknote-plugin.json');
  if (fs.existsSync(qnPluginSrc)) {
    const qnPluginConfig = JSON.parse(fs.readFileSync(qnPluginSrc, 'utf-8'));
    // 不设置 qnPluginConfig.main —— B 是模板插件，无主界面，不需要 main 字段。
    qnPluginConfig.preload = 'preload-quicknote.js';
    fs.writeFileSync(path.join(distQuicknoteDir, 'plugin.json'), JSON.stringify(qnPluginConfig, null, 2));
  } else {
    console.error('未找到 quicknote-plugin.json');
    process.exit(1);
  }

  // 确保 logo.png 存在（随 dist 拷贝已带，或从 public/ 补拷）。
  const qnLogo = path.join(distQuicknoteDir, 'logo.png');
  if (!fs.existsSync(qnLogo)) {
    const publicLogo = path.join(rootDir, 'public/logo.png');
    if (fs.existsSync(publicLogo)) {
      fs.copyFileSync(publicLogo, qnLogo);
    }
  }

  // package.json（type: commonjs，同 A）。
  fs.writeFileSync(path.join(distQuicknoteDir, 'package.json'), JSON.stringify({ type: 'commonjs' }));

  // 删 .map 规则同 A。
  if (process.env.GOOSE_DEBUG === '1') {
    console.log('[utools-build] GOOSE_DEBUG=1：dist-quicknote 保留 sourcemap (.map) 文件');
  } else {
    removeMapFiles(distQuicknoteDir);
  }

  console.log('[utools-build] dist-quicknote/ 产出完成');
} catch (e) {
  console.error(e);
  process.exit(1);
}

// ZTools CLI ignores dist/; keep a copy in app/.
const appDir = path.resolve('app');
fs.rmSync(appDir, { recursive: true, force: true });
fs.cpSync(distDir, appDir, { recursive: true });
console.log('[utools-build] app/ synced for ZTools');
