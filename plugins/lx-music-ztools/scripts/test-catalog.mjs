import { startHost } from './host-fixture.mjs'
import { expect } from '@playwright/test'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import assert from 'node:assert/strict'
mkdirSync('artifacts/catalog', { recursive: true })
const fixtures = JSON.parse(readFileSync('tests/ztools/fixtures/catalog-search.json', 'utf8'))
let host
const report = { evidence: 'Original five-platform SDK signing/conversion/store with controlled HTTP responses in actual host' }
try {
  host = await startHost('dist/lx.html')
  await expect.poll(() => host.evaluate('typeof lxCatalog'), { timeout: 20000 }).toBe('object')
  await host.evaluate(`{
    const original = lxHost.invoke;
    window.__catalogTest = { fixtures: ${JSON.stringify(fixtures)}, calls: [], fail: null };
    lxHost.invoke = (channel, params) => {
      if (channel !== 'network:fetch') return original(channel, params);
      const state = window.__catalogTest;
      const url = params.url;
      const platform = url.includes('kuwo.cn') ? 'kw' : url.includes('kugou.com') ? 'kg' : url.includes('qq.com') ? 'tx' : url.includes('163.com') ? 'wy' : url.includes('migu.cn') ? 'mg' : null;
      if (!platform) return original(channel, params);
      state.calls.push({platform, url, method:params.method, body:params.body, form:params.form});
      if(state.fail === platform) return Promise.reject(new Error('controlled platform failure'));
      const body = JSON.parse(JSON.stringify(state.fixtures[platform]));
      return Promise.resolve({statusCode:200,statusMessage:'OK',headers:{'content-type':'application/json'},raw:new TextEncoder().encode(JSON.stringify(body)),body});
    }; undefined;
  }`)
  const expected = { kw: 'kw_101', kg: '102_HASH_KG_128', tx: 'tx_MID_TX_103', wy: 'wy_104', mg: 'mg_105' }
  report.results = {}
  for (const [platform, id] of Object.entries(expected)) {
    const result = await host.evaluate(`lxCatalog.search({text:'fixture',source:${JSON.stringify(platform)},page:1})`)
    assert.equal(result.list[0].id, id)
    assert.equal(result.list[0].source, platform)
    assert.equal(result.list[0].interval, '03:00')
    assert.deepEqual(result.list[0].meta.qualitys.map(quality => quality.type), ['128k', '320k'])
    assert.equal(result.page, 1)
    report.results[platform] = result
    const next = await host.evaluate(`lxCatalog.search({text:'fixture',source:${JSON.stringify(platform)},page:2})`)
    assert.equal(next.page, 2)
  }
  await host.evaluate(`__catalogTest.fail = 'mg'`)
  await assert.rejects(host.evaluate(`lxCatalog.search({text:'failure',source:'mg',page:1})`), /controlled|failure|undefined|失败/)
  const all = await host.evaluate(`lxCatalog.search({text:'fixture all',source:'all',page:1})`)
  assert.equal(all.list.length, 4)
  assert.equal(all.list.some(track => track.source === 'mg'), false)
  await host.evaluate(`__catalogTest.fail = null`)
  assert.equal((await host.evaluate(`lxCatalog.search({text:'recovery',source:'mg',page:1})`)).list[0].id, expected.mg)
  report.requests = await host.evaluate('__catalogTest.calls')
  assert.ok(report.requests.some(call => call.platform === 'kw' && call.url.includes('pn=1')))
  assert.ok(report.requests.some(call => call.platform === 'tx' && call.url.includes('sign=')))
  assert.ok(report.requests.some(call => call.platform === 'wy' && call.form?.params))
  report.status = 'PASS'
  console.log('PASS original kw/kg/tx/wy/mg search, IDs/qualities, pagination, platform failure isolation/recovery')
} catch (error) { report.status = 'FAIL'; report.error = String(error.stack || error); report.logs = await host?.logs(); process.exitCode = 1 }
finally { writeFileSync('artifacts/catalog/report.json', JSON.stringify(report, null, 2)); await host?.close() }
