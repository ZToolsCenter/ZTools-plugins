import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { createV2NodeCodec, type V2NodeCodecOptions, type V2SealContext } from "../src/v2-node";
import { decodeCanonicalV2, encodeCanonicalV2, parseUntrustedEnvelopeV2, type ControlV2, type PublicationRootV2 } from "../src/v2";
import { sha256 } from "../src/v2-node/primitives";
const f = JSON.parse(readFileSync(new URL("../fixtures/crypto-v2.json", import.meta.url), "utf8"));
const c = f.vectors.control, p = f.vectors.publication, pkg = f.vectors.recoveryPackage;
const bytes = (h: string) => Buffer.from(h, "hex");
const root = () => bytes(f.vectors.index.input.ikmHex);
const seed = () => bytes(c.input.adminSeedHex);
const controlBytes = () => bytes(c.expected.canonicalHex);
const publicationBytes = () => bytes(p.expected.canonicalHex);
function context(record = c.expected.record, wire: Uint8Array = controlBytes()) {
    return { accountBindingId: record.accountBindingId, vaultId: record.vaultId, keyEpoch: record.keyEpoch,
        adminPublicKey: bytes(c.input.adminPublicKeyHex), controlRevision: record.controlRevision,
        controlSha256: sha256(wire), rootId: record.rootId, managementInstanceId: record.managementInstanceId };
}
function harness() {
    let n = 0;
    const auth = { authorize: vi.fn(async () => ({ token: "PUBLIC-test", mode: "registered" as "registered" | "bootstrap-prepare" })), fence: vi.fn(async () => { }) };
    const budget = { reserveSeal: vi.fn(async () => ({ counter: String(n++) })), registerAttempt: vi.fn(async () => { }),
        reserveVerification: vi.fn(async () => { }), recordAuthentication: vi.fn(async () => { }) };
    const options: V2NodeCodecOptions = { limits: { maxPlaintextBytes: 1024 * 1024 }, authorization: auth, budget };
    return { codec: createV2NodeCodec(options), auth, budget };
}
const wrapperContext = (id: number): V2SealContext => ({ accountBindingId: c.input.body.accountBindingId,
    vaultId: c.input.body.vaultId, keyEpoch: "0", objectType: "root-wrap", objectId: Buffer.alloc(16, id).toString("base64url"),
    revision: "0", writerDomainId: c.input.body.writerDomains[0].writerDomainId });
describe("V2 control, immutable wrappers and anchored recovery", () => {
    it("seals fresh fixed-cost password wrappers and unlocks a short existing legal password", async () => {
        const h = harness();
        h.auth.authorize.mockResolvedValue({ token: "PUBLIC-test", mode: "bootstrap-prepare" });
        const wrapped = await h.codec.wrapPassword({ root: root(), password: "x", context: wrapperContext(30), authority: { bootstrap: true } });
        const header = parseUntrustedEnvelopeV2(wrapped, { maxPlaintextBytes: 32 }).header;
        expect(header.purpose).toBe("password-wrap");
        if (header.purpose === "password-wrap") {
            expect(header.wrapParams).toMatchObject({ N: 131072, r: 8, p: 1, dkLen: 32 });
            expect(Buffer.from(header.wrapParams.salt, "base64url")).toHaveLength(32);
        }
        const signed = await h.codec.signControl({ body: { ...c.input.body, passwordWrap: Buffer.from(wrapped).toString("base64url") }, root: root(), adminSeed: seed() });
        const record = decodeCanonicalV2(signed, { maxBytes: 65536 }) as ControlV2;
        h.auth.authorize.mockResolvedValue({ token: "PUBLIC-test", mode: "registered" });
        expect(await h.codec.unlockPassword({ password: "x", control: signed, expected: context(record, signed) })).toEqual(new Uint8Array(root()));
        await expect(h.codec.unlockPassword({ password: "not-x", control: signed, expected: context(record, signed) })).rejects.toMatchObject({ code: "authentication-failed" });
    });
    it("consumes immutable bootstrap wrapper IDs and refuses reusing wrappers already in signed control", async () => {
        const h = harness();
        h.auth.authorize.mockResolvedValue({ token: "PUBLIC-test", mode: "bootstrap-prepare" });
        const args = { root: root(), context: wrapperContext(31), recoverySecret: Buffer.alloc(32, 5), authority: { bootstrap: true } as const };
        await h.codec.wrapRecovery(args);
        await expect(h.codec.wrapRecovery(args)).rejects.toMatchObject({ code: "unavailable" });
        const old = parseUntrustedEnvelopeV2(Buffer.from(c.input.body.recoveryWrap, "base64url"), { maxPlaintextBytes: 32 }).header;
        const normal = harness();
        await expect(normal.codec.wrapRecovery({ ...args, context: { ...args.context, objectId: old.objectId },
            authority: { control: controlBytes(), expected: context() } })).rejects.toMatchObject({ code: "context-mismatch" });
    });
    it("password rewrap can preserve old recovery bytes without the recovery secret", async () => {
        const h = harness();
        const next = await h.codec.signControl({ body: { ...c.input.body, controlRevision: "1", prevControlDigest: c.expected.sha256 },
            root: root(), adminSeed: seed() });
        const record = decodeCanonicalV2(next, { maxBytes: 65536 }) as ControlV2;
        expect(record.recoveryWrap).toBe(c.input.body.recoveryWrap);
        await expect(h.codec.verifyControlSuccessor({ previous: { root: root(), control: controlBytes(), expected: context() },
            next: { root: root(), control: next, expected: context(record, next) }, previousPublicationSha256: p.expected.sha256 })).resolves.toBeDefined();
    });
    it("rejects deleted domains and management transfer under the same root/epoch even when signed", async () => {
        for (const change of [{ writerDomains: [{ ...c.input.body.writerDomains[0], status: "revoked" }],
                managementInstanceId: Buffer.alloc(32, 7).toString("base64url") },
            { rootId: Buffer.alloc(32, 8).toString("base64url") }]) {
            const h = harness(), next = await h.codec.signControl({ body: { ...c.input.body, ...change,
                    controlRevision: "1", prevControlDigest: c.expected.sha256 }, root: root(), adminSeed: seed() });
            const record = decodeCanonicalV2(next, { maxBytes: 65536 }) as ControlV2;
            await expect(h.codec.verifyControlSuccessor({ previous: { root: root(), control: controlBytes(), expected: context() },
                next: { root: root(), control: next, expected: context(record, next) }, previousPublicationSha256: p.expected.sha256 })).rejects.toMatchObject({ code: "conflict" });
        }
    });
    it("follows a reachable authenticated publication successor but refuses forks and returns no admin authority", async () => {
        const h = harness(), next = await h.codec.signPublication({ body: { ...p.input.body, publicationRevision: "1",
                previousPublicationDigest: p.expected.sha256 }, root: root(), control: controlBytes(), controlExpected: context() });
        const recovered = await h.codec.recoverPackageToControl({ packageBytes: bytes(pkg.expected.canonicalHex),
            expectedPackageSha256: pkg.expected.sha256, steps: [{ control: controlBytes(), publication: next }] });
        expect(recovered.status).toBe("read-only-recovered");
        expect(recovered.freshness).toBe("trusted-anchor-only");
        expect(recovered.root).toEqual(new Uint8Array(root()));
        expect("adminSeed" in recovered).toBe(false);
        expect("writerDomainId" in recovered).toBe(false);
        const fork = await h.codec.signPublication({ body: { ...p.input.body, publicationRevision: "1",
                previousPublicationDigest: "0".repeat(64) }, root: root(), control: controlBytes(), controlExpected: context() });
        await expect(h.codec.recoverPackageToControl({ packageBytes: bytes(pkg.expected.canonicalHex),
            expectedPackageSha256: pkg.expected.sha256, steps: [{ control: controlBytes(), publication: fork }] })).rejects.toMatchObject({ code: "conflict" });
    });
});
async function transition(h: ReturnType<typeof harness>, recoverySecret: Uint8Array) {
    const nextRoot = Buffer.alloc(32, 33), nextDomain = Buffer.alloc(32, 34).toString("base64url");
    const scope = { accountBindingId: c.input.body.accountBindingId, vaultId: c.input.body.vaultId, keyEpoch: "1" };
    const wrap = (id: number): V2SealContext => ({ ...scope, objectType: "root-wrap", objectId: Buffer.alloc(16, id).toString("base64url"),
        revision: "0", writerDomainId: nextDomain });
    h.auth.authorize.mockResolvedValue({ token: "PUBLIC-test", mode: "bootstrap-prepare" });
    const pw = await h.codec.wrapPassword({ root: nextRoot, password: "PUBLIC transition password", context: wrap(40), authority: { bootstrap: true } });
    const recovery = await h.codec.wrapRecovery({ root: nextRoot, recoverySecret, context: wrap(41), authority: { bootstrap: true } });
    const keyringBody = encodeCanonicalV2({ keyringVersion: 2, ...scope, history: [{ keyEpoch: "0", root: root().toString("base64url") }] }, { maxBytes: 65536 });
    const keyringId = Buffer.alloc(16, 42).toString("base64url");
    const keyring = await h.codec.sealObject({ root: nextRoot, plaintext: keyringBody, context: { ...scope, objectType: "keyring",
            objectId: keyringId, revision: "0", writerDomainId: nextDomain }, authority: { bootstrap: true } });
    const signed = await h.codec.signControl({ root: nextRoot, adminSeed: seed(), body: { ...c.input.body, ...scope,
            rootId: Buffer.alloc(32, 43).toString("base64url"), managementInstanceId: Buffer.alloc(32, 44).toString("base64url"),
            controlRevision: "1", prevControlDigest: c.expected.sha256, writerDomains: [{ writerDomainId: nextDomain, status: "active" }],
            passwordWrap: Buffer.from(pw).toString("base64url"), recoveryWrap: Buffer.from(recovery).toString("base64url"),
            keyringDescriptor: { objectType: "keyring", objectId: keyringId, revision: "0", envelopeSha256: sha256(keyring) },
            transition: { previousEpoch: "0", previousRootId: c.expected.record.rootId, previousManagementInstanceId: c.expected.record.managementInstanceId,
                previousControlDigest: c.expected.sha256, previousPublicationDigest: p.expected.sha256 } } });
    h.auth.authorize.mockResolvedValue({ token: "PUBLIC-test", mode: "registered" });
    const record = decodeCanonicalV2(signed, { maxBytes: 65536 }) as ControlV2;
    const pub = await h.codec.signPublication({ root: nextRoot, control: signed, controlExpected: context(record, signed),
        body: { ...p.input.body, ...scope, publicationRevision: "1", previousPublicationDigest: p.expected.sha256,
            controlDescriptor: { controlRevision: "1", controlSha256: sha256(signed) } } });
    return { nextRoot, signed, pub, keyring };
}
describe("read-only epoch recovery and authenticated history keyring", () => {
    it("links a fresh root transition to the old anchor and reads old roots only through signed keyring bytes", async () => {
        const h = harness(), secret = Buffer.from(pkg.input.body.recoverySecret, "base64url"), next = await transition(h, secret);
        const result = await h.codec.recoverPackageToControl({ packageBytes: bytes(pkg.expected.canonicalHex), expectedPackageSha256: pkg.expected.sha256,
            steps: [{ control: next.signed, publication: next.pub, keyringEnvelope: next.keyring }] });
        expect(result.scope.keyEpoch).toBe("1");
        expect(result.root).toEqual(new Uint8Array(next.nextRoot));
        expect(result.history[0]?.root).toEqual(new Uint8Array(root()));
        await expect(h.codec.recoverPackageToControl({ packageBytes: bytes(pkg.expected.canonicalHex), expectedPackageSha256: pkg.expected.sha256,
            steps: [{ control: next.signed, publication: next.pub }] })).rejects.toMatchObject({ code: "unavailable" });
        const bad = Buffer.from(next.keyring);
        bad[bad.length - 1] = bad[bad.length - 1]! ^ 1;
        await expect(h.codec.recoverPackageToControl({ packageBytes: bytes(pkg.expected.canonicalHex), expectedPackageSha256: pkg.expected.sha256,
            steps: [{ control: next.signed, publication: next.pub, keyringEnvelope: bad }] })).rejects.toThrow();
    });
    it("recognizes obsolete recovery material only after authenticating the reachable signed transition", async () => {
        const h = harness(), next = await transition(h, Buffer.alloc(32, 99));
        await expect(h.codec.recoverPackageToControl({ packageBytes: bytes(pkg.expected.canonicalHex), expectedPackageSha256: pkg.expected.sha256,
            steps: [{ control: next.signed, publication: next.pub, keyringEnvelope: next.keyring }] })).rejects.toMatchObject({ code: "obsolete-recovery-package" });
    });
});
