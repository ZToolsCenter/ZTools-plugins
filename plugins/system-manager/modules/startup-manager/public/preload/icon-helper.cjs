/**
 * 通用 App 图标提取与高保真矢量回退工具
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const iconCache = new Map();
let bundleIndex = null;

function normalizeKey(str) {
  if (!str || typeof str !== 'string') return '';
  return str.toLowerCase()
    .replace(/^(com|org|net|io)\.[^.]+\./i, '')
    .replace(/[\s\-_.]+/g, '')
    .trim();
}

function buildBundleIndex() {
  if (bundleIndex) return bundleIndex;
  bundleIndex = new Map();

  const appDirs = [
    '/Applications',
    '/System/Applications',
    '/System/Applications/Utilities',
    path.join(os.homedir(), 'Applications')
  ];

  for (const dir of appDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (!file.endsWith('.app')) continue;
        const appPath = path.join(dir, file);
        const appName = file.slice(0, -4);
        
        // 索引直接应用名称
        bundleIndex.set(appName.toLowerCase(), appPath);
        const normName = normalizeKey(appName);
        if (normName && normName.length >= 2) bundleIndex.set(normName, appPath);

        const plistPath = path.join(appPath, 'Contents/Info.plist');
        if (fs.existsSync(plistPath)) {
          try {
            const out = execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plistPath], {
              encoding: 'utf8',
              stdio: ['ignore', 'pipe', 'ignore'],
              timeout: 600
            });
            const plist = JSON.parse(out);
            if (plist.CFBundleIdentifier) {
              const bundleId = plist.CFBundleIdentifier.toLowerCase();
              bundleIndex.set(bundleId, appPath);
              const normBundle = normalizeKey(bundleId);
              if (normBundle && normBundle.length >= 2) bundleIndex.set(normBundle, appPath);

              const sub = bundleId.split('.').pop();
              // Don't index generic words like 'desktop', 'agent', 'helper', 'client', 'app'
              const genericWords = new Set(['desktop', 'agent', 'helper', 'client', 'app', 'service', 'launcher', 'daemon', 'updater']);
              if (sub && sub.length >= 3 && !genericWords.has(sub.toLowerCase())) {
                bundleIndex.set(sub, appPath);
              }
            }
            if (plist.CFBundleName) {
              bundleIndex.set(plist.CFBundleName.toLowerCase(), appPath);
              const normCb = normalizeKey(plist.CFBundleName);
              if (normCb && normCb.length >= 2) bundleIndex.set(normCb, appPath);
            }
          } catch {}
        }
      }
    } catch {}
  }
  return bundleIndex;
}

function resolveAppPath(query) {
  if (!query || typeof query !== 'string') return null;
  const trimmed = query.trim();
  if (!trimmed) return null;

  if (trimmed.includes('/') && fs.existsSync(trimmed)) {
    let curr = trimmed;
    while (curr && curr !== '/' && curr !== '.') {
      if (curr.endsWith('.app')) return curr;
      curr = path.dirname(curr);
    }
  }

  const idx = buildBundleIndex();
  const lower = trimmed.toLowerCase();
  if (idx.has(lower)) return idx.get(lower);

  const cleanQuery = normalizeKey(lower);
  if (cleanQuery && cleanQuery.length >= 3) {
    if (idx.has(cleanQuery)) return idx.get(cleanQuery);
    for (const [key, appPath] of idx.entries()) {
      const cleanKey = normalizeKey(key);
      if (cleanKey && cleanKey.length >= 3) {
        if (cleanKey === cleanQuery) {
          return appPath;
        }
      }
    }
  }

  // 尝试按点分反向解析父级 Bundle ID（如 com.figma.Desktop.ShipIt -> com.figma.Desktop）
  if (trimmed.includes('.')) {
    const parts = trimmed.split('.');
    while (parts.length > 2) {
      parts.pop();
      const parentQuery = parts.join('.');
      const pLower = parentQuery.toLowerCase();
      if (idx.has(pLower)) return idx.get(pLower);
      const pClean = normalizeKey(pLower);
      if (pClean && idx.has(pClean)) return idx.get(pClean);
    }
  }

  return null;
}

function extractDarwinIcon(appPath) {
  if (!appPath || typeof appPath !== 'string') return null;
  if (iconCache.has(appPath)) return iconCache.get(appPath);

  try {
    const resourcesDir = path.join(appPath, 'Contents/Resources');
    if (!fs.existsSync(resourcesDir)) {
      iconCache.set(appPath, null);
      return null;
    }

    let iconFileName = null;
    const plistPath = path.join(appPath, 'Contents/Info.plist');
    if (fs.existsSync(plistPath)) {
      try {
        const out = execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plistPath], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 600
        });
        const plist = JSON.parse(out);
        if (plist.CFBundleIconFile) {
          iconFileName = plist.CFBundleIconFile.endsWith('.icns') ? plist.CFBundleIconFile : plist.CFBundleIconFile + '.icns';
        }
      } catch {}
    }

    if (!iconFileName) {
      const files = fs.readdirSync(resourcesDir);
      const icns = files.find(f => f.endsWith('.icns'));
      if (icns) iconFileName = icns;
    }

    if (!iconFileName) {
      iconCache.set(appPath, null);
      return null;
    }

    const icnsPath = path.join(resourcesDir, iconFileName);
    if (!fs.existsSync(icnsPath)) {
      iconCache.set(appPath, null);
      return null;
    }

    const tmpOut = path.join(os.tmpdir(), 'ztools-icon-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.png');
    execFileSync('/usr/bin/sips', ['-s', 'format', 'png', icnsPath, '--out', tmpOut, '-z', '48', '48'], {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 1500
    });

    if (fs.existsSync(tmpOut)) {
      const buf = fs.readFileSync(tmpOut);
      try { fs.unlinkSync(tmpOut); } catch {}
      const dataUrl = 'data:image/png;base64,' + buf.toString('base64');
      iconCache.set(appPath, dataUrl);
      return dataUrl;
    }
  } catch {}

  iconCache.set(appPath, null);
  return null;
}

function getAppIconDataUrl(appNameOrPath) {
  if (!appNameOrPath) return '';
  const resolved = resolveAppPath(appNameOrPath);
  if (resolved) {
    const icon = extractDarwinIcon(resolved);
    if (icon) return icon;
  }
  return '';
}

function getLetterSvgIcon(name) {
  const char = (name || '?').replace(/^[._]/, '').trim().charAt(0).toUpperCase() || '?';
  const colors = [
    ['#3b82f6', '#1d4ed8'],
    ['#10b981', '#047857'],
    ['#8b5cf6', '#6d28d9'],
    ['#f59e0b', '#d97706'],
    ['#ec4899', '#be185d'],
    ['#06b6d4', '#0e7490']
  ];
  const idx = Math.abs((char.codePointAt(0) || 0) % colors.length);
  const [c1, c2] = colors[idx];

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">' +
    '<defs>' +
    '<linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">' +
    '<stop offset="0%" stop-color="' + c1 + '"/>' +
    '<stop offset="100%" stop-color="' + c2 + '"/>' +
    '</linearGradient>' +
    '</defs>' +
    '<rect width="48" height="48" rx="10" fill="url(#g)"/>' +
    '<text x="50%" y="54%" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="24" font-weight="bold" fill="#ffffff" dominant-baseline="middle" text-anchor="middle">' +
    char +
    '</text>' +
    '</svg>';

  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

module.exports = {
  resolveAppPath,
  extractDarwinIcon,
  getAppIconDataUrl,
  getLetterSvgIcon
};
