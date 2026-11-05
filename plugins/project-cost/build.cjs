// 打包 ZTools 插件：dist/ 构建产物 + plugin.json / preload.js / logo.png / README.md
// 打平后产出 .zip 与 .zpx（内容一致，.zpx 供 ZTools「安装本地插件」），有 asar 时额外产出 .asar。
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');

const root = process.cwd();
const dist = path.join(root, 'dist');
const rel = path.join(root, 'releases');
const NAME = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8')).name;

if (!fs.existsSync(dist)) {
  console.error('ERROR: dist/ 不存在，请先运行 `npm run build`。');
  process.exit(1);
}
fs.mkdirSync(rel, { recursive: true });

const ver = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8')).version;
const idx = fs.readFileSync(path.join(dist, 'index.html'));
const hash = crypto.createHash('md5').update(idx).digest('hex').slice(0, 8);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ztpkg-'));
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
copyDir(dist, tmp);
for (const f of ['plugin.json', 'preload.js', 'logo.png', 'README.md']) {
  const p = path.join(root, f);
  if (fs.existsSync(p)) fs.copyFileSync(p, path.join(tmp, f));
}
// probe/test 探针不应进包
for (const f of ['probe.html', 'test.html']) {
  const p = path.join(tmp, f);
  if (fs.existsSync(p)) fs.rmSync(p);
}

for (const ext of ['zip', 'zpx']) {
  for (const old of fs.readdirSync(rel).filter((n) => n.startsWith(`${NAME}-${ver}.`) && n.endsWith(`.${ext}`))) {
    fs.rmSync(path.join(rel, old), { force: true });
  }
}

const zip = path.join(rel, `${NAME}-${ver}.zip`);
const zpx = path.join(rel, `${NAME}-${ver}.zpx`);
execSync(`cd "${tmp}" && zip -r -X -q "${zip}" .`);
fs.copyFileSync(zip, zpx);

// asar 在某些沙箱下不可写：失败时只告警，不阻断 zip/zpx 产物
let asarPhase = false;
process.on('uncaughtException', (e) => {
  if (!asarPhase) throw e;
  console.warn('asar 打包跳过（沙箱限制）:', String((e && e.message) || e).split('\n')[0]);
});

const asarBin = path.join(process.env.HOME, '.workbuddy/binaries/node/workspace/node_modules/.bin/asar');
let asarPath = null;
if (fs.existsSync(asarBin)) asarPath = asarBin;
else {
  try { asarPath = execSync('command -v asar').toString().trim(); } catch (e) { /* none */ }
}
if (asarPath) {
  const asarFile = path.join(rel, `${NAME}-${ver}-${hash}.asar`);
  asarPhase = true;
  try {
    execSync(`"${asarPath}" pack "${tmp}" "${asarFile}"`);
    console.log('asar ->', path.basename(asarFile));
  } catch (e) {
    console.warn('asar 打包跳过:', String(e.message).split('\n')[0]);
  }
  // 注意：asar 的写入失败可能是异步抛出的，故不复位 asarPhase
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('=== releases ===');
for (const n of fs.readdirSync(rel)) console.log(' ', n);
