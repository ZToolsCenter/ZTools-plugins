import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
// Optional release check: compare content hashes without copying user scripts or
// recording their filenames, contents, endpoints, or credentials in this checkout.
const directory = process.env.LX_SOURCE_DIR
if (!directory) throw new Error('Set LX_SOURCE_DIR to audit local source exclusion')
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const protectedHashes = new Set(readdirSync(directory).filter(file => file.endsWith('.js')).map(file => sha(join(directory, file))))
const tracked = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
const matches = tracked.filter(file => statSync(file).isFile() && protectedHashes.has(sha(file)))
function auditProduct(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name)
    if (entry.isDirectory()) auditProduct(file)
    else if (protectedHashes.has(sha(file))) matches.push(file)
  }
}
auditProduct('src-ztools')
if (matches.length) throw new Error('Local source content found in repository/product: ' + matches.join(', '))
console.log(`PASS ${protectedHashes.size} unique private source scripts excluded from repository and plugin directory`)
