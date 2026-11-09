import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createV2NodeCodec, type V2Expected, type V2TrustedPublicationContext } from "../src/v2-node";
import { encodeCanonicalV2, decodeCanonicalV2, type ControlV2, type V2Header } from "../src/v2";
import { sealDeterministic, sha256, passwordKey, passwordBytes } from "../src/v2-node/primitives";
import { signedControl, signedPublication } from "../src/v2-node/records";
const fixture = JSON.parse(readFileSync(new URL("../fixtures/crypto-v2.json", import.meta.url), "utf8"));
const control = fixture.vectors.control, publication = fixture.vectors.publication;
const bytes = (value: string) => Buffer.from(value, "hex");
const root = () => bytes(control.input.rootHex);
const limits = { maxPlaintextBytes: 1024 * 1024 };
/** PUBLIC synthetic authority only; does not implement host policy or durable state. */
function codec() {
    return createV2NodeCodec({ limits,
        authorization: { authorize: async () => ({ token: "test-only-boundary", mode: "registered" }), fence: async () => { } },
        budget: { reserveSeal: async () => ({ counter: "0" }), registerAttempt: async () => { },
            reserveVerification: async () => { }, recordAuthentication: async () => { } } });
}
function expected(header: V2Header, envelope: Uint8Array): V2Expected {
    return { accountBindingId: header.accountBindingId, vaultId: header.vaultId, keyEpoch: header.keyEpoch,
        objectType: header.objectType, objectId: header.objectId, revision: header.revision,
        purpose: header.purpose, envelopeSha256: sha256(envelope) };
}
const canonical = (value: unknown) => encodeCanonicalV2(value, { maxBytes: 65536 });
describe("ordinary review Node boundary regressions", () => {
    for (const version of ["2.5", "-1", "0", "\"3\"", "NaN", "9007199254740992"]) {
        it("rejects invalid projection version " + version + " after authenticating its exact bytes", async () => {
            // Raw JSON allows testing NaN/unsafe-number rejection without weakening the serializer.
            const plain = Buffer.from('{"bodyVersion":' + version + '}');
            const header: V2Header = { ...fixture.vectors.futureProjection.input.header, plaintextLength: String(plain.length) };
            const envelope = sealDeterministic(root(), header, plain, limits);
            await expect(codec().openObject({ root: root(), envelope, expected: expected(header, envelope) })).rejects.toThrow();
        });
    }
    it("keeps a safe future projection version opaque with no plaintext result", async () => {
        const plain = canonical({ bodyVersion: 3 }), header: V2Header = {
            ...fixture.vectors.futureProjection.input.header, plaintextLength: String(plain.length)
        };
        const envelope = sealDeterministic(root(), header, plain, limits);
        const result = await codec().openObject({ root: root(), envelope, expected: expected(header, envelope) });
        expect(result.status).toBe("quarantine");
        expect("plaintext" in result).toBe(false);
    });
    it("rejects an epoch regression with valid MACs, sequential revisions and exact previous digest", async () => {
        const key1 = Buffer.alloc(32, 77);
        const previousBody = { ...publication.input.body, keyEpoch: "1", publicationRevision: "1",
            previousPublicationDigest: publication.expected.sha256 };
        const previous = signedPublication(previousBody, key1);
        const nextBody = { ...publication.input.body, keyEpoch: "0", publicationRevision: "2",
            previousPublicationDigest: sha256(previous) };
        const next = signedPublication(nextBody, root());
        const context = (body: typeof previousBody, raw: Uint8Array): V2TrustedPublicationContext => ({
            accountBindingId: body.accountBindingId, vaultId: body.vaultId, keyEpoch: body.keyEpoch,
            publicationRevision: body.publicationRevision, publicationSha256: sha256(raw),
            controlRevision: body.controlDescriptor.controlRevision, controlSha256: body.controlDescriptor.controlSha256
        });
        const api = codec();
        // Establish that each individual expected context/MAC is valid before testing the link.
        await api.verifyPublication({ root: key1, publication: previous, expected: context(previousBody, previous) });
        await api.verifyPublication({ root: root(), publication: next, expected: context(nextBody, next) });
        await expect(api.verifyPublicationSuccessor({
            previous: { root: key1, publication: previous, expected: context(previousBody, previous) },
            next: { root: root(), publication: next, expected: context(nextBody, next) },
        })).rejects.toMatchObject({ code: "conflict" });
    });
    it("unlocks a valid administrator-signed empty-password wrapper without applying creation UX rules", async () => {
        const vector = fixture.vectors.passwordWrap;
        expect(passwordBytes("")).toHaveLength(0);
        const key = await passwordKey(Buffer.alloc(0), bytes(vector.input.saltHex));
        let wrap: Uint8Array;
        try {
            wrap = sealDeterministic(key, { ...vector.input.header,
                objectId: Buffer.alloc(16, 66).toString("base64url") }, root(), { maxPlaintextBytes: 32 });
        }
        finally {
            key.fill(0);
        }
        const wire = signedControl({ ...control.input.body, controlRevision: "1", prevControlDigest: control.expected.sha256,
            passwordWrap: Buffer.from(wrap).toString("base64url") }, root(), bytes(control.input.adminSeedHex));
        const record = decodeCanonicalV2(wire, { maxBytes: 65536 }) as ControlV2;
        await expect(codec().unlockPassword({ password: "", control: wire, expected: {
                accountBindingId: record.accountBindingId, vaultId: record.vaultId, keyEpoch: record.keyEpoch,
                adminPublicKey: bytes(control.input.adminPublicKeyHex), controlRevision: record.controlRevision,
                controlSha256: sha256(wire), rootId: record.rootId, managementInstanceId: record.managementInstanceId,
            } })).resolves.toEqual(new Uint8Array(root()));
    });
});
