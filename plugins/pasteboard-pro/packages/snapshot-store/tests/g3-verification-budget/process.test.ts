import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { fixture, rows, epochRowKey, securityRowKey } from './fixture';

const parent = fileURLToPath(new URL('../../../../artifacts/pasteboardpro/clipboard-format-g0/v037-budget-tests/runtime/', import.meta.url));
it('SIGKILL AFTER reserve resolves retains charge and recovers unknown+lock; not an OS-owner/txn-window proof', async () => {
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const sandbox = await mkdtemp(path.join(parent, 'public-sigkill-'));
  const marker = path.join(sandbox, 'marker.json');
  const childConfig = path.join(sandbox, 'child-vitest.config.mjs');
  await writeFile(childConfig, `export default ${JSON.stringify({
    root: process.cwd(), cacheDir: path.join(sandbox, 'child-vite-cache'),
    test: { maxWorkers: 1, cache: false, include: ['packages/snapshot-store/tests/g3-verification-budget/child-crash-fixture.test.ts'] },
  })};\n`, { mode: 0o600 });
  const child = spawn(process.execPath, [
    fileURLToPath(new URL('../../../../node_modules/vitest/vitest.mjs', import.meta.url)),
    'run', '--config', childConfig,
    'packages/snapshot-store/tests/g3-verification-budget/child-crash-fixture.test.ts',
    '--pool=threads', '--poolOptions.threads.singleThread', '--reporter=dot',
  ], { cwd: process.cwd(), env: { ...process.env, V037_BUDGET_CHILD_MARKER: marker, V037_BUDGET_CHILD_PARENT: sandbox },
    stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks: Buffer[] = [];
  let outputBytes = 0;
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk: Buffer) => {
    outputBytes += chunk.length;
    if (outputBytes > 65536) child.kill('SIGKILL'); else chunks.push(Buffer.from(chunk));
  });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  let data: { directory: string; pause: string } | undefined;
  try {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try { data = JSON.parse(await readFile(marker, 'utf8')); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('public-budget-child-exited-before-marker');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(data?.pause).toBe('reserve-resolved');
    child.kill('SIGKILL');
    expect(await closed).toEqual({ code: null, signal: 'SIGKILL' });
    expect(outputBytes).toBeLessThanOrEqual(65536);
    await writeFile(path.join(sandbox, 'child-output.txt'), Buffer.concat(chunks));
    const recovered = await fixture(sandbox, data!.directory);
    try {
      await expect(recovered.begin('recover-package', true)).rejects.toMatchObject({ code: 'locked' });
    } finally { await recovered.close(); }
    const snapshot = await rows(data!.directory);
    expect(snapshot.get(epochRowKey())).toMatchObject({ used: 1 });
    expect(snapshot.get(securityRowKey())).toMatchObject({ pending: null, active: null, locked: true });
    expect([...snapshot.values()].some(row => row.state === 'unknown')).toBe(true);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
  }
}, 30000);
