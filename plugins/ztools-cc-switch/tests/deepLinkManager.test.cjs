'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { parseDeepLink, createDeepLinkManager } = require('../preload/deepLinkManager')

function encoded(value) { return Buffer.from(value).toString('base64url') }

test('解析上游 v1 Provider、Prompt、MCP 与 Skill Deep Link', () => {
  const provider = parseDeepLink('ccswitch://v1/import?resource=provider&app=claude&name=Deep%20Claude&endpoint=https%3A%2F%2Fapi.example.com%2Fv1&apiKey=sk-secret&model=claude-sonnet&enabled=true')
  assert.equal(provider.resource, 'provider'); assert.equal(provider.app, 'claude'); assert.equal(provider.apiKey, 'sk-secret'); assert.equal(provider.enabled, true)
  const prompt = parseDeepLink(`ccswitch://v1/import?resource=prompt&app=codex&name=Review&content=${encoded('# Review\nBe strict.')}`)
  assert.equal(prompt.content, '# Review\nBe strict.')
  const mcp = parseDeepLink(`ccswitch://v1/import?resource=mcp&apps=claude,codex&config=${encoded(JSON.stringify({ mcpServers: { demo: { command: 'demo-mcp', args: ['--stdio'] } } }))}&enabled=true`)
  assert.deepEqual(mcp.apps, ['claude', 'codex']); assert.equal(mcp.mcpServers.demo.command, 'demo-mcp'); assert.equal(mcp.enabled, false); assert.equal(mcp.requestedEnabled, true)
  const skill = parseDeepLink('ccswitch://v1/import?resource=skill&repo=anthropics%2Fskills&branch=main')
  assert.equal(skill.repo, 'anthropics/skills'); assert.equal(skill.enabled, true)
})

test('Preload 只返回脱敏预览并以一次性 ID 确认导入', async () => {
  const calls = []
  const manager = createDeepLinkManager({
    configManager: {
      saveProvider: async (provider) => { calls.push(['provider', provider]); return provider },
      switchProvider: async (app, id) => calls.push(['switch', app, id])
    },
    extensionManager: {}, skillManager: {}
  })
  const prepared = await manager.prepare('ccswitch://v1/import?resource=provider&app=codex&name=Private&endpoint=https%3A%2F%2Fapi.example.com%2Fv1&apiKey=sk-private-token&model=gpt-5&enabled=true')
  assert.equal(JSON.stringify(prepared).includes('sk-private-token'), false)
  assert.match(prepared.preview.maskedApiKey, /^sk-p/)
  const result = await manager.confirm(prepared.pendingId)
  assert.equal(result.type, 'provider'); assert.equal(calls[0][1].apiKey, 'sk-private-token'); assert.equal(calls[1][0], 'switch')
  await assert.rejects(() => manager.confirm(prepared.pendingId), /过期/)
})

test('Provider Deep Link 拒绝任何用量脚本与用量凭据', () => {
  const base = 'ccswitch://v1/import?resource=provider&app=codex&name=Unsafe&endpoint=https%3A%2F%2Fapi.example.com&apiKey=sk-test'
  for (const field of ['usageEnabled=true', `usageScript=${encoded('fetch("http://127.0.0.1")')}`, 'usageApiKey=secret', 'usageAccessToken=secret', 'usageUserId=1']) {
    assert.throws(() => parseDeepLink(`${base}&${field}`), /不支持用量脚本/)
  }
})

test('导入 MCP、Prompt 和 Skill 时复用现有管理器并保留逐项失败', async () => {
  const saved = []
  const manager = createDeepLinkManager({
    configManager: {},
    extensionManager: {
      listExtensions: async () => ({ mcpServers: [{ id: 'good' }] }),
      savePrompt: async (item) => { saved.push(['prompt', item]); return item },
      setPromptEnabled: async (id, app) => saved.push(['prompt-enable', id, app]),
      saveMcp: async (item) => { if (item.id === 'broken') throw new Error('invalid'); saved.push(['mcp', item]); return item },
      setMcpEnabled: async (id, app) => saved.push(['mcp-enable', id, app])
    },
    skillManager: { addSkillRepo: async (repo) => saved.push(['skill', repo]) }
  })
  const prompt = await manager.prepare(`ccswitch://v1/import?resource=prompt&app=claude&name=Plan&content=${encoded('Plan first')}&enabled=true`)
  assert.equal((await manager.confirm(prompt.pendingId)).type, 'prompt')
  const config = encoded(JSON.stringify({ mcpServers: { good: { command: 'mcp', args: ['--stdio', '--token', 'argument-secret', '--api-key=inline-secret'], env: { TOKEN: 'secret' } }, broken: { command: '' } } }))
  const mcp = await manager.prepare(`ccswitch://v1/import?resource=mcp&apps=claude&config=${config}&enabled=true`)
  assert.deepEqual(mcp.preview.servers[0], { id: 'good', targetId: 'good-imported', conflict: true, type: 'command', url: '', command: 'mcp', args: ['--stdio', '--token', '••••', '--api-key=••••'], envKeys: ['TOKEN'], headerKeys: [] })
  assert.equal(JSON.stringify(mcp.preview).includes('secret'), false)
  const mcpResult = await manager.confirm(mcp.pendingId); assert.equal(mcpResult.importedCount, 1); assert.equal(mcpResult.failed.length, 1); assert.equal(mcpResult.requiresReview, true)
  assert.equal(saved.some(([type]) => type === 'mcp-enable'), false)
  assert.equal(saved.find(([type]) => type === 'mcp')[1].id, 'good-imported')
  const skill = await manager.prepare('ccswitch://v1/import?resource=skill&repo=owner%2Frepo&branch=develop')
  assert.equal((await manager.confirm(skill.pendingId)).type, 'skill')
  assert.ok(saved.some(([type]) => type === 'skill'))
})

test('拒绝未知协议、URL 凭据、非法应用和超大内容', () => {
  assert.throws(() => parseDeepLink('https://v1/import?resource=skill&repo=a%2Fb'), /仅支持/)
  assert.throws(() => parseDeepLink('ccswitch://v1/import?resource=provider&app=unknown&name=x&endpoint=https%3A%2F%2Fa.com&apiKey=x'), /不支持/)
  assert.throws(() => parseDeepLink('ccswitch://v1/import?resource=provider&app=claude&name=x&endpoint=https%3A%2F%2Fu%3Ap%40a.com&apiKey=x'), /凭据/)
  assert.throws(() => parseDeepLink('ccswitch://v1/import?resource=provider&app=claude&name=x&endpoint=http%3A%2F%2Fapi.example.com&apiKey=x'), /必须使用 HTTPS/)
  assert.throws(() => parseDeepLink('ccswitch://v1/import?resource=provider&app=claude&name=x&configUrl=https%3A%2F%2Fconfig.example.com&apiKey=x'), /不支持远程 configUrl/)
  assert.equal(parseDeepLink('ccswitch://v1/import?resource=provider&app=claude&name=x&endpoint=http%3A%2F%2F127.0.0.1%3A9000&apiKey=x').endpoint[0], 'http://127.0.0.1:9000')
  assert.throws(() => parseDeepLink(`ccswitch://v1/import?resource=prompt&app=claude&name=x&content=${'A'.repeat(1500000)}`), /过长|Base64/)
})

test('MCP Deep Link 拒绝远程 HTTP URL 并遮罩敏感查询参数', async () => {
  const manager = createDeepLinkManager({ configManager: {}, skillManager: {}, extensionManager: { listExtensions: async () => ({ mcpServers: [] }) } })
  const remoteHttp = encoded(JSON.stringify({ mcpServers: { remote: { url: 'http://mcp.example.com/sse' } } }))
  await assert.rejects(() => manager.prepare(`ccswitch://v1/import?resource=mcp&apps=claude&config=${remoteHttp}`), /必须使用 HTTPS/)
  const secure = encoded(JSON.stringify({ mcpServers: { remote: { url: 'https://mcp.example.com/sse?token=secret&mode=read' } } }))
  const prepared = await manager.prepare(`ccswitch://v1/import?resource=mcp&apps=claude&config=${secure}`)
  assert.match(prepared.preview.servers[0].url, /token=%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A2/)
  assert.equal(prepared.preview.servers[0].url.includes('secret'), false)
})
