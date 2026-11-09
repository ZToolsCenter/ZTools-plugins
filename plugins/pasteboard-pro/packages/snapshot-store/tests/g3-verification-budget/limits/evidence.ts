// Owner: v038_resource_limits (Sol). All outputs are newly owned absolute paths.
import { mkdir, readdir, stat, writeFile, statfs } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
export const evidenceRoot = '/Users/harris/Desktop/ZTools-plugins/plugins/pasteboard-pro/artifacts/pasteboardpro/clipboard-format-g0/v038-resource-limits';
export async function ownedCase(name: string) {
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  const base = path.join(evidenceRoot, `${name}-${randomUUID()}`);
  const space = await statfs(evidenceRoot);
  const total = await size(evidenceRoot);
  if (total.allocated > 1024 ** 3) throw new Error('owned resource fixture total exceeds 1GiB');
  if (space.bavail * space.bsize < 2 * 1024 ** 3) throw new Error('fixture requires at least 2GiB free');
  await mkdir(base, { mode: 0o700 });
  await writeFile(path.join(base, 'OWNER.json'), JSON.stringify({ owner: 'v038_resource_limits', model: 'Sol', name, maxFixtureBytes: 1024 ** 3 }), { flag: 'wx' });
  return base;
}
async function size(directory: string): Promise<{ logical: number; allocated: number }> {
  let logical = 0, allocated = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const p = path.join(directory, entry.name);
    if (entry.isDirectory()) { const child = await size(p); logical += child.logical; allocated += child.allocated; }
    else { const s = await stat(p); logical += s.size; allocated += s.blocks * 512; }
  }
  return { logical, allocated };
}
export async function receipt(base: string, facts: object) {
  const disk = await size(base);
  const ownedTotalDisk = await size(evidenceRoot);
  if (ownedTotalDisk.allocated > 1024 ** 3) throw new Error('owned resource fixture total exceeds 1GiB');
  if (disk.allocated > 1024 ** 3) throw new Error('fixture allocation exceeded 1GiB');
  await writeFile(path.join(base, 'result.json'), JSON.stringify({ owner: 'v038_resource_limits', model: 'Sol',
    node: process.version, platform: process.platform, elapsedObservation: 'native local only; no hard RSS or production p95 guarantee',
    maxRssKiB: process.resourceUsage().maxRSS, rssScope: 'current Vitest worker only; excludes read-only child oracles', disk, ownedTotalDisk, ...facts }, null, 2) + '\n', { flag: 'wx' });
}
