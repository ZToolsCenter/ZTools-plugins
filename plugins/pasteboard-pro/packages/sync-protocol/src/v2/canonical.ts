export type V2ErrorCode = 'invalid-input' | 'unsupported-version' | 'over-limit' | 'non-canonical';
export class V2ProtocolError extends Error {
    constructor(public readonly code: V2ErrorCode) {
        super(code);
        this.name = 'V2ProtocolError';
    }
}
export function failV2(code: V2ErrorCode = 'invalid-input'): never {
    throw new V2ProtocolError(code);
}
export type CanonicalLimitsV2 = {
    maxBytes: number;
    maxDepth?: number;
    maxNodes?: number;
};
const unicode = (s: string): boolean => {
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) {
            const d = s.charCodeAt(++i);
            if (!(d >= 0xdc00 && d <= 0xdfff))
                return false;
        }
        else if (c >= 0xdc00 && c <= 0xdfff)
            return false;
    }
    return true;
};
export function encodeCanonicalV2(value: unknown, limits: CanonicalLimitsV2): Uint8Array {
    if (!Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 1 || limits.maxBytes > 200 * 1024 * 1024)
        failV2();
    const maxDepth = limits.maxDepth ?? 64, maxNodes = limits.maxNodes ?? 100000;
    if (!Number.isSafeInteger(maxDepth) || maxDepth < 1 || maxDepth > 128 || !Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 1000000)
        failV2();
    const encoder = new TextEncoder();
    let length = 0, nodes = 0;
    const parts: string[] = [], seen = new Set<object>();
    const add = (part: string) => {
        length += encoder.encode(part).length;
        if (length > limits.maxBytes)
            failV2('over-limit');
        parts.push(part);
    };
    const walk = (item: unknown, depth: number): void => {
        if (++nodes > maxNodes || depth > maxDepth)
            failV2('over-limit');
        if (item === null || typeof item === 'boolean') {
            add(JSON.stringify(item));
            return;
        }
        if (typeof item === 'string') {
            if (!unicode(item))
                failV2();
            if (item.length > limits.maxBytes)
                failV2('over-limit');
            add(JSON.stringify(item));
            return;
        }
        if (typeof item === 'number') {
            if (!Number.isFinite(item))
                failV2();
            add(JSON.stringify(item));
            return;
        }
        if (typeof item !== 'object' || seen.has(item))
            failV2();
        seen.add(item);
        if (Array.isArray(item)) {
            if (item.length > maxNodes - nodes)
                failV2('over-limit');
            if (Object.getPrototypeOf(item) !== Array.prototype || Reflect.ownKeys(item).length !== item.length + 1)
                failV2();
            add('[');
            for (let i = 0; i < item.length; i++) {
                const d = Object.getOwnPropertyDescriptor(item, String(i));
                if (!d || !('value' in d) || !d.enumerable)
                    failV2();
                if (i)
                    add(',');
                walk(d.value, depth + 1);
            }
            add(']');
        }
        else {
            const proto = Object.getPrototypeOf(item);
            if (proto !== Object.prototype && proto !== null)
                failV2();
            const keys = Reflect.ownKeys(item);
            if (keys.length > maxNodes - nodes)
                failV2('over-limit');
            if (keys.some(k => typeof k !== 'string'))
                failV2();
            const strings = keys as string[];
            strings.sort();
            add('{');
            let first = true;
            for (const k of strings) {
                const d = Object.getOwnPropertyDescriptor(item, k);
                if (!d || !('value' in d) || !d.enumerable || !unicode(k))
                    failV2();
                if (!first)
                    add(',');
                first = false;
                if (k.length > limits.maxBytes)
                    failV2('over-limit');
                add(JSON.stringify(k));
                add(':');
                walk(d.value, depth + 1);
            }
            add('}');
        }
        seen.delete(item);
    };
    walk(value, 0);
    return encoder.encode(parts.join(''));
}
export function decodeCanonicalV2(bytes: Uint8Array, limits: CanonicalLimitsV2): unknown {
    if (!(bytes instanceof Uint8Array) || bytes.buffer instanceof SharedArrayBuffer || bytes.byteLength > limits.maxBytes)
        failV2('over-limit');
    let parsed: unknown;
    try {
        parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    }
    catch {
        return failV2();
    }
    const encoded = encodeCanonicalV2(parsed, limits);
    if (encoded.length !== bytes.length || encoded.some((b, i) => b !== bytes[i]))
        failV2('non-canonical');
    return parsed;
}

/** Copy and freeze a validated JSON value; no reference aliases survive. */
export function snapshotJsonV2<T>(value: unknown, maxBytes: number): T {
    const clone = decodeCanonicalV2(encodeCanonicalV2(value, { maxBytes }), { maxBytes });
    function freeze(item: unknown): void {
        if (item !== null && typeof item === 'object') {
            for (const child of Object.values(item)) freeze(child);
            Object.freeze(item);
        }
    }
    freeze(clone);
    return clone as T;
}
