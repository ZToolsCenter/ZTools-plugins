import { closeSync, fsyncSync, openSync, renameSync, writeFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';

const pause = vi.hoisted(() => ({ armed: false, scenario: '', marker: '', directory: '',
  nativeMethodReturned: false, cryptoStarted: false, callbackDepth: 0 }));
vi.mock('lmdb', async importOriginal => {
  const real = await importOriginal<typeof import('lmdb')>();
  return { ...real, open(...args: Parameters<typeof real.open>) {
    const db: ReturnType<typeof real.open> = Reflect.apply(real.open, real, args);
    return new Proxy(db, { get(target, name) {
      const original = Reflect.get(target, name, target);
      if (name === 'transactionSync') return (...transactionArgs: unknown[]) => {
        if (!pause.armed) return Reflect.apply(original, target, transactionArgs);
        const callback = transactionArgs[0];
        if (typeof callback !== 'function') throw new Error('PUBLIC-invalid-fixture-callback');
        const wrapped = () => {
          pause.callbackDepth++;
          try {
            const result = Reflect.apply(callback, undefined, []);
            // We are still INSIDE the callback passed to real transactionSync.
            // lmdb finishTxn/commitTxn cannot run until this wrapper returns.
            const get = (key: string) => JSON.parse(String(target.get(key)));
            const first = (prefix: string) => [...target.getRange({ start: prefix, end: `${prefix.slice(0, -1)};` })][0];
            const epoch = first('epoch:'), reservation = first('reservation:'), attempt = first('attempt:'), security = first('security:');
            if (!epoch || !reservation || !attempt || !security) throw new Error('PUBLIC-incomplete-writer-proof');
            const e = get(String(epoch.key)), r = get(String(reservation.key)), a = get(String(attempt.key)), s = get(String(security.key));
            const proof = { scenario: pause.scenario, directory: pause.directory,
              stage: 'inside-native-callback-before-return', callbackDepth: pause.callbackDepth,
              moduleCallbackReturned: true, nativeMethodReturned: pause.nativeMethodReturned,
              cryptoStarted: pause.cryptoStarted, meta: get('meta'),
              epoch: { used: e.used, rootId: e.rootId }, reservation: { state: r.state },
              attempt: { state: a.state, units: a.units, failures: a.failures },
              security: { pending: s.pending, active: s.active, streak: s.streak, locked: s.locked } };
            const temporary = `${pause.marker}.writing`;
            const fd = openSync(temporary, 'wx', 0o600);
            try { writeFileSync(fd, JSON.stringify(proof)); fsyncSync(fd); } finally { closeSync(fd); }
            renameSync(temporary, pause.marker);
            // Finite fail-safe: timeout throws and aborts; it NEVER falls through
            // to return result and accidentally commit an un-killed fixture.
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
            throw new Error('PUBLIC-transaction-pause-timeout-abort');
          } finally { pause.callbackDepth--; }
        };
        const output = Reflect.apply(original, target, [wrapped, ...transactionArgs.slice(1)]);
        pause.nativeMethodReturned = true;
        return output;
      };
      return typeof original === 'function' ? original.bind(target) : original;
    } });
  } };
});
import { fixture, request } from './fixture';

it.skipIf(!process.env.V038_TXN_SCENARIO)('v038 child pauses actual Module transaction before native commit', async () => {
  const scenario = process.env.V038_TXN_SCENARIO!;
  expect(['reserve', 'authentication-false']).toContain(scenario);
  const f = await fixture(process.env.V038_TXN_PARENT!);
  await f.begin('verify-control', true); // durable baseline, never intercepted
  const r = request(), lease = f.unit(r);
  if (scenario === 'authentication-false') await f.module.budget.reserveVerification(lease, r);
  pause.scenario = scenario; pause.marker = process.env.V038_TXN_MARKER!; pause.directory = f.directory;
  pause.armed = true;
  if (scenario === 'reserve') {
    await f.module.budget.reserveVerification(lease, r);
    pause.cryptoStarted = true; // must remain false at the within-callback pause
  } else await f.module.budget.recordAuthentication(lease, false);
  throw new Error('PUBLIC-unexpected-return-from-transaction-pause');
}, 45000);
