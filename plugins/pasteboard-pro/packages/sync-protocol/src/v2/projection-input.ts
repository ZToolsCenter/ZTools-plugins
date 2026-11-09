import { failV2 } from './canonical.js';

const MAX_METADATA = 8 * 1024 * 1024;
function field(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') failV2();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) failV2();
  return descriptor.value;
}
function boundedArray(value: unknown, maximum: number): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > maximum) failV2('over-limit');
}

/** Validate structural counts before descending into any representation. */
export function snapshotLocalMetadataV2(manifest: unknown, receipt: unknown): { manifest: unknown; receipt: unknown } {
  const items = field(manifest, 'items');
  boundedArray(items, 32);
  for (let i = 0; i < items.length; i++) {
    const representations = field(field(items, String(i)), 'representations');
    boundedArray(representations, 32);
  }
  boundedArray(field(receipt, 'representations'), 1024);
  let nodes = 0, bytes = 0;
  const seen = new Set<object>();
  const charge = (amount: number) => {
    bytes += amount;
    if (bytes > MAX_METADATA) failV2('over-limit');
  };
  // Count JSON.stringify's UTF-8 bytes without allocating a potentially huge escaped string.
  const chargeString = (value: string) => {
    charge(2);
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code === 0x22 || code === 0x5c) charge(2);
      else if (code < 0x20) charge([8, 9, 10, 12, 13].includes(code) ? 2 : 6);
      else if (code < 0x80) charge(1);
      else if (code < 0x800) charge(2);
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) { charge(4); i++; }
        else charge(6);
      } else if (code >= 0xdc00 && code <= 0xdfff) charge(6);
      else charge(3);
    }
  };
  const clone = (value: unknown, depth: number): unknown => {
    if (++nodes > 100_000 || depth > 64) failV2('over-limit');
    if (value === null) { charge(4); return value; }
    if (typeof value === 'boolean') { charge(value ? 4 : 5); return value; }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) failV2();
      charge(JSON.stringify(value).length);
      return value;
    }
    if (typeof value === 'string') { chargeString(value); return value; }
    if (typeof value !== 'object' || seen.has(value)) failV2();
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        if (value.length > 100_000 - nodes) failV2('over-limit');
        if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) failV2();
        charge(2 + Math.max(0, value.length - 1));
        const result: unknown[] = [];
        for (let i = 0; i < value.length; i++) result.push(clone(field(value, String(i)), depth + 1));
        return result;
      }
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) failV2();
      const result: Record<string, unknown> = {};
      let members = 0;
      charge(2);
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string') failV2();
        const child = field(value, key);
        if (child !== undefined) {
          if (members++) charge(1);
          chargeString(key);
          charge(1);
          result[key] = clone(child, depth + 1);
        }
      }
      return result;
    } finally { seen.delete(value); }
  };
  return { manifest: clone(manifest, 0), receipt: clone(receipt, 0) };
}

/** Matches snapshot-store canonicalJsonV2 (not wire JCS). */
export function encodeStoreManifestV2(value: unknown): Uint8Array {
  const sort = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(sort);
    if (entry && typeof entry === 'object') {
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(entry).sort()) {
        const child = (entry as Record<string, unknown>)[key];
        if (child !== undefined) result[key] = sort(child);
      }
      return result;
    }
    return entry;
  };
  return new TextEncoder().encode(JSON.stringify(sort(value)));
}
