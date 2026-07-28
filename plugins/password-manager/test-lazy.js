// 懒加载/分页后端验证：listHosts 仅返元数据 + revealHosts 按页解密
// 隔离 DB：复制 preload.js 把 DB 路径改到临时目录，绝不碰用户 passwords.db
const fs = require('fs');
const path = require('path');
const os = require('os');

const srcDir = __dirname;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-lazy-'));
const tmpDbDir = path.join(tmpDir, 'data');
fs.mkdirSync(tmpDbDir, { recursive: true });
fs.cpSync(path.join(srcDir, 'vendor'), path.join(tmpDir, 'vendor'), { recursive: true });

let src = fs.readFileSync(path.join(srcDir, 'preload.js'), 'utf8');
src = src.replace(
  "path.join(__dirname, 'passwords.db')",
  "path.join('" + tmpDbDir.replace(/\\/g, '\\\\') + "', 'passwords.db')"
);
fs.writeFileSync(path.join(tmpDir, 'preload.js'), src);

global.window = {
  ztools: {
    getNativeId: () => 'test-device-lazy',
    isDarkColors: () => false,
    onPluginEnter: () => {},
    onMainPush: () => {},
  },
};

const { pmApi } = require(path.join(tmpDir, 'preload.js'));

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } }

(async () => {
  await pmApi.setup('master-pw');

  await pmApi.addHost('10.0.0.1', 'DB-A', [
    { label: 'user', value: 'root' },
    { label: 'pass', value: 's3cret1' },
    { label: 'port', value: '3306' },
  ]);
  await pmApi.addHost('10.0.0.2', 'Web-B', [
    { label: 'pass', value: 's3cret2' },           // 不同字段集（缺 user/port）
    { label: 'url',  value: 'https://b.local' },
  ]);

  console.log('\n[1] listHosts 仅返回元数据（无 value / fields）');
  const list = await pmApi.listHosts();
  ok(Array.isArray(list) && list.length === 2, '返回 2 台主机');
  ok(!('value' in (list[0] || {})), '单条不含明文 value 字段');
  ok(!('fields' in (list[0] || {})), '单条不含 fields 字段（旧结构）');
  ok(list[0].ip === '10.0.0.1' && list[0].name === 'DB-A', 'ip/name 正确');
  ok(JSON.stringify(list[0].labels) === JSON.stringify(['user', 'pass', 'port']), 'labels 顺序与录入一致');
  ok(JSON.stringify(list[1].labels) === JSON.stringify(['pass', 'url']), '第二台 labels 独立（缺 user/port）');

  console.log('\n[2] revealHosts 按 IP 批量懒解密');
  const one = await pmApi.revealHosts(['10.0.0.1']);
  ok(Object.keys(one).length === 1 && one['10.0.0.1'], '只解密请求的 1 台');
  ok(one['10.0.0.1'].user === 'root' && one['10.0.0.1'].pass === 's3cret1' && one['10.0.0.1'].port === '3306', '值解密正确');

  const both = await pmApi.revealHosts(['10.0.0.1', '10.0.0.2']);
  ok(both['10.0.0.2'].pass === 's3cret2' && both['10.0.0.2'].url === 'https://b.local', '第二台值解密正确');
  ok(!both['10.0.0.2'].user, '第二台缺的字段不出现（undefined）');

  console.log('\n[3] revealHosts 空列表安全');
  const empty = await pmApi.revealHosts([]);
  ok(empty && Object.keys(empty).length === 0, '空 IP 列表返回空对象');

  console.log('\n[4] 分页语义：revealHosts 只解密当前页 IP（模拟）');
  // 1001 台，revealHosts 只传第 1 页 50 个，不应触碰其余
  for (let i = 3; i <= 1001; i++) {
    await pmApi.addHost('10.0.' + Math.floor(i / 254) + '.' + (i % 254), 'H' + i, [{ label: 'k', value: 'v' + i }]);
  }
  const all = await pmApi.listHosts();
  ok(all.length === 1001, '共 1001 台（含导入）');
  const pageIps = all.slice(0, 50).map(h => h.ip);
  const t0 = Date.now();
  const pageVals = await pmApi.revealHosts(pageIps);
  const dt = Date.now() - t0;
  ok(Object.keys(pageVals).length === 50, '仅解密当前页 50 台');
  ok(dt < 1500, '单页解密耗时 ' + dt + 'ms (<1500)');

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  // 清理临时目录
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
