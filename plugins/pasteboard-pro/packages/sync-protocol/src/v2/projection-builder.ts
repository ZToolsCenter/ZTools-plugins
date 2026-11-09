import {
  CaptureContentPolicyReceiptV2Schema, ClipboardJournalChangeEventV2Schema,
  ClipboardSnapshotManifestV2Schema, copyCapturedUint8ArrayV2, inspectCapturedUint8ArrayV2,
  type CaptureContentPolicyReceiptV2, type ClipboardJournalChangeEventV2,
  maxFormatBytesV2, type ClipboardSnapshotManifestV2,
} from '@pasteboard-pro/core';
import { encodeCanonicalV2, failV2, snapshotJsonV2, V2ProtocolError } from './canonical.js';
import { validateProjectionV2, verifyProjectionDigestV2 } from './bodies.js';
import { b16V2, recordV2, shaV2 } from './primitives.js';
import { encodePortableTextV2, type PortableTextEncodingV2 } from './portable-text.js';
import { encodeStoreManifestV2, snapshotLocalMetadataV2 } from './projection-input.js';
import type { ProjectionV2, PortableRepresentationV2 } from './types.js';

export type PortableSnapshotInputV2 = Readonly<{
  manifest: ClipboardSnapshotManifestV2;
  receipt: CaptureContentPolicyReceiptV2;
  representations: readonly Readonly<{
    representationKey: string; itemIndex: number; blobRef: string;
    sha256: string; byteLength: number; bytes: Uint8Array;
  }>[];
}>;
export type PortableSelectionV2 = Readonly<{
  representationKey: string; encoding: PortableTextEncodingV2;
  representationHandle: string; blobId: string;
}>;
export type BuildPortableProjectionInputV2 = Readonly<{
  snapshot: PortableSnapshotInputV2;
  upsert: ClipboardJournalChangeEventV2;
  identity: Readonly<{ projectionId: string; sourceSnapshotId: string; sourceManifestRevision: string; originDeviceId: string }>;
  selections: readonly PortableSelectionV2[];
  limits: Readonly<{ maxInputBytes: number; maxOutputBytes: number; maxProjectionBytes: number }>;
  sha256: (bytes: Uint8Array) => string;
}>;
export type PortableProjectionCandidateV2 = Readonly<{
  projection: ProjectionV2;
  blobs: readonly Readonly<{ blobId: string; blobRevision: '0'; bytes: Uint8Array }>[];
}>;
const MAX_FORMAT = 10 * 1024 * 1024;
const MAX_CAPTURE = 200 * 1024 * 1024;
const MAX_METADATA = 512 * 1024;

/** Candidate generation only. Trusted owner must supply and authorize every input. */
export function buildPortableProjectionV2(input: BuildPortableProjectionInputV2): PortableProjectionCandidateV2 {
  try {
    return buildCandidate(input);
  } catch (error) {
    if (error instanceof V2ProtocolError) {
      const code = ['invalid-input', 'unsupported-version', 'over-limit', 'non-canonical'].includes(error.code) ? error.code : 'invalid-input';
      throw new V2ProtocolError(code);
    }
    return failV2();
  }
}

function buildCandidate(input: BuildPortableProjectionInputV2): PortableProjectionCandidateV2 {
  if (!input || typeof input.sha256 !== 'function' || !input.snapshot || !input.limits) failV2();
  const { maxInputBytes, maxOutputBytes, maxProjectionBytes } = input.limits;
  for (const value of [maxInputBytes, maxOutputBytes, maxProjectionBytes]) {
    if (!Number.isSafeInteger(value) || value <= 0) failV2();
  }
  const metadata = snapshotLocalMetadataV2(input.snapshot.manifest, input.snapshot.receipt);
  const manifest = ClipboardSnapshotManifestV2Schema.parse(metadata.manifest);
  const receipt = CaptureContentPolicyReceiptV2Schema.parse(metadata.receipt);
  const earlyReceipt = new Map(receipt.representations.map(row => [row.representationKey, row]));
  const event = ClipboardJournalChangeEventV2Schema.parse(input.upsert);
  if (event.eventType !== 'upsert' || event.snapshotId !== manifest.snapshotId ||
      event.manifestRevision !== manifest.manifestRevision || event.hostEpoch !== manifest.source.hostEpoch ||
      receipt.snapshotId !== manifest.snapshotId || receipt.manifestRevision !== manifest.manifestRevision ||
      receipt.receiptId !== manifest.policyReceiptId || receipt.capturedRevision !== manifest.source.osRevision) failV2();
  const identity = recordV2(snapshotJsonV2(input.identity, MAX_METADATA), ['projectionId', 'sourceSnapshotId', 'sourceManifestRevision', 'originDeviceId']);
  for (const value of Object.values(identity)) b16V2(value);
  const selectionValue = snapshotJsonV2(input.selections, MAX_METADATA);
  if (!Array.isArray(selectionValue) || selectionValue.length > 1024) failV2();
  const selections = new Map<string, PortableSelectionV2>();
  const handles = new Set<string>(), blobIds = new Set<string>();
  for (const value of selectionValue) {
    const row = recordV2(value, ['representationKey', 'encoding', 'representationHandle', 'blobId']);
    if (typeof row.representationKey !== 'string' || (row.encoding !== 'utf8' && row.encoding !== 'cf-unicode-text')) failV2();
    b16V2(row.representationHandle); b16V2(row.blobId);
    if (selections.has(row.representationKey) || handles.has(row.representationHandle) || blobIds.has(row.blobId)) failV2();
    const owned = row as PortableSelectionV2;
    selections.set(owned.representationKey, owned);
    handles.add(owned.representationHandle); blobIds.add(owned.blobId);
  }
  const raw = new Map<string, { itemIndex: number; blobRef: string; sha256: string; byteLength: number; bytes: Uint8Array }>();
  if (!Array.isArray(input.snapshot.representations) || input.snapshot.representations.length > 1024) failV2();
  let total = 0;
  for (const row of input.snapshot.representations) {
    if (!row || typeof row.representationKey !== 'string' || raw.has(row.representationKey) ||
        !Number.isSafeInteger(row.itemIndex) || row.itemIndex < 0 || typeof row.blobRef !== 'string' ||
        typeof row.sha256 !== 'string' || !Number.isSafeInteger(row.byteLength) || row.byteLength < 0) failV2();
    const receiptRow = earlyReceipt.get(row.representationKey);
    if (!receiptRow || !receiptRow.retentionAllowed) failV2();
    if (row.byteLength > maxFormatBytesV2(receiptRow.contentKind) || row.byteLength > maxInputBytes) failV2('over-limit');
    const view = inspectCapturedUint8ArrayV2(row.bytes);
    if (!view || view.byteLength !== row.byteLength) failV2();
    total += view.byteLength;
    if (total > MAX_CAPTURE || total > maxInputBytes) failV2('over-limit');
    raw.set(row.representationKey, { itemIndex: row.itemIndex, blobRef: row.blobRef, sha256: row.sha256,
      byteLength: row.byteLength, bytes: copyCapturedUint8ArrayV2(view) });
  }
  const hash = input.sha256;
  const digest = (bytes: Uint8Array): string => {
    const value = hash(Uint8Array.from(bytes));
    shaV2(value);
    return value;
  };
  // Journal manifests use sorted JSON keys. The fixed manifest schema contains no integer-like keys.
  if (digest(encodeStoreManifestV2(manifest)) !== event.manifestSha256 ||
      event.manifestRef !== `manifest:${digest(encodeCanonicalV2([manifest.snapshotId, manifest.manifestRevision], { maxBytes: 4096 }))}`) failV2();
  const receiptRows = new Map(receipt.representations.map(row => [row.representationKey, row]));
  const manifestKeys = new Set<string>();
  const items: { itemIndex: number; representations: PortableRepresentationV2[] }[] = [];
  const omissions: { itemIndex: number; reasonCode: 'unsupported' | 'policy-blocked' | 'local-only' | 'over-limit' | 'unavailable' }[] = [];
  const blobs: { blobId: string; blobRevision: '0'; bytes: Uint8Array }[] = [];
  let outputBytes = 0;
  for (const item of manifest.items) {
    const representations: PortableRepresentationV2[] = [];
    for (const rep of item.representations) {
      manifestKeys.add(rep.representationKey);
      const receiptRow = receiptRows.get(rep.representationKey);
      if (!receiptRow || receiptRow.itemIndex !== item.index || receiptRow.retentionAllowed !== (rep.state === 'ready')) failV2();
      const binding = raw.get(rep.representationKey);
      if (receiptRow.retentionAllowed) {
        if (receiptRow.byteLength > maxFormatBytesV2(receiptRow.contentKind)) failV2('over-limit');
        if (!binding || binding.itemIndex !== item.index || binding.sha256 !== receiptRow.sha256 ||
            binding.byteLength !== receiptRow.byteLength || binding.blobRef !== `sha256-${binding.sha256}` ||
            digest(binding.bytes) !== binding.sha256 || rep.state !== 'ready') failV2();
        if (rep.storage === 'blob' && (rep.blobRef !== binding.blobRef || rep.sha256 !== binding.sha256 || rep.byteLength !== binding.byteLength)) failV2();
        if ((receiptRow.contentKind === 'file-reference') !== (rep.storage === 'file-reference')) failV2();
      } else {
        if (binding || rep.state === 'ready') failV2();
        if (receiptRow.reasonCode === 'required-check-unavailable') {
          if (rep.state !== 'policy-blocked' || rep.reasonCode !== receiptRow.reasonCode) failV2();
        } else if (rep.state !== receiptRow.reasonCode || rep.reasonCode !== receiptRow.reasonCode) failV2();
      }
      const choice = selections.get(rep.representationKey);
      if (!choice) {
        omissions.push({ itemIndex: item.index, reasonCode: rep.state === 'policy-blocked' ? 'policy-blocked' : rep.state === 'over-limit' ? 'over-limit' : rep.state === 'ready' && rep.storage === 'file-reference' ? 'local-only' : rep.state === 'ready' ? 'unsupported' : 'unavailable' });
        continue;
      }
      if (!receiptRow.retentionAllowed || receiptRow.contentKind !== 'text' || rep.state !== 'ready' || rep.storage !== 'blob' || !binding) failV2();
      // Only this documented source format has a verified mapping in this slice.
      if (manifest.source.platform !== 'macos' || rep.formatId !== 'public.utf8-plain-text' ||
          rep.nativeName !== 'public.utf8-plain-text' || choice.encoding !== 'utf8') failV2();
      const bytes = encodePortableTextV2(binding.bytes, choice.encoding, { maxInputBytes: Math.min(MAX_FORMAT, maxInputBytes), maxOutputBytes: Math.min(MAX_FORMAT, maxOutputBytes) });
      outputBytes += bytes.length;
      if (outputBytes > MAX_CAPTURE || outputBytes > maxOutputBytes) failV2('over-limit');
      const portableCodecId = 'unicode-text-utf8', codecVersion = '1';
      representations.push({ representationHandle: choice.representationHandle, portableCodecId, codecVersion,
        blobId: choice.blobId, blobRevision: '0', sha256: digest(bytes), byteLength: bytes.length, provenance: { relation: 'undisclosed' } });
      blobs.push({ blobId: choice.blobId, blobRevision: '0', bytes });
    }
    if (representations.length) items.push({ itemIndex: item.index, representations });
  }
  if (receiptRows.size !== manifestKeys.size || raw.size !== receipt.representations.filter(row => row.retentionAllowed).length ||
      [...selections.keys()].some(key => !manifestKeys.has(key))) failV2();
  if (!blobs.length) failV2();
  const body = { bodyVersion: 2 as const, projectionId: identity.projectionId as string,
    sourceSnapshotId: identity.sourceSnapshotId as string, sourceManifestRevision: identity.sourceManifestRevision as string,
    sourceCursor: { hostEpoch: event.hostEpoch, changeSeq: event.changeSeq }, originDeviceId: identity.originDeviceId as string,
    items, omissions };
  const maxBytes = Math.min(MAX_METADATA, maxProjectionBytes);
  const projection = validateProjectionV2({ ...body, projectionDigest: digest(encodeCanonicalV2(body, { maxBytes })) }, maxBytes);
  return Object.freeze({ projection: verifyProjectionDigestV2(projection, maxBytes, digest), blobs: Object.freeze(blobs) });
}
