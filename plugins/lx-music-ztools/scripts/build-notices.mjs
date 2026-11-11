import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { resolve, dirname, join, basename } from 'node:path'

// Include the production dependency graphs, including browser polyfills and
// source-worker tools. Runtime modules also retain their own original licenses.
const packages = new Map()
const missingLicenseFiles = { '@vue/devtools-api@6.6.4': 'build-config/ztools/licenses/vue-devtools-api-6.6.4.txt' }
function locate(from, name) {
  let current = from
  while (true) {
    const target = join(current, 'node_modules', name, 'package.json')
    if (existsSync(target)) return target
    const parent = dirname(current)
    if (parent === current) throw new Error('Missing notice dependency: ' + name)
    current = parent
  }
}
function collect(file) {
  if (packages.has(file)) return
  const info = JSON.parse(readFileSync(file, 'utf8'))
  packages.set(file, info)
  for (const name of Object.keys(info.dependencies || {})) {
    if (Object.hasOwn(info.optionalDependencies || {}, name)) continue
    collect(locate(dirname(file), name))
  }
}
for (const root of ['package.json', 'src-ztools/preload/package.json']) {
  const file = resolve(root), info = JSON.parse(readFileSync(file, 'utf8'))
  for (const name of Object.keys(info.dependencies || {})) collect(locate(dirname(file), name))
}
const unique = new Map()
for (const [file, info] of packages) {
  const id = `${info.name}@${info.version}`
  if (unique.has(id)) continue
  const entries = readdirSync(dirname(file), { withFileTypes: true })
  const texts = entries.filter(entry => entry.isFile() && /^(licen[cs]e|copying|notice)(?:[.-]|$)/i.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'en')).map(entry => `--- ${entry.name} ---\n${readFileSync(join(dirname(file), entry.name), 'utf8').trim()}`)
  if (!texts.length) {
    const readme = entries.find(entry => entry.isFile() && /^readme(?:\.|$)/i.test(entry.name))
    const content = readme && readFileSync(join(dirname(file), readme.name), 'utf8')
    const license = content && /^#{1,6}\s+Licen[cs]e\s*$/im.exec(content)
    if (missingLicenseFiles[id]) texts.push(readFileSync(missingLicenseFiles[id], 'utf8').trim())
    else if (license) texts.push(`--- ${readme.name} (License section) ---\n${content.slice(license.index).trim()}`)
    else throw new Error('Missing dependency license text: ' + id + ' (' + basename(dirname(file)) + ')')
  }
  unique.set(id, `===== ${id} =====\nLicense: ${typeof info.license === 'string' ? info.license : JSON.stringify(info.license || info.licenses || 'See below')}\n${texts.join('\n\n')}`)
}
writeFileSync('src-ztools/THIRD-PARTY-NOTICES.txt', ('LX Music for ZTools — production JavaScript dependency notices\nIncludes complete declared browser/runtime graphs; some modules may be tree-shaken.\nLX source and assets: Apache-2.0, see LICENSE and NOTICE.\n\n' + [...unique].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([, text]) => text).join('\n\n') + '\n').replace(/[ \t]+$/gm, ''))
console.log(`Wrote third-party notices for ${unique.size} package versions`)
