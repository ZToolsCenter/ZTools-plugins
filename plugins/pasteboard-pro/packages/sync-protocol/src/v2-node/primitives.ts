import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, scrypt as scryptCallback, timingSafeEqual, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { types } from "node:util";
import { encodeCanonicalV2, validateHeaderV2, encodeEnvelopeV2, decodeBase64urlV2, type V2Header, type V2Limits } from "../v2.js";
import { V2NodeError, type V2Scope } from "./types.js";
export const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
export const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const bufferOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!;
const offsetOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")!.get!;
const lengthOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;
export function own(value: Uint8Array, exact?: number, max = 200 * 1024 * 1024 + 8192): Buffer {
    if (!types.isUint8Array(value))
        throw new V2NodeError("context-mismatch");
    const buffer = bufferOf.call(value) as ArrayBuffer;
    const byteOffset = offsetOf.call(value) as number;
    const byteLength = lengthOf.call(value) as number;
    if (types.isSharedArrayBuffer(buffer) || (exact !== undefined && byteLength !== exact) || byteLength > max)
        throw new V2NodeError("context-mismatch");
    // Native intrinsic slots, not overridable getters/iterator or aliased Buffer views.
    return Buffer.from(new Uint8Array(buffer, byteOffset, byteLength));
}
export function equal(left: Uint8Array, right: Uint8Array): boolean {
    return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}
export function canonical(value: unknown, maxBytes = 65536): Uint8Array {
    return encodeCanonicalV2(value, { maxBytes });
}
export function without(value: object, ...keys: string[]): Record<string, unknown> {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}
export function objectInfo(header: V2Header): Uint8Array {
    return canonical(["PasteboardPro/v2", header.suite, header.model, header.purpose,
        header.accountBindingId, header.vaultId, header.keyEpoch, header.writerDomainId,
        header.objectType, header.objectId, header.revision, header.attemptId], 4096);
}
export function deriveKey(ikm: Uint8Array, info: Uint8Array): Buffer {
    return Buffer.from(hkdfSync("sha256", ikm, Buffer.alloc(32), info, 32));
}
export function macKey(root: Uint8Array, scope: V2Scope, role: "control-auth" | "publication-auth"): Buffer {
    return deriveKey(root, canonical(["PasteboardPro/v2", "PBV2-A256GCM-HKDF256-SCRYPT1",
        "portable-snapshot-v2", role, scope.accountBindingId, scope.vaultId, scope.keyEpoch]));
}
export function mac(root: Uint8Array, scope: V2Scope, role: "control-auth" | "publication-auth", bytes: Uint8Array): string {
    const key = macKey(root, scope, role);
    try {
        return b64(createHmac("sha256", key).update(bytes).digest());
    }
    finally {
        key.fill(0);
    }
}
/** Internal deterministic executor for protocol vectors. Never exported by v2-node.ts.
 * Production callers use createV2NodeCodec, which owns entropy and durable admission. */
export function sealDeterministic(ikm: Uint8Array, header: V2Header, plaintext: Uint8Array, limits: V2Limits): Uint8Array {
    validateHeaderV2(header, limits);
    const key = deriveKey(ikm, objectInfo(header));
    try {
        const nonce = decodeBase64urlV2(header.nonce, 12);
        const headerBytes = canonical(header, 4096);
        const prefix = Buffer.alloc(8);
        prefix.write("PBV2", 0, "ascii");
        prefix.writeUInt32BE(headerBytes.length, 4);
        const aad = Buffer.concat([prefix, headerBytes]);
        const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
        cipher.setAAD(aad);
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        return encodeEnvelopeV2(header, ciphertext, cipher.getAuthTag(), limits);
    }
    finally {
        key.fill(0);
    }
}
export function openAuthenticated(ikm: Uint8Array, parsed: {
    header: V2Header;
    ciphertext: Uint8Array;
    tag: Uint8Array;
    aad: Uint8Array;
}): Buffer {
    const key = deriveKey(ikm, objectInfo(parsed.header));
    let pending: Buffer | undefined;
    try {
        const decipher = createDecipheriv("aes-256-gcm", key, decodeBase64urlV2(parsed.header.nonce, 12), { authTagLength: 16 });
        decipher.setAAD(parsed.aad);
        decipher.setAuthTag(parsed.tag);
        pending = decipher.update(parsed.ciphertext);
        const tail = decipher.final(); // No update bytes escape before successful final.
        return Buffer.concat([pending, tail]);
    }
    catch {
        throw new V2NodeError("authentication-failed");
    }
    finally {
        pending?.fill(0);
        key.fill(0);
    }
}
/** Encoding only. Creation UX policy belongs to the trusted host; unlock must
 * preserve all previously valid UTF-8 password material, including empty bytes. */
export function passwordBytes(password: string): Buffer {
    if (typeof password !== "string")
        throw new V2NodeError("context-mismatch");
    for (let i = 0; i < password.length; i++) {
        const c = password.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) {
            const d = password.charCodeAt(++i);
            if (!(d >= 0xdc00 && d <= 0xdfff))
                throw new V2NodeError("context-mismatch");
        }
        else if (c >= 0xdc00 && c <= 0xdfff)
            throw new V2NodeError("context-mismatch");
    }
    if (Buffer.byteLength(password, "utf8") > 1024)
        throw new V2NodeError("context-mismatch");
    return Buffer.from(password, "utf8");
}
/** Must run in a supervised host helper. Node threadpool is not cancellation or
 * hard RSS/timeout enforcement. This library does not start or stop helpers. */
export async function passwordKey(password: Buffer, salt: Uint8Array): Promise<Buffer> {
    if (salt.length !== 32)
        throw new V2NodeError("context-mismatch");
    return await new Promise<Buffer>((resolve, reject) => scryptCallback(password, salt, 32, { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}
const privatePrefix = Buffer.from("302e020100300506032b657004220420", "hex");
const publicPrefix = Buffer.from("302a300506032b6570032100", "hex");
export function adminPublic(seed: Uint8Array): Uint8Array {
    const bytes = own(seed, 32);
    const der = Buffer.concat([privatePrefix, bytes]);
    try {
        const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
        return new Uint8Array(createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32));
    }
    finally {
        bytes.fill(0);
        der.fill(0);
    }
}
export function adminSign(seed: Uint8Array, bytes: Uint8Array): string {
    const owned = own(seed, 32), der = Buffer.concat([privatePrefix, owned]);
    try {
        return b64(sign(null, bytes, createPrivateKey({ key: der, format: "der", type: "pkcs8" })));
    }
    finally {
        owned.fill(0);
        der.fill(0);
    }
}
export function adminVerify(publicKey: Uint8Array, bytes: Uint8Array, signature: unknown): boolean {
    const publicBytes = own(publicKey, 32), sig = decodeBase64urlV2(signature, 64);
    return verify(null, bytes, createPublicKey({ key: Buffer.concat([publicPrefix, publicBytes]), format: "der", type: "spki" }), sig);
}
