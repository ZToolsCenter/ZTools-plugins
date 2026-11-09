import { createHash } from 'node:crypto';
import { evaluateCaptureContentPolicyV2, ClipboardSnapshotManifestV2Schema,
  type ContentKindV2 } from '@pasteboard-pro/core';
import type { BuildPortableProjectionInputV2 } from '../src/v2';

// Deliberately PUBLIC test data. Alias values are fixture choices, NOT authority.
export const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const alias = (value: number) => Buffer.alloc(16, value).toString('base64url');
export const identity = () => ({ projectionId: alias(1), sourceSnapshotId: alias(2), sourceManifestRevision: alias(3), originDeviceId: alias(4) });
export const limits = { maxInputBytes: 4096, maxOutputBytes: 4096, maxProjectionBytes: 16384 };
export const abc = Buffer.from('616263', 'hex');
export const abcSha256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
export type Mutable<T> = T extends (...args: never[]) => unknown ? T : T extends Uint8Array ? Uint8Array : T extends readonly (infer V)[] ? Mutable<V>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
export function mutable<T>(input: T): Mutable<T> {
  function clone(value: unknown): unknown {
    if (value instanceof Uint8Array) return Uint8Array.from(value);
    if (Array.isArray(value)) return value.map(clone);
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
    return value; // pure hash callback identity is intentionally preserved
  }
  return clone(input) as Mutable<T>;
}
export function canonicalJson(value: unknown): string {
  function sorted(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(sorted);
    if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, sorted(x)]));
    return v;
  }
  return JSON.stringify(sorted(value));
}
export type PublicRow = {
  key: string; item?: number; kind?: ContentKindV2; bytes: Uint8Array;
  format?: string; native?: string; unavailable?: 'unsupported' | 'timeout' | 'over-limit' | 'failed';
};
export async function portableInput(rows: readonly PublicRow[] = [{ key: 'text', bytes: abc }], platform: 'macos' | 'windows' = 'macos'): Promise<BuildPortableProjectionInputV2> {
  const capture = { attemptId: 'public-attempt', snapshotId: 'source-snapshot', manifestRevision: 'manifest-rev', receiptId: 'public-receipt',
    capturedRevision: 'os-revision-7', observedRevision: 'os-revision-7',
    policy: { revision: 'public-policy', contentRulesEnabled: false, requireFileBodyScan: false },
    preflight: { capturedRevision: 'os-revision-7', policyRevision: 'public-policy', captureAllowed: true, localHistoryAllowed: true, cloudUploadAllowed: false },
    representations: rows.map(row => row.unavailable ? { representationKey: row.key, itemIndex: row.item ?? 0,
      state: 'unavailable' as const, reasonCode: row.unavailable } : { representationKey: row.key, itemIndex: row.item ?? 0,
      state: 'captured' as const, contentKind: row.kind ?? 'text', bytes: Uint8Array.from(row.bytes) }) };
  const admission = await evaluateCaptureContentPolicyV2(capture, { currentPolicyRevision: () => 'public-policy',
    scan: async req => req.requiredScopes.map(scope => ({ scope, status: 'passed' as const })) });
  if (admission.status !== 'eligible' && admission.status !== 'partial') throw new Error('PUBLIC-fixture-admission-failed');
  const byItem = new Map<number, Record<string, unknown>[]>();
  for (const row of rows) {
    const itemIndex = row.item ?? 0, received = admission.receipt.representations.find(r => r.representationKey === row.key)!;
    const representations = byItem.get(itemIndex) ?? [];
    const common = { representationKey: row.key, formatId: row.format ?? 'public.utf8-plain-text', nativeName: row.native ?? row.format ?? 'public.utf8-plain-text' };
    if (received.retentionAllowed) {
      representations.push(row.kind === 'file-reference' ? { ...common, state: 'ready', storage: 'file-reference', fidelity: 'reference',
        originDeviceId: 'private-local-device', references: [{ url: 'file:///PRIVATE_LOCAL_PATH/item.txt', isDirectory: false, observedAvailability: 'unknown' }] }
        : { ...common, state: 'ready', storage: 'blob', fidelity: 'exact', byteLength: row.bytes.length, sha256: hash(row.bytes), blobRef: `sha256-${hash(row.bytes)}` });
    } else representations.push({ ...common, state: received.reasonCode === 'required-check-unavailable' ? 'policy-blocked' : received.reasonCode, reasonCode: received.reasonCode });
    byItem.set(itemIndex, representations);
  }
  const captured = admission.receipt.representations.filter(r => r.retentionAllowed).length;
  const manifest = ClipboardSnapshotManifestV2Schema.parse({ schemaVersion: 2, snapshotId: capture.snapshotId, manifestRevision: capture.manifestRevision,
    source: { hostEpoch: 'public-host-epoch', platform, osRevision: capture.capturedRevision, capturedAt: '2026-11-01T00:00:00.000Z',
      osBuild: 'PRIVATE_OS_BUILD', architecture: 'arm64', adapterVersion: 'fixture',
      itemModel: platform === 'macos' ? 'macos-items' : 'windows-format-set', sourceApplication: { kind: 'unknown' }, attribution: 'unknown' },
    policyReceiptId: capture.receiptId, items: [...byItem].map(([index, representations]) => ({ index, representations })),
    coverage: { requested: rows.length, captured, omitted: rows.length - captured }, captureState: captured === rows.length ? 'ready' : 'partial' });
  const raw = admission.admittedRepresentations.map(row => ({ representationKey: row.representationKey, itemIndex: row.itemIndex,
    blobRef: `sha256-${hash(row.bytes)}`, sha256: hash(row.bytes), byteLength: row.bytes.length, bytes: Uint8Array.from(row.bytes) }));
  return { snapshot: { manifest, receipt: admission.receipt, representations: raw },
    upsert: { eventType: 'upsert', hostEpoch: manifest.source.hostEpoch, changeSeq: '7', snapshotId: manifest.snapshotId, manifestRevision: manifest.manifestRevision,
      manifestRef: `manifest:${hash(Buffer.from(canonicalJson([manifest.snapshotId, manifest.manifestRevision])))}`,
      manifestSha256: hash(Buffer.from(canonicalJson(manifest))) }, identity: identity(),
    selections: [{ representationKey: rows[0]!.key, encoding: platform === 'macos' ? 'utf8' : 'cf-unicode-text', representationHandle: alias(5), blobId: alias(6) }], limits, sha256: hash };
}
