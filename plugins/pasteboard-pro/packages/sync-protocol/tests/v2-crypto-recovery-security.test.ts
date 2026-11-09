import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createV2NodeCodec, type V2Expected, type V2SealContext } from "../src/v2-node";
import type { V2AuthorizationRequest, V2VerificationUnit } from "../src/v2-node/types";
import { encodeCanonicalV2, decodeCanonicalV2, type ControlV2, type V2Header } from "../src/v2";
import { sha256, sealDeterministic } from "../src/v2-node/primitives";
import { signedControl, signedPublication } from "../src/v2-node/records";
import { CodecGate } from "../src/v2-node/gate";
import { verificationRequest, verifyAttempt } from "../src/v2-node/verification";
// Every credential/key/seed here is deliberately PUBLIC synthetic fixture data.
// Setup encryptions construct adversarial inputs, never independent golden outputs.
const f = JSON.parse(readFileSync(new URL("../fixtures/crypto-v2.json", import.meta.url), "utf8"));
const c = f.vectors.control, p = f.vectors.publication, pkg = f.vectors.recoveryPackage;
const bytes = (value: string) => Buffer.from(value, "hex");
const root = () => bytes(c.input.rootHex);
const canonical = (value: unknown) => encodeCanonicalV2(value, { maxBytes: 65536 });
const limits = { maxPlaintextBytes: 1024 * 1024 };
type Unit = V2VerificationUnit;
type Trace = {
    kind: "reserve" | "result";
    unit: Unit;
    token: string;
    valid?: boolean;
};
type Hooks = {
    reserve?: (unit: Unit, occurrence: number) => void | Promise<void>;
    result?: (unit: Unit, valid: boolean, occurrence: number) => void | Promise<void>;
};
function harness() {
    const requests = new Map<string, V2AuthorizationRequest>(), trace: Trace[] = [], hooks: Hooks = {};
    const counts = new Map<Unit, number>(), results = new Map<Unit, number>();
    let serial = 0, parentRevoked = false, revokedUnit: Unit | undefined;
    function request(token: string) {
        const value = requests.get(token);
        if (!value)
            throw new Error("PUBLIC missing test lease");
        return value;
    }
    const options = {
        limits,
        authorization: {
            authorize: async (value: V2AuthorizationRequest) => {
                const token = "PUBLIC-test-lease-" + serial++;
                requests.set(token, value);
                return { token, mode: "registered" as const };
            },
            fence: async (lease: {
                token: string;
            }) => {
                const req = request(lease.token);
                if ((parentRevoked && req.operation === "recover-package") ||
                    (revokedUnit && req.verificationUnit === revokedUnit))
                    throw new Error("PUBLIC revoked");
            },
        },
        budget: {
            reserveSeal: async () => ({ counter: "0" }), registerAttempt: async () => { },
            reserveVerification: async (lease: {
                token: string;
            }, req: V2AuthorizationRequest) => {
                const unit = req.verificationUnit;
                if (!unit)
                    throw new Error("PUBLIC missing verification unit");
                trace.push({ kind: "reserve", unit, token: lease.token });
                const n = (counts.get(unit) ?? 0) + 1;
                counts.set(unit, n);
                await hooks.reserve?.(unit, n);
            },
            recordAuthentication: async (lease: {
                token: string;
            }, valid: boolean) => {
                const unit = request(lease.token).verificationUnit;
                if (!unit)
                    throw new Error("PUBLIC missing verification unit");
                trace.push({ kind: "result", unit, token: lease.token, valid });
                const n = (results.get(unit) ?? 0) + 1;
                results.set(unit, n);
                await hooks.result?.(unit, valid, n);
            },
        },
    };
    return { codec: createV2NodeCodec(options), gate: new CodecGate(options), hooks, trace,
        revokeParent: () => { parentRevoked = true; }, revokeUnit: (unit: Unit) => { revokedUnit = unit; } };
}
function controlContext(record = c.expected.record, raw: Uint8Array = bytes(c.expected.canonicalHex)) {
    return { accountBindingId: record.accountBindingId, vaultId: record.vaultId, keyEpoch: record.keyEpoch,
        adminPublicKey: bytes(c.input.adminPublicKeyHex), controlRevision: record.controlRevision,
        controlSha256: sha256(raw), rootId: record.rootId, managementInstanceId: record.managementInstanceId };
}
function publicationContext(record = p.expected.record, raw: Uint8Array = bytes(p.expected.canonicalHex)) {
    return { accountBindingId: record.accountBindingId, vaultId: record.vaultId, keyEpoch: record.keyEpoch,
        publicationRevision: record.publicationRevision, publicationSha256: sha256(raw),
        controlRevision: record.controlDescriptor.controlRevision, controlSha256: record.controlDescriptor.controlSha256 };
}
function envelopeExpected(header: V2Header, raw: Uint8Array): V2Expected {
    return { accountBindingId: header.accountBindingId, vaultId: header.vaultId, keyEpoch: header.keyEpoch,
        objectType: header.objectType, objectId: header.objectId, revision: header.revision,
        purpose: header.purpose, envelopeSha256: sha256(raw) };
}
function recover(h: ReturnType<typeof harness>, steps: Array<{
    control: Uint8Array;
    publication: Uint8Array;
    keyringEnvelope?: Uint8Array;
}> = []) {
    return h.codec.recoverPackageToControl({ packageBytes: bytes(pkg.expected.canonicalHex),
        expectedPackageSha256: pkg.expected.sha256, steps });
}
const anchorUnits: Unit[] = ["control-signature", "control-signature", "gcm-envelope", "control-root-mac", "publication-mac"];
const successorUnits: Unit[] = ["control-signature", "control-root-mac", "publication-mac"];
function assertSuccessfulUnits(h: ReturnType<typeof harness>, expected: Unit[]) {
    expect(h.trace.filter(e => e.kind === "reserve").map(e => e.unit)).toEqual(expected);
    expect(h.trace.filter(e => e.kind === "result").map(e => e.unit)).toEqual(expected);
    expect(h.trace.filter(e => e.kind === "result").every(e => e.valid)).toBe(true);
    for (const result of h.trace.filter(e => e.kind === "result"))
        expect(h.trace.filter(e => e.kind === "reserve" && e.token === result.token)).toHaveLength(1);
}
function nextEpoch(historyRoot: Uint8Array, nextRoot = Buffer.alloc(32, 33)) {
    const scope = { accountBindingId: c.input.body.accountBindingId, vaultId: c.input.body.vaultId, keyEpoch: "1" };
    const domain = Buffer.alloc(32, 34).toString("base64url");
    const wrapperContext = (id: number): V2SealContext => ({ ...scope, objectType: "root-wrap",
        objectId: Buffer.alloc(16, id).toString("base64url"), revision: "0", writerDomainId: domain });
    const pw = f.vectors.passwordWrap, rw = f.vectors.recoveryWrap;
    const passwordWrap = sealDeterministic(bytes(pw.input.ikmHex), { ...pw.input.header, ...wrapperContext(40) }, nextRoot, limits);
    const recoveryWrap = sealDeterministic(bytes(rw.input.ikmHex), { ...rw.input.header, ...wrapperContext(41) }, nextRoot, limits);
    const keyringId = Buffer.alloc(16, 42).toString("base64url");
    const keyringBody = canonical({ keyringVersion: 2, ...scope,
        history: [{ keyEpoch: "0", root: Buffer.from(historyRoot).toString("base64url") }] });
    const keyring = sealDeterministic(nextRoot, { ...f.vectors.keyring.input.header, ...scope, objectType: "keyring",
        purpose: "object-seal", objectId: keyringId, revision: "0", writerDomainId: domain,
        plaintextLength: String(keyringBody.length) }, keyringBody, limits);
    const control = signedControl({ ...c.input.body, ...scope,
        rootId: Buffer.alloc(32, 43).toString("base64url"), managementInstanceId: Buffer.alloc(32, 44).toString("base64url"),
        controlRevision: "1", prevControlDigest: c.expected.sha256,
        writerDomains: [{ writerDomainId: domain, status: "active" }],
        passwordWrap: Buffer.from(passwordWrap).toString("base64url"),
        recoveryWrap: Buffer.from(recoveryWrap).toString("base64url"),
        keyringDescriptor: { objectType: "keyring", objectId: keyringId, revision: "0", envelopeSha256: sha256(keyring) },
        transition: { previousEpoch: "0", previousRootId: c.expected.record.rootId,
            previousManagementInstanceId: c.expected.record.managementInstanceId,
            previousControlDigest: c.expected.sha256, previousPublicationDigest: p.expected.sha256 },
    }, nextRoot, bytes(c.input.adminSeedHex));
    const publication = signedPublication({ ...p.input.body, ...scope, publicationRevision: "1",
        previousPublicationDigest: p.expected.sha256, controlDescriptor: { controlRevision: "1", controlSha256: sha256(control) } }, nextRoot);
    return { control, publication, keyringEnvelope: keyring, nextRoot };
}
describe("recovery security review regressions", () => {
    it("binds publication epoch to the already authenticated control before MAC", async () => {
        const h = harness();
        const publication = signedPublication({ ...p.input.body, keyEpoch: "1", publicationRevision: "1",
            previousPublicationDigest: p.expected.sha256 }, root());
        await expect(recover(h, [{ control: bytes(c.expected.canonicalHex), publication }])).rejects.toMatchObject({ code: "context-mismatch" });
        expect(h.trace.filter(e => e.kind === "reserve" && e.unit === "publication-mac")).toHaveLength(1);
    });
    it("records false for a failed successor MAC with its own admission", async () => {
        const h = harness(), valid = signedPublication({ ...p.input.body, publicationRevision: "1",
            previousPublicationDigest: p.expected.sha256 }, root());
        const publication = canonical({ ...decodeCanonicalV2(valid, { maxBytes: 8192 }) as object,
            auth: Buffer.alloc(32).toString("base64url") });
        await expect(recover(h, [{ control: bytes(c.expected.canonicalHex), publication }])).rejects.toMatchObject({ code: "authentication-failed" });
        const all = [...anchorUnits, ...successorUnits];
        expect(h.trace.filter(e => e.kind === "reserve").map(e => e.unit)).toEqual(all);
        expect(h.trace.filter(e => e.kind === "result").map(e => e.valid)).toEqual([...all.slice(1).map(() => true), false]);
        expect(h.trace.at(-1)).toMatchObject({ kind: "result", unit: "publication-mac", valid: false });
    });
    it("refuses the first authenticated keyring replacing the authenticated anchor root", async () => {
        await expect(recover(harness(), [nextEpoch(Buffer.alloc(32, 77))])).rejects.toMatchObject({ code: "conflict" });
    });
    it("rejects same-epoch signed controls authenticated by different actual keys", async () => {
        const h = harness(), nextRoot = Buffer.alloc(32, 77);
        const next = signedControl({ ...c.input.body, controlRevision: "1", prevControlDigest: c.expected.sha256 }, nextRoot, bytes(c.input.adminSeedHex));
        const record = decodeCanonicalV2(next, { maxBytes: 65536 }) as ControlV2;
        await expect(h.codec.verifyControlSuccessor({
            previous: { root: root(), control: bytes(c.expected.canonicalHex), expected: controlContext() },
            next: { root: nextRoot, control: next, expected: controlContext(record, next) },
            previousPublicationSha256: p.expected.sha256,
        })).rejects.toMatchObject({ code: "conflict" });
    });
    it("rejects a signed epoch transition reusing an already authenticated root", async () => {
        const step = nextEpoch(root(), root()), record = decodeCanonicalV2(step.control, { maxBytes: 65536 }) as ControlV2;
        const h = harness();
        await expect(h.codec.verifyControlSuccessor({
            previous: { root: root(), control: bytes(c.expected.canonicalHex), expected: controlContext() },
            next: { root: root(), control: step.control, expected: controlContext(record, step.control) },
            previousPublicationSha256: p.expected.sha256,
        })).rejects.toMatchObject({ code: "conflict" });
        await expect(recover(harness(), [step])).rejects.toMatchObject({ code: "conflict" });
    });
    it("accounts every actual anchor verification, including conservative repeated signatures", async () => {
        const h = harness(), result = await recover(h);
        expect(result.status).toBe("read-only-recovered");
        expect("adminSeed" in result).toBe(false);
        expect("writerDomainId" in result).toBe(false);
        assertSuccessfulUnits(h, anchorUnits);
    });
    it("budgets the complete authenticated transition and history-keyring GCM", async () => {
        const h = harness(), step = nextEpoch(root()), result = await recover(h, [step]);
        expect(result.history[0]?.root).toEqual(new Uint8Array(root()));
        assertSuccessfulUnits(h, [...anchorUnits, "control-signature", "control-signature",
            "gcm-envelope", "control-root-mac", "control-root-mac", "publication-mac", "gcm-envelope"]);
    });
    for (const unit of ["control-signature", "control-root-mac", "publication-mac", "gcm-envelope"] as Unit[]) {
        it("does not return material when " + unit + " reservation is rejected or unknown", async () => {
            const h = harness();
            let released: unknown;
            h.hooks.reserve = current => { if (current === unit)
                throw new Error("PUBLIC reservation unknown"); };
            await expect(recover(h).then(value => { released = value; return value; })).rejects.toMatchObject({ code: "unavailable" });
            expect(released).toBeUndefined();
            expect(h.trace.filter(e => e.kind === "reserve" && e.unit === unit)).toHaveLength(1);
        });
        it("fails closed if " + unit + " authentication-result persistence throws", async () => {
            const h = harness();
            let released: unknown;
            h.hooks.result = current => { if (current === unit)
                throw new Error("PUBLIC persistence unknown"); };
            await expect(recover(h).then(value => { released = value; return value; })).rejects.toMatchObject({ code: "unavailable" });
            expect(released).toBeUndefined();
            expect(h.trace.filter(e => e.kind === "result" && e.unit === unit)).toHaveLength(1);
        });
    }
    for (const unit of ["control-signature", "control-root-mac", "publication-mac", "gcm-envelope"] as Unit[]) {
        it("records false for an actual " + unit + " authentication failure", async () => {
            const h = harness();
            let attempt: Promise<unknown>;
            if (unit === "control-signature") {
                const control = canonical({ ...c.expected.record, adminSignature: Buffer.alloc(64).toString("base64url") });
                attempt = h.codec.verifyControl({ root: root(), control,
                    expected: { ...controlContext(), controlSha256: sha256(control) } });
            }
            else if (unit === "control-root-mac") {
                attempt = h.codec.verifyControl({ root: Buffer.alloc(32, 99), control: bytes(c.expected.canonicalHex),
                    expected: controlContext() });
            }
            else if (unit === "publication-mac") {
                const publication = canonical({ ...p.expected.record, auth: Buffer.alloc(32).toString("base64url") });
                attempt = h.codec.verifyPublication({ root: root(), publication,
                    expected: { ...publicationContext(), publicationSha256: sha256(publication) } });
            }
            else {
                const v = f.vectors.index, envelope = bytes(v.expected.envelopeHex);
                attempt = h.codec.openObject({ root: Buffer.alloc(32, 99), envelope,
                    expected: envelopeExpected(v.input.header, envelope) });
            }
            await expect(attempt).rejects.toMatchObject({ code: "authentication-failed" });
            expect(h.trace.at(-1)).toMatchObject({ kind: "result", unit, valid: false });
        });
    }
    it("does not release a recovered root after late parent-scope revocation", async () => {
        const h = harness();
        let released: unknown;
        h.hooks.result = (unit, valid) => { if (unit === "gcm-envelope" && valid)
            h.revokeParent(); };
        await expect(recover(h).then(value => { released = value; return value; })).rejects.toMatchObject({ code: "unauthorized" });
        expect(released).toBeUndefined();
    });
    it("wipes a verified intermediate if result persistence fails", async () => {
        const h = harness(), plain = Buffer.from("PUBLIC intermediate bytes");
        const req = verificationRequest("open-object", c.input.body, "0".repeat(64), "gcm-envelope");
        const lease = await h.gate.authorize(req);
        h.hooks.result = () => { throw new Error("PUBLIC callback failure"); };
        await expect(verifyAttempt(h.gate, lease, req, () => plain)).rejects.toMatchObject({ code: "unavailable" });
        expect([...plain].every(value => value === 0)).toBe(true);
    });
    it("wipes a verified intermediate if its own lease is revoked after authentication", async () => {
        const h = harness(), plain = Buffer.from("PUBLIC late fence bytes");
        const req = verificationRequest("open-object", c.input.body, "0".repeat(64), "gcm-envelope");
        const lease = await h.gate.authorize(req);
        h.hooks.result = () => h.revokeUnit("gcm-envelope");
        await expect(verifyAttempt(h.gate, lease, req, () => plain)).rejects.toMatchObject({ code: "unauthorized" });
        expect([...plain].every(value => value === 0)).toBe(true);
    });
});
