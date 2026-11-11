const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const allowed = ['plugin.json', 'logo.png', 'LICENSE', 'NOTICE', 'THIRD-PARTY-NOTICES.txt', 'native-jobs.html', 'dist', 'preload']
const required = ['plugin.json', 'logo.png', 'LICENSE', 'NOTICE', 'THIRD-PARTY-NOTICES.txt', 'native-jobs.html', 'dist/lx.html', 'dist/lyric.html', 'dist/lx-assets.json', 'dist/source-worker.js', 'dist/pitch_shifter.audioWorklet.js', 'preload/services.js', 'preload/lyric.cjs', 'preload/native-jobs.cjs', 'preload/runtime/index.cjs', 'preload/package-lock.json']
function hash(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex') }
function walk(root, prefix = '') {
  return fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) throw new Error('安装包不允许链接：' + relative)
    return entry.isDirectory() ? walk(root, relative) : [relative]
  })
}
function copy(source, target) {
  const stat = fs.lstatSync(source)
  if (stat.isSymbolicLink()) throw new Error('打包来源不允许链接：' + source)
  if (stat.isDirectory()) { fs.mkdirSync(target, { recursive: true }); for (const file of fs.readdirSync(source)) copy(path.join(source, file), path.join(target, file)) }
  else fs.copyFileSync(source, target)
}
function verifyPackage(root, { receipt = true } = {}) {
  for (const file of required) assert.ok(fs.existsSync(path.join(root, file)), '缺少安装资源：' + file)
  const assets = JSON.parse(fs.readFileSync(path.join(root, 'dist/lx-assets.json'), 'utf8'))
  for (const file of assets) assert.ok(fs.existsSync(path.join(root, 'dist', file)), '缺少前端资源：' + file)
  const files = walk(root)
  assert.ok(!files.some(file => /\.(?:node|sqlite(?:-wal|-shm)?|part)$/i.test(file)), '安装包含原生二进制或用户数据')
  const runtime = path.join(root, 'preload')
  const findDependency = (from, name) => {
    let directory = from
    while (directory.startsWith(runtime)) {
      const file = path.join(directory, 'node_modules', name, 'package.json')
      if (fs.existsSync(file)) return file
      const parent = path.dirname(directory); if (parent === directory) break; directory = parent
    }
    throw new Error('缺少运行依赖：' + name)
  }
  const packages = ['preload/package.json', ...files.filter(file => file.startsWith('preload/node_modules/') && file.endsWith('/package.json'))]
  for (const file of packages) {
    const absolute = path.join(root, file), pkg = JSON.parse(fs.readFileSync(absolute, 'utf8'))
    // npm packages may ship their own test fixture package.json. Only installed
    // package roots own runtime dependency declarations.
    if (file !== 'preload/package.json' && !/node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/.test(file)) continue
    for (const name of Object.keys(pkg.dependencies || {})) {
      if (!Object.hasOwn(pkg.optionalDependencies || {}, name)) findDependency(path.dirname(absolute), name)
    }
  }
  if (receipt) {
    const info = JSON.parse(fs.readFileSync(path.join(root, 'build-info.json'), 'utf8'))
    for (const [file, expected] of Object.entries(info.files)) assert.equal(hash(path.join(root, file)), expected, '文件校验失败：' + file)
    assert.deepEqual(files.filter(file => file !== 'build-info.json').sort(), Object.keys(info.files).sort(), '安装文件清单变化')
  }
  return files
}
function assemble({ source, destination }) {
  source = path.resolve(source); destination = path.resolve(destination)
  assert.ok(destination !== source && !destination.startsWith(source + path.sep), '打包目录不得覆盖源码')
  assert.ok(!fs.existsSync(destination), '请使用新的打包目录')
  fs.mkdirSync(destination, { recursive: true })
  for (const file of allowed) copy(path.join(source, file), path.join(destination, file))
  const files = verifyPackage(destination, { receipt: false }).sort()
  const manifest = JSON.parse(fs.readFileSync(path.join(destination, 'plugin.json'), 'utf8'))
  fs.writeFileSync(path.join(destination, 'build-info.json'), JSON.stringify({ plugin: { name: manifest.name, version: manifest.version }, upstream: { version: '2.12.6', baseline: '323e4bac' }, runtime: { sqlite: 'node:sqlite', standalone: true }, files: Object.fromEntries(files.map(file => [file, hash(path.join(destination, file))])) }, null, 2))
  verifyPackage(destination)
  return { root: destination, files: files.length, manifest }
}
module.exports = { assemble, verifyPackage }
