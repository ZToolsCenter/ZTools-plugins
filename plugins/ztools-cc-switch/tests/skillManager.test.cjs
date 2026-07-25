'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const tar = require('../preload/node_modules/tar')
const AdmZip = require('../preload/node_modules/adm-zip')
const { createSkillManager, parseFrontmatter } = require('../preload/skillManager')

test('parses SKILL.md metadata', () => {
  assert.deepEqual(parseFrontmatter('---\nname: demo\ndescription: "Demo skill"\n---\n', 'fallback'), {
    name: 'demo', description: 'Demo skill'
  })
})

test('imports, synchronizes, migrates and recoverably removes a Skill', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-skills-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const homeDir = path.join(root, 'home')
  const source = path.join(root, 'source-skill')
  await fs.mkdir(source, { recursive: true })
  await fs.writeFile(path.join(source, 'SKILL.md'), '---\nname: Demo\ndescription: Test skill\n---\n')
  await fs.writeFile(path.join(source, 'helper.txt'), 'content')
  const manager = createSkillManager({ homeDir, dataDir: path.join(root, 'data') })

  const imported = await manager.importSkill(source, 'demo-skill')
  assert.equal(imported.name, 'Demo')
  await manager.setSkillEnabled('demo-skill', 'claude', true)
  await manager.setSkillEnabled('demo-skill', 'claude-desktop', true)
  await manager.setSkillEnabled('demo-skill', 'grokbuild', true)
  const linked = await fs.lstat(path.join(homeDir, '.claude', 'skills', 'demo-skill'))
  assert.equal(linked.isSymbolicLink(), true)
  assert.equal((await fs.lstat(path.join(homeDir, '.claude-desktop', 'skills', 'demo-skill'))).isSymbolicLink(), true)
  assert.equal((await fs.lstat(path.join(homeDir, '.grok', 'skills', 'demo-skill'))).isSymbolicLink(), true)

  const migrated = await manager.updateSettings({ storage: 'agents', syncMode: 'copy' })
  assert.equal(migrated.storage, 'agents')
  assert.equal(await fs.readFile(path.join(homeDir, '.agents', 'skills', 'demo-skill', 'helper.txt'), 'utf8'), 'content')

  const removed = await manager.removeSkill('demo-skill')
  assert.equal(removed.removed, true)
  assert.ok(removed.backupPath)
  await assert.rejects(() => fs.stat(path.join(homeDir, '.claude', 'skills', 'demo-skill')), /ENOENT/)
})

test('installs multiple Skills from ZIP, resolves internal symlinks and skips conflicts', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-skills-zip-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const archivePath = path.join(root, 'skill-pack.zip')
  const zip = new AdmZip()
  zip.addFile('Bundle One/SKILL.md', Buffer.from('---\nname: Bundle One\ndescription: first\n---\n'))
  zip.addFile('Bundle One/shared.txt', Buffer.from('shared content'))
  zip.addFile('Bundle One/alias.txt', Buffer.from('shared.txt'))
  zip.getEntry('Bundle One/alias.txt').attr = (0o120777 << 16) >>> 0
  zip.addFile('Bundle One/outside.txt', Buffer.from('../../outside.txt'))
  zip.getEntry('Bundle One/outside.txt').attr = (0o120777 << 16) >>> 0
  zip.addFile('collection/second/SKILL.md', Buffer.from('---\nname: Second\ndescription: second\n---\n'))
  zip.addFile('collection/second/helper.txt', Buffer.from('helper'))
  zip.writeZip(archivePath)

  const homeDir = path.join(root, 'home'); const dataDir = path.join(root, 'data')
  const manager = createSkillManager({ homeDir, dataDir })
  const installed = await manager.installSkillsFromZip(archivePath, 'codex')
  assert.deepEqual(installed.map((item) => item.directory).sort(), ['Bundle One', 'second'])
  assert.equal(await fs.readFile(path.join(dataDir, 'skills', 'Bundle One', 'alias.txt'), 'utf8'), 'shared content')
  await assert.rejects(() => fs.stat(path.join(dataDir, 'skills', 'Bundle One', 'outside.txt')), /ENOENT/)
  assert.equal((await fs.lstat(path.join(homeDir, '.codex', 'skills', 'Bundle One'))).isSymbolicLink(), true)
  assert.equal((await fs.lstat(path.join(homeDir, '.codex', 'skills', 'second'))).isSymbolicLink(), true)
  assert.deepEqual(await manager.installSkillsFromZip(archivePath, 'codex'), [])
  await assert.rejects(() => manager.installSkillsFromZip(archivePath, 'unknown'), /不支持/)
})

async function makeRepoArchive(root, version = 'one') {
  const sourceRoot = path.join(root, `repo-source-${version}`)
  const top = path.join(sourceRoot, 'demo-main')
  const skill = path.join(top, 'skills', 'remote-skill')
  await fs.mkdir(skill, { recursive: true })
  await fs.writeFile(path.join(skill, 'SKILL.md'), `---\nname: Remote Skill\ndescription: Version ${version}\n---\n`)
  await fs.writeFile(path.join(skill, 'version.txt'), version)
  const archive = path.join(root, `${version}.tgz`)
  await tar.c({ gzip: true, cwd: sourceRoot, file: archive }, ['demo-main'])
  return fs.readFile(archive)
}

function bufferResponse(buffer) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => name.toLowerCase() === 'content-length' ? String(buffer.length) : null },
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  }
}

test('discovers, installs, updates, backs up and restores repository Skills', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-skills-remote-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  let archive = await makeRepoArchive(root, 'one')
  const manager = createSkillManager({
    homeDir: path.join(root, 'home'), dataDir: path.join(root, 'data'),
    fetch: async (url) => {
      assert.match(String(url), /codeload\.github\.com\/example\/demo/)
      return bufferResponse(archive)
    }
  })

  await manager.addSkillRepo({ owner: 'example', name: 'demo', branch: 'main', enabled: true })
  for (const repo of await manager.listSkillRepos()) {
    if (repo.owner !== 'example') await manager.removeSkillRepo(repo.owner, repo.name)
  }
  const discovery = await manager.discoverSkills()
  assert.equal(discovery.errors.length, 0)
  assert.equal(discovery.skills[0].directory, 'skills/remote-skill')
  const installed = await manager.installDiscoveredSkill({ ...discovery.skills[0], directory: 'remote-skill' }, 'codex')
  assert.equal(installed.repoOwner, 'example')
  assert.equal((await fs.lstat(path.join(root, 'home', '.codex', 'skills', 'remote-skill'))).isSymbolicLink(), true)

  archive = await makeRepoArchive(root, 'two')
  const updates = await manager.checkSkillUpdates()
  assert.equal(updates.length, 1)
  await manager.updateSkill('remote-skill')
  assert.equal(await fs.readFile(path.join(root, 'data', 'skills', 'remote-skill', 'version.txt'), 'utf8'), 'two')
  assert.equal((await manager.listSkillBackups()).length, 1)

  const removed = await manager.removeSkill('remote-skill')
  assert.ok(removed.backupId)
  const backups = await manager.listSkillBackups()
  const restored = await manager.restoreSkillBackup(backups[0].backupId, 'gemini')
  assert.equal(restored.directory, 'remote-skill')
  assert.equal((await fs.lstat(path.join(root, 'home', '.gemini', 'skills', 'remote-skill'))).isSymbolicLink(), true)
  await manager.deleteSkillBackup(backups[0].backupId)
})

test('scans and imports unmanaged Skills without touching a real Home', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-skills-unmanaged-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const homeDir = path.join(root, 'home')
  const unmanaged = path.join(homeDir, '.gemini', 'skills', 'existing')
  await fs.mkdir(unmanaged, { recursive: true })
  await fs.writeFile(path.join(unmanaged, 'SKILL.md'), '---\nname: Existing\ndescription: unmanaged\n---\n')
  const manager = createSkillManager({ homeDir, dataDir: path.join(root, 'data') })
  const scanned = await manager.scanUnmanagedSkills()
  assert.equal(scanned.length, 1)
  assert.equal(scanned[0].apps.gemini, true)
  const imported = await manager.importUnmanagedSkills([{ directory: 'existing', apps: { gemini: true } }])
  assert.equal(imported[0].name, 'Existing')
  assert.equal((await fs.lstat(unmanaged)).isSymbolicLink(), true)
})

test('searches skills.sh and filters non-GitHub sources', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-skills-search-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const manager = createSkillManager({
    homeDir: path.join(root, 'home'), dataDir: path.join(root, 'data'),
    fetch: async (url) => {
      assert.match(String(url), /^https:\/\/skills\.sh\/api\/search/)
      return { ok: true, status: 200, json: async () => ({ query: 'find', count: 2, skills: [
        { id: 'good', skillId: 'skills/find-skills', name: 'Find Skills', installs: 42, source: 'owner/repo' },
        { id: 'bad', skillId: 'bad', name: 'Bad', installs: 2, source: 'catalog.example/bad' }
      ] }) }
    }
  })
  const result = await manager.searchSkillsSh('find')
  assert.equal(result.skills.length, 1)
  assert.equal(result.skills[0].installDirectory, 'find-skills')
  assert.equal(result.totalCount, 2)
})
