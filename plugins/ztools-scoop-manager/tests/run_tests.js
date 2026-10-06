/**
 * Scoop 包管理器 · 测试
 *   node tests/run_tests.js            —— 纯函数测试（vm 沙箱加载 preload，不需要 scoop）
 *   node tests/run_tests.js --live     —— 追加真实命令冒烟（调用本机 scoop，联网可能较慢）
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// ---------- vm 沙箱加载 preload.js ----------
// 与 ztools-weather 的测试同款做法：preload 依赖 window/document/require/process，
// 沙箱里给最小桩。window.ztools 全部 no-op，纯函数测试不碰系统能力。
function loadPreload() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const ztoolsStub = {
    setExpendHeight() {}, showMainWindow() {}, showNotification() {}, showToast() {},
    copyText() {}, shellOpenExternal() {}, shellOpenPath() {},
    isDarkColors() { return false; }
  };
  const sandbox = {
    window: { ztools: ztoolsStub },
    console,
    process,
    require,
    Buffer,
    setTimeout, clearTimeout, setInterval, clearInterval,
    __dirname: path.join(__dirname, '..'),
    module: { exports: {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'preload.js' });
  return sandbox.module.exports;
}

const S = loadPreload();
let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + (e && e.message)); }
}

// ---------- extractJson：从混杂输出里抽 JSON ----------
console.log('extractJson');
t('剥掉表头与告警行，取出数组', () => {
  const out = 'Installed apps:\nWARN Scoop bucket(s) out of date.\n[{"Name":"7zip","Version":"26.03"}]';
  const r = S.extractJson(out);
  assert.strictEqual(r.data[0].Name, '7zip');
  // "Installed apps:" 是表头不该进 warnings，WARN 才该进
  // vm 沙箱里的数组来自另一个 realm，原型不等，deepStrictEqual 会误报；用字符串比
  assert.strictEqual(JSON.stringify(r.warnings), JSON.stringify(['WARN Scoop bucket(s) out of date.']));
});
t('对象形态也能抽', () => {
  const r = S.extractJson('fatal: unable to access ...\n{"Name":"git"}');
  assert.strictEqual(r.data.Name, 'git');
  assert.strictEqual(r.warnings.length, 1);
});
t('没有 JSON 时报错且错误可读', () => {
  assert.throws(() => S.extractJson('scoop : 无法将"scoop"项识别为 cmdlet'), /JSON/);
});
t('前缀行含方括号（非 JSON 开头）不误判', () => {
  const out = '下载 [====================] 100%\n[{"Name":"a"}]';
  const r = S.extractJson(out);
  assert.strictEqual(r.data[0].Name, 'a');
  // "下载 [====..." 是进度行，会留在 warnings 里（页面只展示，不影响数据）
});

// ---------- parseScoopDate：三种日期形态 ----------
console.log('parseScoopDate');
t('/Date(ms)/ 字符串', () => {
  assert.strictEqual(S.parseScoopDate('/Date(1788914656051)/'), 1788914656051);
});
t('对象形态（bucket list 的 Updated）', () => {
  assert.strictEqual(S.parseScoopDate({ value: '/Date(1790743030000)/' }), 1790743030000);
});
t('普通日期串与空值', () => {
  assert.ok(S.parseScoopDate('2026-09-09 08:44:16') > 0);
  assert.strictEqual(S.parseScoopDate(''), 0);
  assert.strictEqual(S.parseScoopDate(null), 0);
});

// ---------- assertApp：防 PS 注入的唯一防线 ----------
console.log('assertApp');
t('合法名：常规 / 带 @版本 / 带下划线连字符', () => {
  assert.strictEqual(S.assertApp('7zip'), '7zip');
  assert.strictEqual(S.assertApp('7zip@16.04'), '7zip@16.04');
  assert.strictEqual(S.assertApp('7zip-beta_DoveBoy'), '7zip-beta_DoveBoy');
});
t('拒绝命令注入', () => {
  assert.throws(() => S.assertApp('a; Remove-Item C:\\'), /非法/);
  assert.throws(() => S.assertApp('a | Format-Volume'), /非法/);
  assert.throws(() => S.assertApp('$(calc)'), /非法/);
  assert.throws(() => S.assertApp('a b'), /非法/);           // 空格（多参数）不允许
  assert.throws(() => S.assertApp('-Expression x'), /非法/); // 连字符开头会被当 scoop 参数
  assert.throws(() => S.assertApp(''), /非法/);
});

// ---------- bucket 来源校验 ----------
// assertBucketSource 没直接导出，经 addBucket 走会真执行命令，这里用等价正则在本文件复刻校验
console.log('bucket source 校验规则');
t('URL / 官方短名 / 本机路径都合法（正则复刻）', () => {
  const URL_RE = /^https?:\/\/\S{1,300}$/;
  const NAME_RE = /^[\w.-]{1,64}$/;
  const PATH_RE = /^[A-Za-z]:[\\/]\S{0,299}$/;
  assert.ok(URL_RE.test('https://github.com/ScoopInstaller/Extras'));
  assert.ok(NAME_RE.test('extras'));
  assert.ok(PATH_RE.test('D:\\buckets\\my'));
  assert.ok(!URL_RE.test('file://x') && !NAME_RE.test('a b') && !PATH_RE.test('relative/path'));
});

// ---------- 安装脚本（TLS/镜像/代理/管理员四件套） ----------
console.log('installScript');
t('通用骨架：TLS1.2 + try/catch 执行策略 + 管理员分支', () => {
  for (const mirror of [true, false]) {
    const s = S.installScript('', mirror);
    assert.ok(/SecurityProtocol.*Tls12/.test(s), '应强制 TLS1.2');
    assert.ok(/try \{ Set-ExecutionPolicy/.test(s), '执行策略应包在 try/catch 里');
    assert.ok(/-RunAsAdmin/.test(s), '应含管理员分支');
  }
});
t('镜像版：下载地址打镜像前缀补丁 + 安装器本体有镜像兜底', () => {
  const s = S.installScript('', true);
  assert.ok(s.indexOf("Replace(\"'https://github.com/\"") >= 0, '应包含 GitHub URL 前缀补丁');
  assert.ok(s.indexOf('https://scoop.201704.xyz/https://raw.githubusercontent.com') >= 0, '安装器本体应有镜像兜底下载');
  assert.ok(!/-Proxy /.test(s), '直连不应带 -Proxy');
});
t('官方版：不打补丁、不引镜像', () => {
  const s = S.installScript('', false);
  assert.ok(s.indexOf('scoop.201704.xyz') < 0, '官方版不应出现镜像地址');
  assert.ok(s.indexOf('.Replace(') < 0, '官方版不应打补丁');
});
t('代理版把 -Proxy 传给每个下载点', () => {
  // 官方版：irm 1 处 + installer 两个分支 = 3
  assert.strictEqual((S.installScript('http://127.0.0.1:7890', false).match(/-Proxy 'http:\/\/127\.0\.0\.1:7890'/g) || []).length, 3);
  // 镜像版：irm 的 try/catch 共 2 处 + installer 两个分支 = 4
  assert.strictEqual((S.installScript('http://127.0.0.1:7890', true).match(/-Proxy 'http:\/\/127\.0\.0\.1:7890'/g) || []).length, 4);
});

// ---------- bucket add 参数（1.3.2 丢名字 bug 的回归测试） ----------
console.log('bucketAddArgs');
t('名字 + 源都要传：scoop bucket add <name> <repo>', () => {
  const url = 'https://scoop.201704.xyz/https://github.com/ScoopInstaller/Nonportable';
  const args = S.bucketAddArgs('nonportable', url);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(args)), ['add', 'nonportable', url]);
  assert.ok(args.indexOf('（国内直连源）') < 0, '展示用文案绝不能混进参数');
});
t('只给名字（已知名 bucket）：不带第二个参数', () => {
  assert.strictEqual(JSON.stringify(S.bucketAddArgs('extras', '')), JSON.stringify(['add', 'extras']));
  assert.strictEqual(JSON.stringify(S.bucketAddArgs('main', 'main')), JSON.stringify(['add', 'main']));
});
t('非法名字仍然拒绝', () => {
  assert.throws(() => S.bucketAddArgs('a; calc', ''), /非法/);
});

// ---------- 清单镜像化（装软件层面的网络问题） ----------
console.log('mirrorize / deepMirrorize');
t('GitHub 各类域名打前缀，非 GitHub 一律不动', () => {
  const M = 'https://scoop.201704.xyz/';
  assert.strictEqual(S.mirrorize('https://github.com/a/b/releases/download/v1/x.zip'), M + 'https://github.com/a/b/releases/download/v1/x.zip');
  assert.strictEqual(S.mirrorize('https://raw.githubusercontent.com/a/b/master/x'), M + 'https://raw.githubusercontent.com/a/b/master/x');
  assert.strictEqual(S.mirrorize('https://objects.githubusercontent.com/x'), M + 'https://objects.githubusercontent.com/x');
  assert.strictEqual(S.mirrorize('https://www.7-zip.org/a/x.zip'), 'https://www.7-zip.org/a/x.zip');
  assert.strictEqual(S.mirrorize('https://github.cn-mirror.not/a'), 'https://github.cn-mirror.not/a'); // 前缀匹配而非包含
});
t('深遍历：数组、嵌套对象、hash 的 #sha256 后缀一起改', () => {
  const m = S.deepMirrorize({
    url: 'https://github.com/a/b/download/x.zip',
    architecture: { '64bit': { url: ['https://github.com/a/b/d/x.zip'], hash: ['https://github.com/a/b/d/x.zip#sha256'] } },
    license: 'MIT',
    note: 7
  });
  assert.strictEqual(m.url, 'https://scoop.201704.xyz/https://github.com/a/b/download/x.zip');
  assert.strictEqual(m.architecture['64bit'].hash[0], 'https://scoop.201704.xyz/https://github.com/a/b/d/x.zip#sha256');
  assert.strictEqual(m.license, 'MIT');
  assert.strictEqual(m.note, 7);
});

// ---------- 命令不存在识别（1.4.1 卸载 scoop 后误判在线的回归测试） ----------
console.log('looksLikeCommandNotFound');
t('中文 PowerShell 的 CommandNotFoundException 体裁', () => {
  const zh = "scoop : 无法将'scoop'项识别为 cmdlet、函数、脚本文件或可运行程序的名称。";
  assert.strictEqual(S.looksLikeCommandNotFound(zh), true);
});
t('英文 PowerShell 体裁与退出码文本', () => {
  assert.strictEqual(S.looksLikeCommandNotFound("The term 'scoop' is not recognized as the name of a cmdlet"), true);
  assert.strictEqual(S.looksLikeCommandNotFound("'scoop' 不是内部或外部命令，也不是可运行的程序"), true);
});
t('正常输出不误判', () => {
  assert.strictEqual(S.looksLikeCommandNotFound('Current Scoop version:\nv0.6.0 - Released at 2026-09-30'), false);
  assert.strictEqual(S.looksLikeCommandNotFound(''), false);
});

console.log('classifyDetect');
t('卸载场景：错误在 stderr（raw 里），判未安装', () => {
  const zhErr = "scoop : 无法将'scoop'项识别为 cmdlet、函数、脚本文件或可运行程序的名称。";
  const r = { data: [], warnings: [zhErr], empty: true, code: 1, raw: zhErr };
  assert.strictEqual(S.classifyDetect(r), 'not-found');
});
t('新装无 git 场景：版本行在宿主流，判在线（哪怕退出码非 0）', () => {
  const r = {
    data: [],
    warnings: ['Current Scoop version:', 'v0.6.0 - Released at 2026-09-30', "fatal: unable to access 'https://github.com...'"],
    empty: true, code: 1,
    raw: 'Current Scoop version:\nv0.6.0 - Released at 2026-09-30'
  };
  assert.strictEqual(S.classifyDetect(r), 'online');
});
t('空结果 + 退出码非 0 + 无版本号：判未安装（覆盖未知体裁）', () => {
  const r = { data: [], warnings: ['Some weird failure'], empty: true, code: 1, raw: 'Some weird failure' };
  assert.strictEqual(S.classifyDetect(r), 'not-found');
});
t('正常 JSON 数据：判在线', () => {
  const r = { data: [{ Name: '7zip' }], warnings: [], code: 0 };
  assert.strictEqual(S.classifyDetect(r), 'online');
});

// ---------- 实机冒烟（--live） ----------
if (process.argv.includes('--live')) {
  console.log('\n-- live（真实调用本机 scoop）--');
  (async () => {
    const d = await S.detect();
    console.log('  detect: v' + d.version + (d.warnings.length ? '  warnings=' + d.warnings.length : ''));
    assert.ok(d.ok && d.version !== '未知版本', 'detect 应拿到版本号');

    const inst = await S.installed();
    console.log('  installed: ' + inst.apps.length + ' 个应用，第一个=' +
      (inst.apps[0] ? inst.apps[0].name + '@' + inst.apps[0].version : '无'));
    assert.ok(inst.apps.length > 0, '已安装列表不应为空');
    const withInfo = inst.apps.filter((a) => a.info);
    console.log('  带 Info 标记的应用: ' + withInfo.map((a) => a.name + '(' + a.info + ')').join(', '));

    const bk = await S.listBuckets();
    console.log('  buckets: ' + bk.buckets.map((b) => b.name + '(' + b.manifests + ')').join(', '));

    const cache = await S.cacheInfo();
    console.log('  cache: ' + cache.total.files + ' 文件 ' + cache.total.sizeText +
      '，按应用聚合 ' + cache.apps.length + ' 个');

    const sr = await S.searchApps('fzf');
    console.log('  search fzf: ' + sr.results.length + ' 条，首条=' +
      (sr.results[0] ? sr.results[0].name + '@' + sr.results[0].version : '无'));

    // status 走网络，容易因代理抖动失败；失败不判死，打印即可
    try {
      const st = await S.status();
      console.log('  status: 可更新 ' + st.outdated.length + '，异常 ' + st.broken.length +
        (st.warnings.length ? '，warnings=' + st.warnings.length : ''));
    } catch (e) { console.log('  status 跳过：' + String(e.message).split('\n')[0]); }

    // prefix + info（挑一个必然存在的）
    const p = await S.prefixOf(inst.apps[0].name);
    console.log('  prefix ' + inst.apps[0].name + ': ' + p);
    assert.ok(/[\\/]apps[\\/]/.test(p), 'prefix 应返回 apps 目录下的路径');
    const info = await S.infoApp(inst.apps[0].name);
    console.log('  info: Website=' + (info.info.Website || '--'));

    // 本机代理探测（端口活着就算过，探测结果打印出来供人工核对）
    const probes = [];
    for (const proxy of S.LOCAL_PROXY_CANDIDATES) {
      if (await S.portOpen(proxy)) probes.push(proxy);
    }
    console.log('  portOpen: 在监听的代理端口 = ' + (probes.length ? probes.join(', ') : '（无）'));

    // 安装脚本的 PS 语法必须能解析（不执行，只过编译器）。
    // 走临时文件而不是 stdin：-Command 场景下 $input 对 stdin 的枚举不可靠（实测踩坑）。
    const fsx = require('fs');
    const pathx = require('path');
    const checkFile = pathx.join(__dirname, '_parse_check.ps1');
    const { spawn } = require('child_process');
    for (const [mirror, proxy] of [[true, ''], [false, ''], [false, 'http://127.0.0.1:7890']]) {
      fsx.writeFileSync(checkFile, S.installScript(proxy, mirror));
      const out = await new Promise((resolve) => {
        const child = spawn('powershell.exe', ['-NoProfile', '-Command',
          // PS 单引号串里反斜杠就是字面量，路径不需要转义
          "$t = [IO.File]::ReadAllText('" + checkFile + "'); " +
          "try { [void][scriptblock]::Create($t); 'PARSE_OK' } catch { 'PARSE_FAIL: ' + $_.Exception.Message }"]);
        let acc = '';
        child.stdout.on('data', (d) => { acc += d; });
        child.stderr.on('data', (d) => { acc += d; });
        child.on('close', () => resolve(acc));
        child.on('error', (e) => resolve(String(e)));
      });
      fsx.unlinkSync(checkFile);
      if (out.indexOf('PARSE_OK') < 0) {
        throw new Error('PS 解析失败(镜像=' + mirror + ',代理=' + (proxy || '直连') + ')：' + out.trim().slice(0, 200));
      }
    }
    // git 自动安装脚本同样要过 PS 编译器
    fsx.writeFileSync(checkFile, S.ensureGitScript());
    const gitOut = await new Promise((resolve) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-Command',
        "$t = [IO.File]::ReadAllText('" + checkFile + "'); " +
        "try { [void][scriptblock]::Create($t); 'PARSE_OK' } catch { 'PARSE_FAIL: ' + $_.Exception.Message }"]);
      let acc = '';
      child.stdout.on('data', (d) => { acc += d; });
      child.stderr.on('data', (d) => { acc += d; });
      child.on('close', () => resolve(acc));
      child.on('error', (e) => resolve(String(e)));
    });
    fsx.unlinkSync(checkFile);
    if (gitOut.indexOf('PARSE_OK') < 0) {
      throw new Error('ensureGitScript PS 解析失败：' + gitOut.trim().slice(0, 200));
    }
    console.log('  installScript/ensureGitScript: PS 语法解析通过');

    // 清单镜像化实链路：就地改写 → 校验 → 还原 → 校验字节级一致
    const fsx2 = require('fs');
    const mfPath = S.findManifestFile('aria2');
    assert.ok(mfPath, '本机 main bucket 里应能找到 aria2 清单');
    console.log('  findManifestFile(aria2): ' + mfPath);
    const originalBytes = fsx2.readFileSync(mfPath, 'utf8');
    const ctx = S.patchManifestInPlace('aria2');
    assert.ok(ctx.changed, 'aria2 清单含 GitHub 地址，应发生改写');
    const patchedText = fsx2.readFileSync(mfPath, 'utf8');
    assert.ok(patchedText.indexOf('scoop.201704.xyz/https://github.com') >= 0, 'GitHub 地址应被打上镜像前缀');
    assert.strictEqual(patchedText.indexOf('"https://github.com'), -1, '不应残留未镜像化的裸 GitHub 地址');
    ctx.restore();
    const restoredBytes = fsx2.readFileSync(mfPath, 'utf8');
    assert.strictEqual(restoredBytes, originalBytes, '还原后必须与原文件字节一致');
    assert.ok(!fsx2.existsSync(mfPath + '.ztools-bak'), '备份文件应已清理');
    console.log('  patchManifestInPlace(aria2): 改写→校验→还原 字节一致 ✅');

    console.log('\n全部通过 ✅');
  })().catch((e) => { console.error('\nlive 冒烟失败：', e); process.exit(1); });
} else {
  console.log('\n纯函数测试 ' + (failed ? '有失败 ❌' : '全部通过 ✅') +
    '（加 --live 可顺带跑真实 scoop 冒烟）');
  process.exit(failed ? 1 : 0);
}
