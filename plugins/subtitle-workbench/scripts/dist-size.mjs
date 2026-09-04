import { lstat, readdir } from 'node:fs/promises'
import path from 'node:path'

export const MAX_DIST_BYTES = 14_500_000

export async function measureDirectoryBytes(directory) {
  let total = 0
  for (const name of await readdir(directory)) {
    const target = path.join(directory, name)
    const metadata = await lstat(target)
    if (metadata.isSymbolicLink()) throw new Error(`dist must not contain symbolic links: ${name}`)
    if (metadata.isDirectory()) total += await measureDirectoryBytes(target)
    else if (metadata.isFile()) total += metadata.size
    else throw new Error(`dist contains an unsupported filesystem entry: ${name}`)
    if (!Number.isSafeInteger(total)) throw new Error('dist byte count exceeds the safe integer range')
  }
  return total
}

export function assertDistSize(bytes, label = 'dist') {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new TypeError('dist byte count must be a non-negative safe integer')
  if (bytes > MAX_DIST_BYTES) throw new Error(`${label} is ${bytes} bytes, exceeding the ${MAX_DIST_BYTES}-byte limit`)
  return bytes
}
