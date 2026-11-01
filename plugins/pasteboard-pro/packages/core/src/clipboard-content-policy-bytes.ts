export type CapturedByteViewV2 = Readonly<{
  buffer: ArrayBuffer;
  byteOffset: number;
  byteLength: number;
}>;

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayTagGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)?.get;
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")?.get;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")?.get;
const typedArrayByteOffsetGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")?.get;
const arrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")?.get;
const Uint8ArrayConstructor = Uint8Array;
const Uint8ArraySet = Uint8Array.prototype.set;

const MiB = 1024 * 1024;
export const MAX_FORMAT_BYTES_V2 = 100 * MiB;
export const MAX_TEXTUAL_FORMAT_BYTES_V2 = 10 * MiB;
export const MAX_SNAPSHOT_BYTES_V2 = 200 * MiB;

export function inspectCapturedUint8ArrayV2(value: unknown): CapturedByteViewV2 | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    typedArrayTagGetter === undefined ||
    typedArrayBufferGetter === undefined ||
    typedArrayByteLengthGetter === undefined ||
    typedArrayByteOffsetGetter === undefined ||
    arrayBufferByteLengthGetter === undefined
  ) return undefined;

  try {
    if (typedArrayTagGetter.call(value) !== "Uint8Array") return undefined;
    const buffer = typedArrayBufferGetter.call(value);
    const bufferLength = arrayBufferByteLengthGetter.call(buffer);
    const byteLength = typedArrayByteLengthGetter.call(value);
    const byteOffset = typedArrayByteOffsetGetter.call(value);
    if (
      typeof bufferLength !== "number" ||
      typeof byteLength !== "number" ||
      typeof byteOffset !== "number" ||
      !Number.isSafeInteger(bufferLength) ||
      !Number.isSafeInteger(byteLength) ||
      !Number.isSafeInteger(byteOffset) ||
      byteLength < 0 ||
      byteOffset < 0 ||
      byteOffset + byteLength > bufferLength
    ) return undefined;

    new Uint8ArrayConstructor(buffer as ArrayBuffer, byteOffset, byteLength);
    return Object.freeze({ buffer: buffer as ArrayBuffer, byteOffset, byteLength });
  } catch {
    // The intrinsic ArrayBuffer getter rejects SharedArrayBuffer and detached views.
    return undefined;
  }
}

export function isArrayBufferBackedUint8ArrayV2(value: unknown): value is Uint8Array {
  return inspectCapturedUint8ArrayV2(value) !== undefined;
}

export function copyCapturedUint8ArrayV2(info: CapturedByteViewV2): Uint8Array {
  const source = new Uint8ArrayConstructor(info.buffer, info.byteOffset, info.byteLength);
  const copy = new Uint8ArrayConstructor(info.byteLength);
  Uint8ArraySet.call(copy, source);
  return copy;
}

export function maxFormatBytesV2(contentKind: string): number {
  return contentKind === "text" || contentKind === "rich-text" || contentKind === "url"
    ? MAX_TEXTUAL_FORMAT_BYTES_V2
    : MAX_FORMAT_BYTES_V2;
}

export async function sha256CapturedBytesV2(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error();
  const digest = await subtle.digest("SHA-256", bytes as BufferSource);
  let result = "";
  for (const byte of new Uint8ArrayConstructor(digest)) result += byte.toString(16).padStart(2, "0");
  return result;
}
