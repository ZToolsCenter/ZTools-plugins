import { failV2 } from './canonical.js';
export type RecordV2 = Record<string, unknown>;
export function recordV2(v: unknown, keys: readonly string[]): RecordV2 {
    if (!v || typeof v !== 'object' || Array.isArray(v) || (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null))
        failV2();
    const r = v as RecordV2;
    const k = Reflect.ownKeys(r);
    if (k.length !== keys.length || k.some(x => typeof x !== 'string' || !keys.includes(x)))
        failV2();
    for (const name of keys) {
        const d = Object.getOwnPropertyDescriptor(r, name);
        if (!d || !('value' in d) || !d.enumerable)
            failV2();
    }
    return r;
}
export function literalV2(v: unknown, expected: unknown): void {
    if (v !== expected)
        failV2();
}
export function oneOfV2(v: unknown, values: readonly string[]): asserts v is string {
    if (typeof v !== 'string' || !values.includes(v))
        failV2();
}
export function u64V2(v: unknown): asserts v is string {
    if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(v) || BigInt(v) > 18446744073709551615n)
        failV2();
}
export function shaV2(v: unknown): asserts v is string {
    if (typeof v !== 'string' || !/^[0-9a-f]{64}$/.test(v))
        failV2();
}
export function idV2(v: unknown): asserts v is string {
    if (typeof v !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v))
        failV2();
}
export function intV2(v: unknown, max: number): asserts v is number {
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > max)
        failV2();
}
export function arrayV2(v: unknown, max: number): asserts v is unknown[] {
    if (!Array.isArray(v) || v.length > max)
        failV2();
}
/** Caps all untrusted binary decoding before allocation; an empty value is allowed with a positive cap. */
export function validateByteLimitV2(maxBytes: number): void {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > 200 * 1024 * 1024)
        failV2('invalid-input');
}
const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function decodeBase64urlV2(v: unknown, size?: number, maxBytes = 256 * 1024): Uint8Array {
    validateByteLimitV2(maxBytes);
    if (size !== undefined && (!Number.isSafeInteger(size) || size < 0 || size > maxBytes))
        failV2('invalid-input');
    if (typeof v !== 'string' || v.length > Math.ceil(maxBytes * 4 / 3) || v.length % 4 === 1 || !/^[A-Za-z0-9_-]*$/.test(v))
        failV2();
    const output = new Uint8Array(Math.floor(v.length * 6 / 8));
    let acc = 0, bits = 0, n = 0;
    for (const c of v) {
        acc = (acc << 6) | chars.indexOf(c);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            output[n++] = (acc >>> bits) & 255;
            acc &= (1 << bits) - 1;
        }
    }
    if (acc !== 0 || (size !== undefined && output.length !== size) || output.length > maxBytes)
        failV2();
    return output;
}
export function b16V2(v: unknown): asserts v is string {
    decodeBase64urlV2(v, 16);
}
export function b32V2(v: unknown): asserts v is string {
    decodeBase64urlV2(v, 32);
}
export function assertVersionV2(value: unknown, key: string): void {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        failV2();
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !('value' in d))
        failV2();
    if (d.value !== 2)
        failV2('unsupported-version');
}
