/**
 * 通用 App 图标提取与高保真矢量回退工具
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const iconCache = new Map();

function getAppIconDataUrl(appPath) {
  if (!appPath || typeof appPath !== 'string') return '';
  if (iconCache.has(appPath)) return iconCache.get(appPath);

  try {
    if (process.platform === 'darwin') {
      let bundlePath = '';
      if (appPath.includes('.app')) {
        const idx = appPath.indexOf('.app');
        bundlePath = appPath.slice(0, idx + 4);
      } else if (appPath.endsWith('.app')) {
        bundlePath = appPath;
      }

      if (!bundlePath || !fs.existsSync(bundlePath)) {
        iconCache.set(appPath, '');
        return '';
      }

      const plistPath = path.join(bundlePath, 'Contents', 'Info.plist');
      let iconFileName = '';
      if (fs.existsSync(plistPath)) {
        try {
          const jsonStr = execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plistPath], { encoding: 'utf8', timeout: 800, stdio: ['ignore', 'pipe', 'ignore'] });
          const plist = JSON.parse(jsonStr);
          if (plist && plist.CFBundleIconFile) {
            iconFileName = String(plist.CFBundleIconFile);
            if (!iconFileName.endsWith('.icns')) iconFileName += '.icns';
          }
        } catch {}
      }

      const resDir = path.join(bundlePath, 'Contents', 'Resources');
      let icnsPath = '';
      if (iconFileName && fs.existsSync(path.join(resDir, iconFileName))) {
        icnsPath = path.join(resDir, iconFileName);
      } else if (fs.existsSync(resDir)) {
        try {
          const files = fs.readdirSync(resDir);
          const candidate = files.find(f => f.endsWith('.icns'));
          if (candidate) icnsPath = path.join(resDir, candidate);
        } catch {}
      }

      if (icnsPath && fs.existsSync(icnsPath)) {
        const tmpOut = path.join(require('os').tmpdir(), `app_icon_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`);
        try {
          execFileSync('/usr/bin/sips', ['-s', 'format', 'png', icnsPath, '--out', tmpOut, '-z', '48', '48'], { timeout: 1500, stdio: 'ignore' });
          if (fs.existsSync(tmpOut)) {
            const buf = fs.readFileSync(tmpOut);
            fs.unlinkSync(tmpOut);
            const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
            iconCache.set(appPath, dataUrl);
            return dataUrl;
          }
        } catch {
          try { if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut); } catch {}
        }
      }
    }
  } catch {}

  iconCache.set(appPath, '');
  return '';
}

function getLetterSvgIcon(name, category = '') {
  const cleanName = (name || '?').trim();
  const letter = (cleanName[0] || '?').toUpperCase();
  
  let hash = 0;
  for (let i = 0; i < cleanName.length; i++) {
    hash = (hash << 5) - hash + cleanName.charCodeAt(i);
    hash |= 0;
  }
  const hues = [210, 260, 290, 340, 160, 180, 25, 45];
  const hue = hues[Math.abs(hash) % hues.length];
  
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="hsl(${hue}, 75%, 55%)"/>
        <stop offset="100%" stop-color="hsl(${(hue + 30) % 360}, 70%, 42%)"/>
      </linearGradient>
    </defs>
    <rect width="48" height="48" rx="11" fill="url(#g)"/>
    <text x="24" y="29" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="20" font-weight="700" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${letter}</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

module.exports = {
  getAppIconDataUrl,
  getLetterSvgIcon
};
