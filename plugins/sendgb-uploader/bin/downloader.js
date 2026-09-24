/**
 * SendGB 下载执行器（纯 Node，无需浏览器 —— 下载不经过 Cloudflare 验证）
 *
 * 用法：
 *     node downloader.js <链接或code> <输出目录> [--zip] [--password=xxx] [--workers=3]
 *     node downloader.js <链接或code> --resolve        # 只解析，不下载
 *
 * 下载原理（实测得出）：
 *     1) GET  api.sendgb.com/api/download/<code>                    → 文件清单
 *     2) GET  api.sendgb.com/api/download/<code>/presign?key=<key>  → 预签名直链（R2，7天有效）
 *     3) GET  预签名直链                                            → 文件本体（支持 Range 断点续传）
 *     有密码：POST /download/<code>/verify-password（头 X-Transfer-Password）先解锁
 *
 * stdout 输出 JSON 行：
 *     {"t":"meta","code":…,"files":[…],"totalBytes":…,"expiresAt":…}
 *     {"t":"log","m":"…"}                    过程日志
 *     {"t":"file","name":"…","path":"…","size":…}  单个文件完成
 *     {"t":"progress","p":42,"m":"…"}        总进度（0-100）
 *     {"t":"done","dir":"…","files":[…],"zip":"…"} 全部完成
 *     {"t":"error","m":"…"}                  失败
 */

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { spawn } = require('node:child_process');

const API = 'https://api.sendgb.com/api';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const ZIP_MAX_BYTES = 4 * 1024 * 1024 * 1024; // 超过 4GB 不打包（避免 zip64）

function emit(obj) {
  try {
    process.stdout.write(JSON.stringify(obj) + '\n');
  } catch (e) {}
}

function human(n) {
  const u = [['GB', 1073741824], ['MB', 1048576], ['KB', 1024]];
  for (const [name, div] of u) if (n >= div) return (n / div).toFixed(2) + ' ' + name;
  return n + ' B';
}

function formatDuration(sec) {
  if (sec == null || isNaN(sec)) return '';
  sec = Math.round(sec);
  if (sec <= 0) return '即将完成';
  if (sec < 60) return `${sec}秒`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `${m}分${s}秒` : `${m}分钟`;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}小时${m}分` + (s > 0 ? `${s}秒` : '');
}

function formatElapsed(sec) {
  if (sec == null || isNaN(sec)) return '';
  sec = Math.round(sec);
  if (sec <= 0) return '1秒内';
  if (sec < 60) return `${sec}秒`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `${m}分${s}秒` : `${m}分钟`;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}小时${m}分` + (s > 0 ? `${s}秒` : '');
}

function parseCode(input) {
  const s = String(input || '').trim().replace(/^["']|["']$/g, '');
  if (!s) throw new Error('链接为空');
  let p = s;
  if (/^https?:\/\//i.test(s)) {
    try {
      p = new URL(s).pathname;
    } catch (e) {
      throw new Error('链接格式不对：' + s);
    }
  }
  p = p.replace(/\/+$/, '');
  const m = p.match(/([A-Za-z0-9]{8,24})$/);
  if (!m) throw new Error('认不出这是 SendGB 链接：' + s);
  return m[1];
}

function safeRel(rel, fallback) {
  const raw = String(rel || fallback || 'file').replace(/\\/g, '/');
  const parts = raw
    .split('/')
    .filter((p) => p && p !== '.' && p !== '..')
    .map((p) => p.replace(/[<>:"|?*\x00-\x1f]/g, '_'));
  return parts.length ? path.join(...parts) : 'file';
}

async function apiGet(pathname, headers = {}) {
  const r = await fetch(API + pathname, {
    headers: Object.assign({ 'User-Agent': UA, Accept: 'application/json' }, headers)
  });
  return r;
}

async function apiJson(r) {
  const txt = await r.text();
  try {
    return JSON.parse(txt);
  } catch (e) {
    throw new Error(`接口返回的不是 JSON（HTTP ${r.status}）：${txt.slice(0, 120)}`);
  }
}

/* ---------------- 元数据 ---------------- */

async function resolve(code, password) {
  const r = await apiGet(`/download/${encodeURIComponent(code)}`);
  if (r.status === 410) throw new Error('这个链接已过期或被删除了');
  if (r.status === 404) throw new Error('链接不存在（code 可能抄错了）');
  let meta = await apiJson(r);
  if (!meta || !meta.ok) throw new Error((meta && (meta.error || meta.message)) || `接口失败 HTTP ${r.status}`);

  if (meta.expires_at) {
    const left = Number(meta.expires_at) - Math.floor(Date.now() / 1000);
    meta.expires_in_days = Math.round((left / 86400) * 10) / 10;
    if (left <= 0) throw new Error('这个链接已过期');
  }

  if (meta.is_protected && !meta.is_unlocked) {
    if (!password) throw new Error('这个链接有密码保护，请在设置里填写密码后重试');
    const r2 = await fetch(API + `/download/${encodeURIComponent(code)}/verify-password`, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Transfer-Password': password
      },
      body: JSON.stringify({ password })
    });
    const got = await apiJson(r2);
    if (!got.ok || !got.is_unlocked) throw new Error('密码不对，解锁失败');
    meta = got;
  }
  return meta;
}

async function presign(code, key, password) {
  const headers = password ? { 'X-Transfer-Password': password } : {};
  const r = await apiGet(`/download/${encodeURIComponent(code)}/presign?key=${encodeURIComponent(key)}`, headers);
  const data = await apiJson(r);
  if (!data.ok || !data.url) throw new Error(`拿不到下载直链（${data.error || 'HTTP ' + r.status}）`);
  return data;
}

/* ---------------- 下载单个文件（支持断点续传） ---------------- */

async function downloadFile({ url, target, size, onBytes, shouldStop }) {
  const pos = fs.existsSync(target) ? fs.statSync(target).size : 0;
  if (size && pos === size) {
    onBytes(0);
    return { skipped: true, size: pos };
  }
  if (size && pos > size) {
    await fsp.rm(target, { force: true });
  }
  const start = fs.existsSync(target) ? fs.statSync(target).size : 0;
  const headers = { 'User-Agent': UA };
  if (start > 0) headers.Range = `bytes=${start}-`;

  const res = await fetch(url, { headers });
  if (res.status === 416) return { size };
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);

  const appending = start > 0 && res.status === 206;
  const out = fs.createWriteStream(target, { flags: appending ? 'a' : 'w' });
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      if (shouldStop && shouldStop()) return cb(new Error('已取消'));
      onBytes(chunk.length);
      cb(null, chunk);
    }
  });
  await pipeline(Readable.fromWeb(res.body), counter, out);

  const got = fs.statSync(target).size;
  if (size && got !== size) throw new Error(`大小不符：期望 ${human(size)}，实际 ${human(got)}`);
  return { size: got, resumed: appending };
}

function parseByteUnit(str) {
  const m = String(str || '').match(/^([0-9.]+)\s*([A-Za-z]+)?$/);
  if (!m) return 0;
  const num = parseFloat(m[1]);
  const unit = (m[2] || '').toUpperCase();
  if (unit.startsWith('G')) return Math.round(num * 1073741824);
  if (unit.startsWith('M')) return Math.round(num * 1048576);
  if (unit.startsWith('K')) return Math.round(num * 1024);
  return Math.round(num);
}

function ensureRealExe(p) {
  if (!p || typeof p !== 'string') return null;
  if (!p.includes('.asar')) return p;
  const appBin = path.join(
    process.env.LOCALAPPDATA || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local') : os.tmpdir()),
    'sendgb-uploader',
    'bin'
  );
  const realExe = path.join(appBin, 'aria2c.exe');
  try {
    let needExtract = true;
    if (fs.existsSync(realExe) && fs.existsSync(p)) {
      if (fs.statSync(realExe).size === fs.statSync(p).size) {
        needExtract = false;
      }
    }
    if (needExtract && fs.existsSync(p)) {
      fs.mkdirSync(appBin, { recursive: true });
      fs.writeFileSync(realExe, fs.readFileSync(p));
    }
    return fs.existsSync(realExe) ? realExe : p;
  } catch (e) {
    return p;
  }
}

function downloadWithAria2({ aria2Path, url, target, size, onProgress, shouldStop }) {
  aria2Path = ensureRealExe(aria2Path);
  return new Promise((resolve, reject) => {
    const targetDir = path.dirname(target);
    const filename = path.basename(target);

    if (size && fs.existsSync(target)) {
      const cur = fs.statSync(target).size;
      if (cur === size) return resolve({ skipped: true, size: cur });
    }

    const args = [
      '-x', '16',
      '-s', '16',
      '-k', '1M',
      '--check-certificate=false',
      '--file-allocation=none',
      '--summary-interval=1',
      '--console-log-level=warn',
      '--download-result=hide',
      '--allow-overwrite=true',
      '--auto-file-renaming=false',
      '--async-dns=false',
      '--retry-wait=2',
      '-m', '3',
      '-c',
      '-d', targetDir,
      '-o', filename,
      url
    ];

    let child;
    try {
      child = spawn(aria2Path, args, { windowsHide: true });
    } catch (e) {
      return reject(e);
    }

    let lastBytes = 0;
    let buf = '';

    const stopCheck = setInterval(() => {
      if (shouldStop && shouldStop()) {
        clearInterval(stopCheck);
        try { child.kill('SIGKILL'); } catch (e) {}
        reject(new Error('已取消'));
      }
    }, 500);

    child.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      const lines = buf.split(/\r|\n/);
      buf = lines.pop();
      for (const line of lines) {
        const m = line.match(/\[#[a-f0-9]+\s+([0-9.]+\S*)\/([0-9.]+\S*)\((\d+)%\)\s+CN:(\d+)\s+DL:([0-9.]+\S*)/i);
        if (m) {
          const curBytes = parseByteUnit(m[1]);
          const speed = m[5] ? m[5].replace(/iB/g, 'B') + '/s' : '';
          const delta = Math.max(0, curBytes - lastBytes);
          lastBytes = curBytes;
          if (onProgress) {
            onProgress({ delta, speed, fileBytes: curBytes, percent: parseInt(m[3], 10) });
          }
        }
      }
    });

    child.on('error', (err) => {
      clearInterval(stopCheck);
      reject(err);
    });

    child.on('close', (code) => {
      clearInterval(stopCheck);
      if (code === 0) {
        const got = fs.existsSync(target) ? fs.statSync(target).size : 0;
        resolve({ size: got, resumed: false });
      } else {
        reject(new Error(`aria2c 退出码 ${code}`));
      }
    });
  });
}

/* ---------------- 最小 ZIP 打包（只用 zlib，无第三方依赖） ---------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf, seed = 0) {
  let c = ~seed;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function dosTime(d) {
  const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xffff;
  const date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  return { time, date };
}

async function zipFiles(zipPath, entries, baseDir) {
  const out = fs.createWriteStream(zipPath);
  const write = (buf) =>
    new Promise((res, rej) => {
      out.write(buf, (e) => (e ? rej(e) : res()));
    });
  const central = [];
  let offset = 0;

  for (const abs of entries) {
    const name = path.relative(baseDir, abs).replace(/\\/g, '/');
    const nameBuf = Buffer.from(name, 'utf8');
    const stat = await fsp.stat(abs);
    const { time, date } = dosTime(new Date(stat.mtimeMs || Date.now()));

    // 本地文件头：bit0=0 无加密，bit3=1 用数据描述符（尺寸/CRC 写在数据后面）
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // 解压所需版本
    header.writeUInt16LE(0x0808, 6); // 0x0800 UTF-8 名称 | 0x0008 数据描述符
    header.writeUInt16LE(8, 8); // deflate
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(0, 14); // CRC 在数据描述符里
    header.writeUInt32LE(0, 18); // 压缩后大小同上
    header.writeUInt32LE(0, 22); // 原始大小同上
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);
    await write(header);
    await write(nameBuf);
    const dataOffset = offset + 30 + nameBuf.length;

    // CRC 必须算在「压缩前」的数据上；压缩后的大小单独统计
    let crc = 0;
    let compressed = 0;
    const crcT = new Transform({
      transform(chunk, _e, cb) {
        crc = crc32(chunk, crc);
        cb(null, chunk);
      }
    });
    const countT = new Transform({
      transform(chunk, _e, cb) {
        compressed += chunk.length;
        cb(null, chunk);
      }
    });
    await pipeline(
      fs.createReadStream(abs, { highWaterMark: 1024 * 1024 }),
      crcT,
      zlib.createDeflateRaw({ level: 6 }),
      countT,
      out,
      { end: false } // 不要结束整个 zip 流
    );

    const dd = Buffer.alloc(16);
    dd.writeUInt32LE(0x08074b50, 0); // 数据描述符签名
    dd.writeUInt32LE(crc >>> 0, 4);
    dd.writeUInt32LE(compressed >>> 0, 8);
    dd.writeUInt32LE(stat.size >>> 0, 12);
    await write(dd);

    central.push({ nameBuf, time, date, crc, compressed, size: stat.size, offset });
    offset = dataOffset + compressed + 16;
  }

  const cdStart = offset;
  for (const e of central) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt16LE(20, 4); // 创建版本
    h.writeUInt16LE(20, 6); // 解压所需版本
    h.writeUInt16LE(0x0808, 8);
    h.writeUInt16LE(8, 10);
    h.writeUInt16LE(e.time, 12);
    h.writeUInt16LE(e.date, 14);
    h.writeUInt32LE(e.crc >>> 0, 16);
    h.writeUInt32LE(e.compressed >>> 0, 20);
    h.writeUInt32LE(e.size >>> 0, 24);
    h.writeUInt16LE(e.nameBuf.length, 28);
    h.writeUInt32LE(0, 42); // 本地头偏移
    h.writeUInt32LE(e.offset >>> 0, 42);
    h.writeUInt16LE(0, 36);
    h.writeUInt32LE(0, 38);
    await write(h);
    await write(e.nameBuf);
    offset += 46 + e.nameBuf.length;
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(offset - cdStart, 12);
  end.writeUInt32LE(cdStart, 16);
  await write(end);
  await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
}

/* ---------------- 主流程 ---------------- */

async function main() {
  const argv = process.argv.slice(2);
  const flags = argv.filter((a) => a.startsWith('--'));
  const positional = argv.filter((a) => !a.startsWith('--'));
  const link = positional[0];
  const resolveOnly = flags.includes('--resolve');
  const wantZip = flags.includes('--zip');
  const password = (flags.find((f) => f.startsWith('--password=')) || '').split('=')[1] || '';
  const workers = Math.max(1, Math.min(6, parseInt((flags.find((f) => f.startsWith('--workers=')) || '').split('=')[1] || '3', 10) || 3));
  const aria2Flag = flags.find((f) => f.startsWith('--aria2='));
  let aria2Path = aria2Flag ? aria2Flag.slice(8) : null;
  if (!aria2Path && !flags.includes('--no-aria2')) {
    const bundled = path.join(__dirname, 'aria2c.exe');
    if (fs.existsSync(bundled)) aria2Path = bundled;
  }
  aria2Path = ensureRealExe(aria2Path);

  if (!link) {
    emit({ t: 'error', m: '用法：downloader.js <链接> [输出目录] [--zip] [--resolve]' });
    return 2;
  }

  let code;
  try {
    code = parseCode(link);
  } catch (e) {
    emit({ t: 'error', m: e.message });
    return 2;
  }

  let meta;
  try {
    meta = await resolve(code, password);
  } catch (e) {
    emit({ t: 'error', m: e.message });
    return 1;
  }

  const files = meta.files || [];
  const totalBytes = Number(meta.total_size) || files.reduce((s, f) => s + (Number(f.size) || 0), 0);
  emit({
    t: 'meta',
    code,
    transferName: meta.transfer_name || null,
    fileCount: meta.file_count || files.length,
    totalBytes,
    totalHuman: human(totalBytes),
    expiresInDays: meta.expires_in_days || null,
    protected: !!meta.is_protected,
    files: files.map((f) => ({ name: f.relative_path || f.name, size: Number(f.size) || 0, type: f.type || '' }))
  });

  if (resolveOnly) return 0;

  const destDir = positional[1] || path.join(os.homedir(), 'Downloads', 'SendGB', code);
  await fsp.mkdir(destDir, { recursive: true });
  const engineNote = aria2Path && fs.existsSync(aria2Path) ? '（已启用 aria2c 16 线程极速加速）' : '';
  emit({ t: 'log', m: `共 ${files.length} 个文件，${human(totalBytes)}，保存到 ${destDir} ${engineNote}` });

  let done = 0;
  let stopped = false;
  const shouldStop = () => stopped;
  const saved = [];
  const errors = [];

  const taskStartedAt = Date.now();
  let lastSpeedBytes = 0;
  let lastSpeedTime = Date.now();
  let smoothedSpeed = 0; // bytes per second

  const tick = (n, speed) => {
    done += n;
    const p = totalBytes ? Math.min(100, Math.floor((done * 100) / totalBytes)) : 0;

    // 速度与耗时预估
    const now = Date.now();
    const dt = (now - lastSpeedTime) / 1000;
    if (dt >= 0.5) {
      const instant = (done - lastSpeedBytes) / dt;
      smoothedSpeed = smoothedSpeed > 0 ? (smoothedSpeed * 0.6 + instant * 0.4) : instant;
      lastSpeedTime = now;
      lastSpeedBytes = done;
    }

    let curSpeedBps = smoothedSpeed;
    let spd = speed;
    if (speed) {
      const parsed = parseByteUnit(speed);
      if (parsed > 0) curSpeedBps = parsed;
    } else if (curSpeedBps > 0) {
      spd = human(curSpeedBps) + '/s';
    }

    let etaStr = '';
    const remainBytes = Math.max(0, totalBytes - done);
    if (p >= 100 || remainBytes <= 0) {
      etaStr = '即将完成';
    } else if (curSpeedBps > 1024) {
      const etaSec = Math.ceil(remainBytes / curSpeedBps);
      etaStr = formatDuration(etaSec);
    }

    const spdPart = spd ? ` · 速度 ${spd}` : '';
    const etaPart = etaStr ? ` · 预估剩余 ${etaStr}` : '';
    emit({
      t: 'progress',
      p,
      speed: spd || (curSpeedBps > 0 ? human(curSpeedBps) + '/s' : ''),
      eta: etaStr,
      doneBytes: done,
      totalBytes,
      m: `下载中 ${p}%（${human(done)}/${human(totalBytes)}）${spdPart}${etaPart}`
    });
  };

  let cursor = 0;
  async function worker() {
    while (cursor < files.length && !stopped) {
      const idx = cursor++;
      const f = files[idx];
      const rel = safeRel(f.relative_path || f.name, f.key ? f.key.split('/').pop() : 'file');
      const target = path.join(destDir, rel);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      const size = Number(f.size) || 0;
      emit({ t: 'log', m: `(${idx + 1}/${files.length}) ${rel}  ${human(size)}` });
      try {
        const info = await presign(code, f.key, password);
        let res;
        let usedAria2 = false;

        if (aria2Path && fs.existsSync(aria2Path)) {
          try {
            usedAria2 = true;
            res = await downloadWithAria2({
              aria2Path,
              url: info.url,
              target,
              size,
              onProgress: ({ delta, speed }) => {
                if (delta > 0) tick(delta, speed);
              },
              shouldStop
            });
          } catch (ariaErr) {
            emit({ t: 'log', m: `    aria2c 异常（${ariaErr.message}），自动切换为内置引擎下载...` });
            usedAria2 = false;
          }
        }

        if (!res) {
          res = await downloadFile({ url: info.url, target, size, onBytes: tick, shouldStop });
        }

        saved.push(target);
        emit({ t: 'file', name: rel, path: target, size: res.size });
        emit({ t: 'log', m: `    完成：${target}` + (usedAria2 ? ' (aria2c 16并发极速)' : '') });
      } catch (e) {
        errors.push(`${rel}: ${e.message}`);
        emit({ t: 'log', m: `    失败：${rel} — ${e.message}` });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(workers, files.length) }, worker));

  let zipPath = null;
  if (wantZip && saved.length && !errors.length) {
    if (totalBytes > ZIP_MAX_BYTES) {
      emit({ t: 'log', m: `合计超过 ${human(ZIP_MAX_BYTES)}，跳过打包（文件已分别保存）` });
    } else {
      zipPath = path.join(destDir, `sendgb-${code}.zip`);
      emit({ t: 'log', m: `正在打包：${zipPath}` });
      try {
        await zipFiles(zipPath, saved, destDir);
        emit({ t: 'file', name: path.basename(zipPath), path: zipPath, size: fs.statSync(zipPath).size, zip: true });
      } catch (e) {
        zipPath = null;
        emit({ t: 'log', m: `打包失败：${e.message}（文件已分别保存）` });
      }
    }
  }

  if (errors.length) {
    emit({ t: 'error', m: `${errors.length} 个文件下载失败：${errors.join('；')}`, partial: true, dir: destDir, files: saved });
    return 1;
  }
  const totalDuration = Math.round((Date.now() - taskStartedAt) / 1000);
  const durStr = formatElapsed(totalDuration);
  emit({ t: 'progress', p: 100, eta: '', m: `下载完成（共 ${human(totalBytes)}，耗时 ${durStr}）` });
  emit({ t: 'done', dir: destDir, files: saved, zip: zipPath, duration: totalDuration, durationStr: durStr });
  return 0;
}

main()
  .then((code) => process.exit(code || 0))
  .catch((e) => {
    emit({ t: 'error', m: e && e.message ? e.message : String(e) });
    process.exit(1);
  });
