/* ============================================================
   竹知了桌宠 —— 鼠标指针变成玩具（全屏版）
   仿 https://github.com/imsai-sh/zhuzhiliao
   玩法：长按左键晃动甩起来就哇哇叫，转得越快叫得越响；右键退出
   窗口铺满光标所在显示器，竹蝉画在光标位置，甩动不会出界
   声学：Web Audio 合成链（锯齿波 → 调幅 → 扫频带通 → 膜腔共振峰）
   ============================================================ */
'use strict';

if (!('roundRect' in CanvasRenderingContext2D.prototype)) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    r = Math.min(Math.abs(+r) || 0, w / 2, h / 2);
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + r, y, r);
    this.closePath();
    return this;
  };
}

var TAU = Math.PI * 2;
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
var FONT = '"Songti SC","Noto Serif SC","STSong","SimSun",serif';

var cv = document.getElementById('cv');
var ctx = cv.getContext('2d');
var W = 0, H = 0, DPR = 1;

/* ---------- 玩具参数 ---------- */
var ROPE_LEN = 150;
var ROPE_K = 2600;
var ROPE_D = 14;
var GRAV = 1150;
var AIR_DRAG = 0.35;

/* ---------- 状态 ---------- */
var stick = { x: 0, y: 0 };              // 竹签杆梢（锚点 = 光标位置）
var tube = { x: 0, y: 0, vx: 0, vy: 0 }; // 竹蝉（绳系质点）
var held = false;                        // 是否按住左键
var theta = 0, prevTheta = 0, omega = 0;
var ropeDist = ROPE_LEN, taut = 0;
var rps = 0, drive = 0, active = 0;
var interacted = false;
var hintAlpha = 1;
var stickGrad = null, tubeGrad = null;
var winX = 0, winY = 0;

/* ---------- 光标跟踪（DIP 坐标） ----------
   ztools.getCursorScreenPoint / getDisplayNearestPoint / getPrimaryDisplay 经主进程
   Electron screen 提供，macOS / Windows 上都安全。唯一要在 Windows 上才调用的是
   screenToDipPoint（把物理像素换算成 DIP），macOS 上调用它会触发主进程崩溃，所以必须跳过。 */
var Z = window.ztools;
var IS_WIN = (typeof process !== 'undefined' && process.platform === 'win32') ||
             /win/i.test(navigator.platform || '');

function getCursor() {
  if (Z && Z.getCursorScreenPoint) {
    try {
      var p = Z.getCursorScreenPoint();
      if (IS_WIN && Z.screenToDipPoint) p = Z.screenToDipPoint(p);
      return p;
    } catch (e) {}
  }
  return null;
}

/* 让窗口铺满光标所在的显示器；跨屏时自动跟随。
   pt 为当前光标点（DIP）。getDisplayNearestPoint 是同步 IPC，做 250ms 节流，
   显示器切换不频繁，避免每帧同步调用拖慢渲染。 */
var lastDispCheckAt = -999999;
function syncWindow(pt) {
  if (!pt) return;
  var b = null;
  var now = performance.now();
  if (Z && Z.getDisplayNearestPoint && now - lastDispCheckAt > 250) {
    lastDispCheckAt = now;
    try {
      var d = Z.getDisplayNearestPoint({ x: pt.x, y: pt.y });
      if (d && d.bounds) b = d.bounds;
    } catch (e) {}
  }
  if (!b && Z && Z.getPrimaryDisplay) {
    try {
      var p = Z.getPrimaryDisplay();
      if (p && p.bounds) b = p.bounds;
    } catch (e) {}
  }
  if (!b) return;
  var need = Math.abs(window.innerWidth - b.width) > 1 ||
             Math.abs(window.innerHeight - b.height) > 1 ||
             Math.abs(winX - b.x) > 1 ||
             Math.abs(winY - b.y) > 1;
  if (need) {
    winX = Math.round(b.x);
    winY = Math.round(b.y);
    try {
      window.moveTo(winX, winY);
      window.resizeTo(b.width, b.height);
    } catch (e) {}
  }
}

function resize() {
  if (!(window.innerWidth > 0 && window.innerHeight > 0)) return;
  DPR = Math.min(1.5, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  var minDim = Math.min(W, H);
  ROPE_LEN = clamp(minDim * 0.22, 120, 240);
  if (!interacted) {
    stick.x = W * 0.5; stick.y = H * 0.42;
    tube.x = stick.x + 8;
    tube.y = stick.y + ROPE_LEN * 0.9;
    tube.vx = 0; tube.vy = 0;
    prevTheta = Math.atan2(tube.y - stick.y, tube.x - stick.x);
  } else {
    stick.x = clamp(stick.x, 0, W); stick.y = clamp(stick.y, 0, H);
  }
}

/* ============================================================
   声音 —— Web Audio 合成链
   ============================================================ */
var AC = null, au = null;

function ensureAudio() {
  if (AC) {
    if (AC.state !== 'running') AC.resume().catch(function () {});
    return;
  }
  var Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  AC = new Ctx();
  AC.resume().catch(function () {});

  var master = AC.createGain(); master.gain.value = 0;
  var comp = AC.createDynamicsCompressor();
  comp.threshold.value = -18; comp.ratio.value = 8;
  comp.attack.value = 0.004; comp.release.value = 0.18;
  master.connect(comp); comp.connect(AC.destination);
  au = { master: master, mode: 'synth' };
  startSynthVoice();
}

function startSynthVoice() {
  if (!AC || !au) return;
  var t = AC.currentTime;

  var osc = AC.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = 70;
  var shaper = AC.createWaveShaper();
  {
    var n = 1024, curve = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var x = i / (n - 1) * 2 - 1;
      curve[i] = Math.tanh(x * 3.2);
    }
    shaper.curve = curve;
    shaper.oversample = '2x';
  }
  osc.connect(shaper);

  var am = AC.createGain(); am.gain.value = 0.62;
  var lfo = AC.createOscillator();
  lfo.type = 'sine'; lfo.frequency.value = 30;
  var lfoAmt = AC.createGain(); lfoAmt.gain.value = 0.34;
  lfo.connect(lfoAmt); lfoAmt.connect(am.gain);
  shaper.connect(am);

  var nBuf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
  var nd = nBuf.getChannelData(0);
  for (i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  var noise = AC.createBufferSource();
  noise.buffer = nBuf; noise.loop = true;
  var nFil = AC.createBiquadFilter();
  nFil.type = 'bandpass'; nFil.frequency.value = 2500; nFil.Q.value = 0.7;
  var nGain = AC.createGain(); nGain.gain.value = 0;
  noise.connect(nFil); nFil.connect(nGain);

  var bus = AC.createGain(); bus.gain.value = 0.9;
  am.connect(bus); nGain.connect(bus);
  var wah = AC.createBiquadFilter();
  wah.type = 'bandpass'; wah.frequency.value = 900; wah.Q.value = 2.2;
  bus.connect(wah);

  var sum = AC.createGain(); sum.gain.value = 1;
  var formant = function (freq, q, g) {
    var f = AC.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    var fg = AC.createGain(); fg.gain.value = g;
    wah.connect(f); f.connect(fg); fg.connect(sum);
  };
  formant(1050, 9, 0.9);
  formant(2150, 11, 0.6);
  formant(3350, 13, 0.4);
  var bleed = AC.createGain(); bleed.gain.value = 0.07;
  wah.connect(bleed); bleed.connect(sum);

  var hp = AC.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 360;
  sum.connect(hp); hp.connect(au.master);

  osc.start(t); lfo.start(t); noise.start(t);
  Object.assign(au, { osc: osc, lfo: lfo, nGain: nGain, wah: wah });
  au.mode = 'synth';
}

function updateAudio() {
  if (!AC || AC.state !== 'running' || !au || au.mode !== 'synth') return;
  var t = AC.currentTime;
  au.master.gain.setTargetAtTime(0.85 * Math.pow(active, 1.3), t, 0.07);

  var f0 = clamp(55 + rps * 17, 50, 195);
  au.osc.frequency.setTargetAtTime(f0, t, 0.06);
  au.osc.detune.setTargetAtTime(46 * Math.sin(theta + 0.9) * clamp(active * 1.6, 0, 1), t, 0.03);
  au.lfo.frequency.setTargetAtTime(24 + rps * 4.5, t, 0.1);
  var wf = 760 + 520 * active + (430 + 330 * active) * Math.sin(theta - 0.7);
  au.wah.frequency.setTargetAtTime(Math.max(320, wf), t, 0.025);
  au.nGain.gain.setTargetAtTime((0.03 + 0.17 * active) * clamp(drive * 4, 0, 1), t, 0.08);
}

/* ============================================================
   物理 —— 绳系质点（重力 + 只拉不推的弹性绳 + 空气阻力）
   ============================================================ */
function physStep(h) {
  var dx = tube.x - stick.x, dy = tube.y - stick.y;
  var d = Math.hypot(dx, dy) || 1e-6;
  var ux = dx / d, uy = dy / d;
  var ax = 0, ay = GRAV;
  if (d > ROPE_LEN) {
    var vrad = tube.vx * ux + tube.vy * uy;
    var f = -ROPE_K * (d - ROPE_LEN) - ROPE_D * vrad;
    ax += f * ux; ay += f * uy;
  }
  ax -= AIR_DRAG * tube.vx;
  ay -= AIR_DRAG * tube.vy;
  tube.vx += ax * h; tube.vy += ay * h;
  tube.x += tube.vx * h; tube.y += tube.vy * h;
}

function update(dt) {
  var acc = dt;
  var h = 1 / 240;
  while (acc > 1e-6) { var s = Math.min(h, acc); physStep(s); acc -= s; }

  // 角速度（发声核心）：绳方向的转动快慢
  theta = Math.atan2(tube.y - stick.y, tube.x - stick.x);
  var dth = theta - prevTheta;
  while (dth >  Math.PI) dth -= TAU;
  while (dth < -Math.PI) dth += TAU;
  omega += (dth / dt - omega) * Math.min(1, dt * 9);
  prevTheta = theta;
  rps = Math.abs(omega) / TAU;

  // 甩出的圈数累计
  if (held && active > 0.3) {
    // 每满一圈记一哇（保留计数逻辑，后续可用）
  }

  ropeDist = Math.hypot(tube.x - stick.x, tube.y - stick.y);
  taut = clamp((ropeDist / ROPE_LEN - 0.88) / 0.12, 0, 1);
  var raw = clamp((rps - 1.1) / 2.6, 0, 1);
  var gate = held || active > 0.05;
  drive = gate ? raw : 0;
  var tgt = Math.pow(drive, 1.25) * taut;
  active += (tgt - active) * Math.min(1, dt * (tgt > active ? 10 : 3.2));

  if (interacted && hintAlpha > 0) hintAlpha = Math.max(0, hintAlpha - dt * 0.6);

  updateAudio();
  spawnFx(dt);
}

/* ============================================================
   粒子：轨迹残影 + 声波涟漪 + 飘出的「哇」
   ============================================================ */
var ripples = [];
var cries = [];
var trail = [];
var rippleTimer = 0, cryTimer = 0;

function spawnFx(dt) {
  trail.unshift({ x: tube.x, y: tube.y });
  if (trail.length > 16) trail.pop();

  rippleTimer -= dt; cryTimer -= dt;
  if (active > 0.15 && rippleTimer <= 0) {
    rippleTimer = 0.09;
    ripples.push({ x: tube.x, y: tube.y, r: 16, age: 0, life: 0.7, str: active });
  }
  if (active > 0.3 && cryTimer <= 0 && cries.length < 36) {
    cryTimer = 0.22;
    var ux = (tube.x - stick.x) / (ropeDist || 1);
    var uy = (tube.y - stick.y) / (ropeDist || 1);
    var sgn = omega >= 0 ? 1 : -1;
    var tx = -uy * sgn, ty = ux * sgn;
    var sp = 90 + Math.random() * 60;
    cries.push({
      x: tube.x + ux * 14, y: tube.y + uy * 14,
      vx: tx * sp + ux * 30, vy: ty * sp + uy * 30 - 20,
      age: 0, life: 1.1,
      size: 20 + 30 * active,
      rot: (Math.random() - 0.5) * 0.8
    });
  }
  for (var i = ripples.length - 1; i >= 0; i--) {
    var p = ripples[i];
    p.age += dt; p.r += (200 + 160 * p.str) * dt;
    if (p.age >= p.life) ripples.splice(i, 1);
  }
  for (i = cries.length - 1; i >= 0; i--) {
    p = cries[i];
    p.age += dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= (1 - dt * 1.2); p.vy = p.vy * (1 - dt * 1.2) - 26 * dt;
    if (p.age >= p.life) cries.splice(i, 1);
  }
}

/* ============================================================
   绘制 —— 竹签 + 线 + 竹蝉
   ============================================================ */
function drawToy(now) {
  var dx = tube.x - stick.x, dy = tube.y - stick.y;
  var d = Math.hypot(dx, dy) || 1e-6;
  var ux = dx / d, uy = dy / d;

  // 线：松则垂，紧则直
  ctx.strokeStyle = 'rgba(216,74,53,0.92)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(stick.x, stick.y);
  if (d < ROPE_LEN * 0.97) {
    var sag = (ROPE_LEN - d) * 0.55;
    ctx.quadraticCurveTo((stick.x + tube.x) / 2, (stick.y + tube.y) / 2 + sag, tube.x, tube.y);
  } else {
    ctx.lineTo(tube.x, tube.y);
  }
  ctx.stroke();

  // 甩杆：细竹签，杆梢串两颗红珠
  var sa = 1.15;
  var sdx = Math.cos(sa), sdy = Math.sin(sa);
  ctx.save();
  ctx.translate(stick.x, stick.y);
  if (!stickGrad) {
    stickGrad = ctx.createLinearGradient(0, 0, sdx * 88, sdy * 88);
    stickGrad.addColorStop(0, '#e2cd9a'); stickGrad.addColorStop(1, '#a8894f');
  }
  ctx.strokeStyle = stickGrad;
  ctx.lineWidth = 5; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sdx * 8, sdy * 8);
  ctx.lineTo(sdx * 88, sdy * 88);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,240,200,0.35)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(sdx * 12 - sdy * 1.4, sdy * 12 + sdx * 1.4);
  ctx.lineTo(sdx * 76 - sdy * 1.4, sdy * 76 + sdx * 1.4);
  ctx.stroke();
  var bead = function (bx, by, r) {
    ctx.fillStyle = '#c23324';
    ctx.beginPath(); ctx.arc(bx, by, r, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,200,180,0.55)';
    ctx.beginPath(); ctx.arc(bx - r * 0.3, by - r * 0.35, r * 0.32, 0, TAU); ctx.fill();
  };
  bead(sdx * 14, sdy * 14, 4.6);
  bead(sdx * 4, sdy * 4, 6);
  ctx.restore();

  // 竹蝉：膜端(头)朝线，筒身沿绳方向甩出
  ctx.save();
  ctx.translate(tube.x, tube.y);
  ctx.rotate(Math.atan2(uy, ux) - Math.PI / 2);
  ctx.scale(1.5, 1.5);

  if (!tubeGrad) {
    tubeGrad = ctx.createLinearGradient(-12, 0, 12, 0);
    tubeGrad.addColorStop(0, '#b7a271');
    tubeGrad.addColorStop(0.3, '#eadfb8');
    tubeGrad.addColorStop(0.62, '#dfd0a2');
    tubeGrad.addColorStop(1, '#9b8452');
  }
  ctx.fillStyle = tubeGrad;
  ctx.beginPath();
  ctx.roundRect(-12, 4, 24, 46, 6);
  ctx.fill();

  // 尾端开口
  ctx.fillStyle = '#4c3d24';
  ctx.beginPath(); ctx.ellipse(0, 49, 11, 4.2, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(234,223,184,0.6)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.ellipse(0, 49, 11, 4.2, 0, 0.05, Math.PI - 0.05); ctx.stroke();

  // 竹蝉翼：转得越快离心张得越开，高频振翅
  var spread = 0.30 + active * 0.38;
  var flutter = active * Math.sin(now * 46) * 0.22;
  var wing = function (side) {
    ctx.save();
    ctx.translate(side * 9, 13);
    ctx.rotate(side * (spread + flutter));
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(side * 13, 9, side * 14, 30, side * 5, 42);
    ctx.bezierCurveTo(side * -1, 33, side * -4, 12, 0, 0);
    ctx.fillStyle = 'rgba(243,235,211,0.88)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,120,70,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(150,120,70,0.45)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(side * 2, 4); ctx.quadraticCurveTo(side * 9, 18, side * 5, 38);
    ctx.moveTo(side * 1, 6); ctx.quadraticCurveTo(side * 3, 20, side * 1.5, 34);
    ctx.stroke();
    ctx.restore();
  };
  wing(-1); wing(1);

  // 红箍(蝉头)
  ctx.fillStyle = '#cf3b2a';
  ctx.beginPath();
  ctx.roundRect(-12.5, 2, 25, 10, 4);
  ctx.fill();

  // 膜面 + 发声时透光
  ctx.fillStyle = '#f6eed8';
  ctx.beginPath(); ctx.ellipse(0, 3, 10.5, 4.2, 0, 0, TAU); ctx.fill();
  if (active > 0.05) {
    ctx.globalAlpha = active * 0.85;
    ctx.shadowColor = '#ffcf8e'; ctx.shadowBlur = 18 * active;
    ctx.fillStyle = '#ffe9bd';
    ctx.beginPath(); ctx.ellipse(0, 3, 8.5, 3.4, 0, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }

  // 一双黑眼睛
  var eye = function (side) {
    ctx.fillStyle = '#17130c';
    ctx.beginPath(); ctx.arc(side * 8.5, 7.5, 2.4, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath(); ctx.arc(side * 8.5 - 0.7, 6.8, 0.7, 0, TAU); ctx.fill();
  };
  eye(-1); eye(1);

  // 膜心线结
  ctx.fillStyle = '#d84a35';
  ctx.beginPath(); ctx.arc(0, 2, 2, 0, TAU); ctx.fill();

  ctx.restore();
}

function draw(now, dt) {
  ctx.clearRect(0, 0, W, H);

  // 运动残影
  var spNorm = clamp(rps / 4, 0, 1);
  if (spNorm > 0.05 && trail.length > 2) {
    ctx.fillStyle = '#ffb36b';
    for (var i = 1; i < trail.length; i++) {
      var f = 1 - i / trail.length;
      ctx.globalAlpha = f * 0.3 * spNorm;
      ctx.beginPath();
      ctx.arc(trail[i].x, trail[i].y, 1.5 + 3.5 * f, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawToy(now);

  // 声波涟漪
  for (i = 0; i < ripples.length; i++) {
    var p = ripples[i];
    var t = p.age / p.life;
    ctx.globalAlpha = (1 - t) * 0.35 * p.str;
    ctx.strokeStyle = '#ffcf9e'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 飘出的「哇」
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (i = 0; i < cries.length; i++) {
    p = cries[i];
    t = p.age / p.life;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot * t);
    ctx.globalAlpha = (1 - t) * (1 - t) * 0.95;
    ctx.font = (p.size * (1 + 0.5 * t)).toFixed(1) + 'px ' + FONT;
    ctx.shadowColor = 'rgba(255,150,60,0.9)';
    ctx.shadowBlur = 18 * (1 - t);
    ctx.fillStyle = '#ffb066';
    ctx.fillText('哇', 0, 0);
    ctx.shadowBlur = 0;
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // 提示文字（首次交互后淡出）
  if (hintAlpha > 0) {
    ctx.globalAlpha = hintAlpha * (0.5 + 0.5 * Math.sin(now * 3));
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '13px ' + FONT;
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 4;
    ctx.fillStyle = '#f0e6d2';
    ctx.fillText('长按左键甩起来 · 右键退出', W * 0.5, H * 0.12);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
}

/* ============================================================
   输入
   ============================================================ */
function exit() {
  try { window.close(); } catch (e) {}
  try { if (Z && Z.outPlugin) Z.outPlugin(true); } catch (e) {}
}

document.addEventListener('mousedown', function (e) {
  if (e.button === 2) { exit(); return; }
  if (e.button === 0) {
    held = true;
    interacted = true;
    ensureAudio();
  }
});

document.addEventListener('mouseup', function (e) {
  if (e.button === 0) held = false;
});

document.addEventListener('contextmenu', function (e) {
  e.preventDefault();
  exit();
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') exit();
});

window.addEventListener('blur', function () {
  held = false;
});

/* ============================================================
   主循环
   ============================================================ */
var lastNow = 0;
function frame(now) {
  if (window.innerWidth > 0 && (window.innerWidth !== W || window.innerHeight !== H)) resize();
  var dt = Math.min(0.05, (now - lastNow) / 1000) || 0.016;
  lastNow = now;

  var pt = getCursor();
  syncWindow(pt);
  if (pt) {
    // 用窗口真实屏幕位置换算窗口内坐标（macOS 上窗口会被菜单栏/安全区约束，
    // 实际 screenY 可能比请求的 bounds.y 大，必须读真实值，否则竹蝉会偏离光标）
    var sx = 0, sy = 0;
    try { sx = window.screenX || 0; sy = window.screenY || 0; } catch (e) {}
    stick.x = pt.x - sx;
    stick.y = pt.y - sy;
  }

  update(dt);
  draw(now / 1000, dt);
  requestAnimationFrame(frame);
}

try {
  winX = window.screenX || 0;
  winY = window.screenY || 0;
} catch (e) {}
resize();
requestAnimationFrame(function (now) {
  lastNow = now;
  requestAnimationFrame(frame);
});
