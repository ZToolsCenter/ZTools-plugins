type RecordV2 = Record<string, unknown>;
import { decodeCanonicalV2, validateProjectionV2, validateIndexV2, validateTombstoneV2, parseUntrustedBlobBodyV2, type V2Header } from "../v2.js";
import { canonical, sha256, without } from "./primitives.js";
import { checkedKeyring } from "./records.js";
import { V2NodeError, type V2Expected } from "./types.js";
/** Schema/hash checks only. Policy/codec allowlists and activation remain host duties. */
export function validatePlaintext(header: V2Header, bytes: Uint8Array, maxBytes: number, expected?: V2Expected, allowFutureProjection = false): "known" | "quarantine" {
    if (bytes.length !== Number(header.plaintextLength))
        throw new V2NodeError("context-mismatch");
    if (header.objectType === "root-wrap") {
        if (bytes.length !== 32)
            throw new V2NodeError("context-mismatch");
        return "known";
    }
    if (header.objectType === "blob") {
        const { metadata: m, bytes: payload } = parseUntrustedBlobBodyV2(bytes, maxBytes);
        if (m.blobId !== header.objectId || m.blobRevision !== header.revision || m.sha256 !== sha256(payload))
            throw new V2NodeError("context-mismatch");
        if (expected) {
            const b = expected.blobBinding;
            if (!b || b.sha256 !== m.sha256 || b.byteLength !== m.byteLength || b.portableCodecId !== m.portableCodecId ||
                b.codecVersion !== m.codecVersion)
                throw new V2NodeError("context-mismatch");
        }
        return "known";
    }
    if (header.objectType === "keyring") {
        checkedKeyring(bytes, header);
        return "known";
    }
    const value = decodeCanonicalV2(bytes, { maxBytes }) as RecordV2;
    if (header.objectType === "projection") {
        if (allowFutureProjection && typeof value.bodyVersion === "number" && Number.isSafeInteger(value.bodyVersion) && value.bodyVersion > 2)
            return "quarantine";
        const p = validateProjectionV2(value, maxBytes);
        if (p.projectionId !== header.objectId || p.projectionDigest !== sha256(canonical(without(p, "projectionDigest"), maxBytes)))
            throw new V2NodeError("context-mismatch");
    }
    else if (header.objectType === "index") {
        const p = validateIndexV2(value, maxBytes);
        if (p.indexRevision !== header.revision)
            throw new V2NodeError("context-mismatch");
    }
    else {
        const p = validateTombstoneV2(value, maxBytes);
        if (p.tombstoneRevision !== header.revision)
            throw new V2NodeError("context-mismatch");
    }
    return "known";
}
