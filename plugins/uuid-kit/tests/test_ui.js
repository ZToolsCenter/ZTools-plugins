'use strict';
const fs = require('fs');
const vm = require('vm');

function el() {
  let html = '';
  const e = {
    children: [], textContent: '', value: '', className: '',
    style: {}, classList: { add() {}, remove() {}, toggle() {} },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() {}, querySelector() { return el(); },
    select() {}, remove() {},
  };
  Object.defineProperty(e, 'innerHTML', {
    get: () => html,
    set: (v) => { html = v; if (v === '') e.children.length = 0; },
  });
  return e;
}
const els = {};
const ctx = {
  window: {}, console, TextEncoder, BigInt, Number, Math, Date, crypto: require('crypto').webcrypto,
  clearTimeout, setTimeout,
  document: {
    getElementById: (id) => (els[id] = els[id] || el()),
    createElement: () => el(),
    addEventListener() {},
    body: Object.assign(el(), { classList: { add() {}, remove() {}, toggle() {} } }),
  },
  navigator: {},
};
ctx.globalThis = ctx;
vm.createContext(ctx);

const core = fs.readFileSync(require('path').join(__dirname, '../uuid-core.js'), 'utf8');
vm.runInContext(core, ctx, { filename: 'uuid-core.js' });

const html = fs.readFileSync(require('path').join(__dirname, '../index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (scripts.length !== 1) throw new Error('expected exactly 1 inline script, got ' + scripts.length);
vm.runInContext(scripts[0], ctx, { filename: 'index-inline.js' });

// Drive every view through the real run() and check rendered rows.
const assert = require('assert');
const run = ctx.run;
const rows = () => els.out.children.filter((c) => c.className.includes('row'));

run('');                                          // hint
assert.ok(els.out.innerHTML.includes('uuid5 dns'), 'hint view');

run('user-1F2krUyRcqDfa3cNxwq76q', false);        // parse decode
const vals = rows().map((r) => r.children ? '' : '').length; // rows are appended els
assert.ok(rows().length >= 6, 'decode rows, got ' + rows().length);
assert.strictEqual(els.badge.textContent, '短 id → UUID');
assert.ok(els.meta.textContent.includes('UUIDv4'), 'meta version, got ' + els.meta.textContent);

run('28d463fe-1b43-45fa-8346-a08ff924c724', false); // parse encode
assert.strictEqual(els.badge.textContent, 'UUID → 短 id');

run('uuid7', false);                                // gen single
assert.ok(els.badge.textContent.includes('UUIDv7'), els.badge.textContent);
assert.ok(els.meta.textContent.match(/\d{4}-\d{2}-\d{2}/), 'v7 timestamp in meta');

run('uuid4 x10', false);                            // gen batch
assert.ok(els.badge.textContent.includes('× 10'), els.badge.textContent);
assert.strictEqual(rows().length, 11, 'batch rows+action, got ' + rows().length);

run('uuid5 dns example.com', false);                // deterministic
assert.ok(els.badge.textContent.includes('确定性'), els.badge.textContent);

run('KNRj_htDRfqDRqCP-STHJA', false);               // base64url decode
assert.strictEqual(els.badge.textContent, '短 id → UUID');

run('uuid62', false);                               // keyword itself -> error is wrong; expect graceful
console.log('uuid62 keyword view badge:', els.badge.textContent);

run('not/valid!!', false);                          // garbage
assert.strictEqual(els.badge.textContent, '无法识别');

// fmtTime must render pre-1970 timestamps sanely (v1 epoch is 1582).
assert.ok(ctx.fmtTime(-500).endsWith('.500'), 'negative ms: ' + ctx.fmtTime(-500));

console.log('UI SMOKE PASSED');
