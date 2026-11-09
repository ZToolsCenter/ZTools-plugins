import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { fixture, rows, epochRowKey, securityRowKey } from './fixture';

type Proof = {
  scenario: string; directory: string; stage: string; callbackDepth: number;
  moduleCallbackReturned: boolean; nativeMethodReturned: boolean; cryptoStarted: boolean;
  meta: { pending: number; activeAttempts: number };
  epoch: { used: number }; reservation: { state: string };
  attempt: { state: string; units: number; failures: number };
  security: { pending: string | null; active: string | null; streak: number; locked: boolean };
};
const artifactRoot = fileURLToPath(new URL('../../../../artifacts/pasteboardpro/clipboard-format-g0/v038-budget-tests/runtime/', import.meta.url));
function limit<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('PUBLIC-owned-child-timeout')), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
for (const scenario of ['reserve', 'authentication-false'] as const) {
  it(`real LMDB ${scenario} callback SIGKILL rolls back uncommitted writes; synthetic owner only`, async () => {
    await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
    const sandbox = await mkdtemp(path.join(artifactRoot, `${scenario}-`));
    const marker = path.join(sandbox, 'writer-proof.json'), config = path.join(sandbox, 'child.config.mjs');
    await writeFile(config, `export default ${JSON.stringify({ root: process.cwd(), cacheDir: path.join(sandbox, 'cache'),
      test: { cache: false, maxWorkers: 1, include: ['packages/snapshot-store/tests/g3-verification-budget/transaction-child-fixture.test.ts'] } })};\n`, { mode: 0o600 });
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../../../node_modules/vitest/vitest.mjs', import.meta.url)),
      'run', '--config', config, '--pool=threads', '--poolOptions.threads.singleThread', '--reporter=dot'], {
      cwd: process.cwd(), detached: true, env: { ...process.env, V038_TXN_SCENARIO: scenario,
        V038_TXN_PARENT: sandbox, V038_TXN_MARKER: marker }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let outputBytes = 0, stdoutClosed = false, stderrClosed = false, groupEmpty = false;
    child.stdout.once('close', () => { stdoutClosed = true; });
    child.stderr.once('close', () => { stderrClosed = true; });
    const output: Buffer[] = [];
    const killGroup = () => {
      if (!child.pid || groupEmpty) return;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ESRCH' && code !== 'EPERM') {
          try { child.kill('SIGKILL'); } catch {}
        }
      }
    };
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > 65536) killGroup(); else output.push(Buffer.from(chunk));
    });
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
    });
    let proof: Proof | undefined;
    try {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        try { proof = JSON.parse(await readFile(marker, 'utf8')); break; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        if (child.exitCode !== null || child.signalCode !== null) throw new Error('PUBLIC-child-left-before-writer-proof');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(proof).toMatchObject({ scenario, stage: 'inside-native-callback-before-return', callbackDepth: 1,
        moduleCallbackReturned: true, nativeMethodReturned: false, cryptoStarted: false,
        epoch: { used: 1 }, attempt: { state: 'active' } });
      if (scenario === 'reserve') {
        expect(proof).toMatchObject({ meta: { pending: 1, activeAttempts: 1 }, reservation: { state: 'pending' },
          attempt: { units: 0, failures: 0 }, security: { pending: expect.any(String), streak: 0, locked: false } });
      } else {
        expect(proof).toMatchObject({ meta: { pending: 0, activeAttempts: 1 }, reservation: { state: 'failure' },
          attempt: { units: 1, failures: 1 }, security: { pending: null, streak: 1, locked: false } });
      }
      killGroup();
      expect(await limit(closed, 10000)).toEqual({ code: null, signal: 'SIGKILL' });
      // threads pool has no child worker processes. Still verify the owned
      // process group is empty before opening its LMDB environment.
      const groupDeadline = Date.now() + 5000;
      while (Date.now() < groupDeadline) {
        try { process.kill(-child.pid!, 0); } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== 'ESRCH' && code !== 'EPERM') throw error;
          groupEmpty = true; break;
        }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(groupEmpty).toBe(true);
      expect({ stdoutClosed, stderrClosed }).toEqual({ stdoutClosed: true, stderrClosed: true });
      expect(outputBytes).toBeLessThanOrEqual(65536);
      await writeFile(path.join(sandbox, 'child-output.txt'), Buffer.concat(output));
      const recovered = await fixture(sandbox, proof!.directory);
      try { await expect(recovered.begin('recover-package', true)).rejects.toMatchObject({ code: 'locked' }); }
      finally { await recovered.close(); }
      const snapshot = await rows(proof!.directory);
      expect(snapshot.get('meta')).toMatchObject({ pending: 0, activeAttempts: 0 });
      expect(snapshot.get(securityRowKey())).toMatchObject({ pending: null, active: null, streak: 0, locked: true });
      const attempts = [...snapshot.values()].filter(row => row.state === 'unknown');
      expect(attempts.some(row => 'claim' in row)).toBe(true);
      if (scenario === 'reserve') {
        expect(snapshot.get(epochRowKey())).toBeUndefined();
        expect([...snapshot.keys()].some(key => /^(reservation|prepare):/.test(key))).toBe(false);
      } else {
        expect(snapshot.get(epochRowKey())).toMatchObject({ used: 1 });
        expect([...snapshot.values()].filter(row => row.state === 'unknown')).toHaveLength(2);
        expect([...snapshot.values()].some(row => row.state === 'failure')).toBe(false);
        const a = [...snapshot.entries()].find(([key]) => key.startsWith('attempt:'))![1];
        expect(a).toMatchObject({ units: 0, failures: 0 });
      }
      await writeFile(path.join(sandbox, 'parent-result.json'), JSON.stringify({ scenario, signal: 'SIGKILL',
        stdioClosed: true, processGroupEmpty: true, writerProofVerified: true, recoveryVerified: true }, null, 2));
    } finally { killGroup(); await limit(closed, 10000); }
  }, 45000);
}
