// Launch and drive the unchanged official peer. This file contains no wire protocol.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const prepared = process.env.LX_ORIGINAL_PEER
async function createOfficialPeer() {
  if (!prepared) throw new Error('Set LX_ORIGINAL_PEER to a directory containing the official LX 2.12.6 Windows green archive; the launch driver is included in this repository')
  const archive = path.join(prepared, 'lx-music-desktop-v2.12.6-win_x64-green.7z')
  const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  if (hash(archive) !== 'a07d2a15dbcf06ce689bf8b99c64241b06deb28fdfb6ffe79b6dcdfbb0d157a5') throw new Error('Official LX archive identity changed')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-sync-official-'))
  fs.mkdirSync(path.join(root, 'official'))
  execFileSync('7z', ['x', archive, '-o' + path.join(root, 'official'), '-y'], { windowsHide: true, stdio: 'pipe' })
  if (hash(path.join(root, 'official/resources/app.asar')) !== 'd800d31f1983c7a74752ff3449388c421a9687a075d68988e7d9fe9a478e7b45') throw new Error('Official LX asar identity changed')
  fs.copyFileSync(path.join(__dirname, 'official-lx-driver.cjs'), path.join(root, 'peer-driver.cjs'))
  const peer = await require(path.join(root, 'peer-driver.cjs')).createPeer()
  const close = peer.close
  return Object.assign(peer, { root, async close() {
    await close()
    const log = path.join(root, 'last-peer-console.log')
    // Original LX logs its auth argument. Redact that test-host output, without
    // patching any original executable, source module or wire behavior.
    if (fs.existsSync(log)) fs.writeFileSync(log, fs.readFileSync(log, 'utf8').replace(/^connect:.*$/gm, 'connect: [authentication redacted]'))
  } })
}
module.exports = { createOfficialPeer }
