import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { createV2NodeCodec, V2NodeError, type V2NodeCodecOptions, type V2SealContext, type V2Expected } from "../src/v2-node";
import { parseUntrustedEnvelopeV2, encodeCanonicalV2 } from "../src/v2";
import { sha256, passwordBytes } from "../src/v2-node/primitives";
import * as nodePrimitives from "../src/v2-node/primitives";
const fixture = JSON.parse(readFileSync(new URL("../fixtures/crypto-v2.json", import.meta.url), "utf8"));
const vector = fixture.vectors.index, control = fixture.vectors.control;
const fromHex = (v: string) => Buffer.from(v, "hex");
const root = () => fromHex(vector.input.ikmHex);
const controlExpected = () => ({ ...vector.input.header, adminPublicKey: fromHex(control.input.adminPublicKeyHex),
    controlRevision: "0", controlSha256: control.expected.sha256, rootId: control.expected.record.rootId,
    managementInstanceId: control.expected.record.managementInstanceId });
function input() {
    const h = vector.input.header;
    return { root: root(), plaintext: fromHex(vector.input.plaintextHex),
        context: { accountBindingId: h.accountBindingId, vaultId: h.vaultId, keyEpoch: h.keyEpoch, objectType: h.objectType,
            objectId: h.objectId, revision: h.revision, writerDomainId: h.writerDomainId } as V2SealContext,
        authority: { control: fromHex(control.expected.canonicalHex), expected: controlExpected() } };
}
function expected(envelope: Uint8Array): V2Expected {
    const h = parseUntrustedEnvelopeV2(envelope, { maxPlaintextBytes: 1024 * 1024 }).header;
    return { accountBindingId: h.accountBindingId, vaultId: h.vaultId, keyEpoch: h.keyEpoch, objectType: h.objectType,
        objectId: h.objectId, revision: h.revision, purpose: h.purpose, envelopeSha256: sha256(envelope) };
}
/** Deliberately test-only adapters. These prove coordination, never host durability. */
function harness() {
    let counter = 0;
    const authorization = { authorize: vi.fn(async () => ({ token: "test-only", mode: "registered" as "registered" | "bootstrap-prepare" })),
        fence: vi.fn(async () => { }) };
    const budget = { reserveSeal: vi.fn(async () => ({ counter: String(counter++) })), registerAttempt: vi.fn(async () => { }),
        reserveVerification: vi.fn(async () => { }), recordAuthentication: vi.fn(async () => { }) };
    const options: V2NodeCodecOptions = { limits: { maxPlaintextBytes: 1024 * 1024 }, authorization, budget };
    return { options, authorization, budget, codec: createV2NodeCodec(options) };
}
describe("V2 crypto coordination with test-only adapters", () => {
    it("requires every authority and durable budget method, with no fallback", () => {
        expect(() => createV2NodeCodec(undefined as never)).toThrow(V2NodeError);
        const h = harness();
        for (const field of ["reserveSeal", "registerAttempt", "reserveVerification", "recordAuthentication"] as const)
            expect(() => createV2NodeCodec({ ...h.options, budget: { ...h.budget, [field]: undefined } as never })).toThrow();
        expect(() => createV2NodeCodec({ ...h.options, authorization: { authorize: h.authorization.authorize } as never })).toThrow();
    });
    it("uses production CSPRNG for each seal and round-trips the complete authenticated body", async () => {
        const { codec, budget } = harness(), one = await codec.sealObject(input()), two = await codec.sealObject(input());
        const a = parseUntrustedEnvelopeV2(one, { maxPlaintextBytes: 1024 * 1024 }).header;
        const b = parseUntrustedEnvelopeV2(two, { maxPlaintextBytes: 1024 * 1024 }).header;
        expect(a.attemptId).not.toBe(b.attemptId);
        expect(a.nonce).not.toBe(b.nonce);
        expect(budget.reserveSeal).toHaveBeenCalledTimes(2);
        expect(budget.registerAttempt).toHaveBeenCalledTimes(2);
        const result = await codec.openObject({ root: root(), envelope: one, expected: expected(one) });
        expect(result.status).toBe("ok");
        if (result.status === "ok")
            expect(result.plaintext).toEqual(new Uint8Array(fromHex(vector.input.plaintextHex)));
    });
    it("rejects reservation failures and unknown attempts without returning or refunding material", async () => {
        const h = harness();
        h.budget.reserveSeal.mockRejectedValueOnce(new Error("PUBLIC-unknown"));
        await expect(h.codec.sealObject(input())).rejects.toMatchObject({ code: "unavailable" });
        expect(h.budget.registerAttempt).not.toHaveBeenCalled();
        h.budget.registerAttempt.mockRejectedValueOnce(new Error("PUBLIC-unknown"));
        await expect(h.codec.sealObject(input())).rejects.toMatchObject({ code: "unavailable" });
        expect(h.budget.reserveSeal).toHaveBeenCalledTimes(2);
    });
    it("rejects invalid or reused reserved counters; memory check supplements durable adapter", async () => {
        for (const counter of ["-1", "01", "4294967296", "not-a-counter"]) {
            const h = harness();
            h.budget.reserveSeal.mockResolvedValue({ counter });
            await expect(h.codec.sealObject(input())).rejects.toMatchObject({ code: "unavailable" });
        }
        const h = harness();
        h.budget.reserveSeal.mockResolvedValue({ counter: "7" });
        await h.codec.sealObject(input());
        await expect(h.codec.sealObject(input())).rejects.toMatchObject({ code: "unavailable" });
    });
    it("does not seal an unregistered domain or let bootstrap authorization seal normal objects", async () => {
        const h = harness(), i = input();
        (i.context as {
            writerDomainId: string;
        }).writerDomainId = Buffer.alloc(32, 2).toString("base64url");
        await expect(h.codec.sealObject(i)).rejects.toMatchObject({ code: "unauthorized" });
        expect(h.authorization.authorize).not.toHaveBeenCalled();
        const b = input();
        b.authority = { bootstrap: true } as never;
        h.authorization.authorize.mockResolvedValue({ token: "test-only", mode: "bootstrap-prepare" });
        await expect(h.codec.sealObject(b)).rejects.toMatchObject({ code: "unauthorized" });
        expect(h.budget.reserveSeal).not.toHaveBeenCalled();
    });
    it("rejects final fence revocation without releasing encrypted or decrypted results", async () => {
        const h = harness();
        let n = 0;
        h.authorization.fence.mockImplementation(async () => {
            if (++n === 4)
                throw new Error("revoked");
        });
        let released: unknown;
        await expect(h.codec.sealObject(input()).then(v => { released = v; return v; })).rejects.toMatchObject({ code: "unauthorized" });
        expect(released).toBeUndefined();
        const fresh = harness();
        const envelope = await fresh.codec.sealObject(input());
        fresh.authorization.fence.mockRejectedValue(new Error("revoked"));
        await expect(fresh.codec.openObject({ root: root(), envelope, expected: expected(envelope) })).rejects.toMatchObject({ code: "unauthorized" });
    });
    it("owns bytes, key, expected binding and limits across asynchronous authorization", async () => {
        const h = harness(), i = input(), original = Buffer.from(i.plaintext);
        h.authorization.authorize.mockImplementation(async () => {
            i.root.fill(9);
            i.plaintext.fill(9);
            (i.context as {
                objectId: string;
            }).objectId = Buffer.alloc(16, 9).toString("base64url");
            h.options.limits.maxPlaintextBytes = 1;
            return { token: "test-only", mode: "registered" };
        });
        const envelope = await h.codec.sealObject(i);
        const o = harness(), e = expected(envelope), key = root();
        o.authorization.authorize.mockImplementation(async () => {
            (e as {
                objectId: string;
            }).objectId = "bad";
            key.fill(1);
            return { token: "test-only", mode: "registered" };
        });
        const result = await o.codec.openObject({ root: key, envelope, expected: e });
        expect(result.status).toBe("ok");
        if (result.status === "ok")
            expect(result.plaintext).toEqual(new Uint8Array(original));
    });
    it("rejects shared and detached bytes before authority or counter reservation", async () => {
        const h = harness(), shared = new Uint8Array(new SharedArrayBuffer(32));
        await expect(h.codec.sealObject({ ...input(), root: shared })).rejects.toThrow();
        const detached = new Uint8Array(32);
        structuredClone(detached, { transfer: [detached.buffer] });
        await expect(h.codec.sealObject({ ...input(), root: detached })).rejects.toThrow();
        expect(h.authorization.authorize).not.toHaveBeenCalled();
    });
    it("preflights header/body/caps and full expected hash before verification budget or KDF", async () => {
        const h = harness(), i = input();
        i.plaintext = Buffer.from("{}");
        await expect(h.codec.sealObject(i)).rejects.toThrow();
        expect(h.budget.reserveSeal).not.toHaveBeenCalled();
        const envelope = fromHex(vector.expected.envelopeHex);
        await expect(h.codec.openObject({ root: root(), envelope, expected: { ...expected(envelope), envelopeSha256: "0".repeat(64) } })).rejects.toThrow();
        expect(h.budget.reserveVerification).not.toHaveBeenCalled();
    });
    it("signature verification consumes only its admission before rejecting forged control; never runs password KDF", async () => {
        const h = harness(), c = { ...control.expected.record, adminSignature: Buffer.alloc(64, 9).toString("base64url") };
        const bytes = encodeCanonicalV2(c, { maxBytes: 65536 });
        const kdf = vi.spyOn(nodePrimitives, "passwordKey");
        let released: unknown;
        try {
            await expect(h.codec.unlockPassword({ password: "PUBLIC-password", control: bytes,
                expected: { ...controlExpected(), controlSha256: sha256(bytes) } }).then(value => {
                    released = value; return value;
                })).rejects.toMatchObject({ code: "authentication-failed" });
            expect(released).toBeUndefined();
            expect(kdf).not.toHaveBeenCalled();
            expect(h.authorization.authorize).toHaveBeenCalledOnce();
            expect(h.authorization.authorize).toHaveBeenCalledWith(expect.objectContaining({
                operation: "verify-control", verificationUnit: "control-signature"
            }));
            expect(h.budget.reserveVerification).toHaveBeenCalledOnce();
            expect(h.budget.reserveVerification).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
                verificationUnit: "control-signature"
            }));
            expect(h.budget.recordAuthentication).toHaveBeenCalledWith(expect.anything(), false);
        } finally { kdf.mockRestore(); }
    });
    it("password byte handling preserves scalar input, rejects lone surrogates and >1024 UTF8 bytes", () => {
        expect(passwordBytes("é")).toEqual(Buffer.from("é"));
        expect(passwordBytes("e\u0301")).not.toEqual(passwordBytes("é"));
        expect(() => passwordBytes("\ud800")).toThrow();
        expect(() => passwordBytes("\udc00")).toThrow();
        expect(() => passwordBytes("é".repeat(513))).toThrow();
        expect(passwordBytes("x").length).toBe(1);
    });
});
