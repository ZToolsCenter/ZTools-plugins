import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { encodeCanonicalV2, parseUntrustedEnvelopeV2, type V2Header } from '../src/v2';
import { createV2NodeCodec } from '../src/v2-node';
import { objectInfo, deriveKey, sealDeterministic, passwordKey, adminPublic, adminSign,
  mac, sha256 } from '../src/v2-node/primitives';
import type { V2Expected, V2NodeCodecOptions } from '../src/v2-node/types';

// Golden values come solely from Python cryptography50; never Node regeneration.
// Every seed/key/password in this fixture is deliberately PUBLIC synthetic data.
const fixture = JSON.parse(readFileSync(new URL('../fixtures/crypto-v2.json', import.meta.url), 'utf8'));
type EnvelopeVector = {
  input: { ikmHex: string; header: V2Header; plaintextHex: string; password?: string;
    saltHex?: string; metadata?: {sha256: string; byteLength: number; portableCodecId: string; codecVersion: string} };
  expected: {headerHex: string; infoHex: string; derivedKeyHex: string; aadHex: string;
    ciphertextHex: string; tagHex: string; envelopeHex: string; envelopeSha256: string};
};
const vector = (name: string): EnvelopeVector => fixture.vectors[name];
const hex = (value: Uint8Array) => Buffer.from(value).toString('hex');
const bytes = (value: string) => Buffer.from(value, 'hex');
const limits = { maxPlaintextBytes: 1024 * 1024 };
const root = () => bytes(vector('blob').input.ikmHex);
const canonical = (value: unknown, maxBytes = 256 * 1024) => encodeCanonicalV2(value, {maxBytes});
const control = fixture.vectors.control;
const publication = fixture.vectors.publication;
const recoveryPackage = fixture.vectors.recoveryPackage;
const scope = () => {
  const h = vector('blob').input.header;
  return { accountBindingId: h.accountBindingId, vaultId: h.vaultId, keyEpoch: h.keyEpoch };
};
const controlExpected = () => ({ ...scope(), adminPublicKey: bytes(control.input.adminPublicKeyHex),
  controlRevision: '0', controlSha256: control.expected.sha256,
  rootId: control.expected.record.rootId, managementInstanceId: control.expected.record.managementInstanceId });
const publicationExpected = () => ({ ...scope(), publicationRevision: '0',
  publicationSha256: publication.expected.sha256, controlRevision: '0', controlSha256: control.expected.sha256 });
function expected(v: EnvelopeVector): V2Expected {
  const h = v.input.header;
  return { accountBindingId: h.accountBindingId, vaultId: h.vaultId, keyEpoch: h.keyEpoch,
    objectType: h.objectType, objectId: h.objectId, revision: h.revision, purpose: h.purpose,
    envelopeSha256: v.expected.envelopeSha256,
    ...(v.input.metadata ? {blobBinding: v.input.metadata} : {}) };
}
function harness() {
  const authorization = { authorize: vi.fn(async () => ({token: 'PUBLIC-test-lease', mode: 'registered' as const})),
    fence: vi.fn(async () => {}) };
  const budget = { reserveSeal: vi.fn(async () => ({counter: '0'})), registerAttempt: vi.fn(async () => {}),
    reserveVerification: vi.fn(async () => {}), recordAuthentication: vi.fn(async () => {}) };
  const options: V2NodeCodecOptions = {limits, authorization, budget};
  return {codec: createV2NodeCodec(options), authorization, budget};
}

describe('independent Python PBV2 public test vectors', () => {
  it('identifies the independent, deliberately restricted public oracle', () => {
    expect(fixture.publicTestOnly).toBe(true);
    expect(fixture.oracle.adrSha256).toBe('cdf462681a8170c5e2a92089d23c22817217df9d956b5bcff3edeb498b577d00');
    expect(fixture.oracle.canonicalDomain).toContain('ASCII schema keys');
  });
  for (const name of ['blob','projection','index','tombstone','keyring','passwordWrap','recoveryWrap', 'futureProjection','futureIndex']) {
    it(`${name}: exact independent JCS/info/HKDF/AAD/cipher/tag/container`, () => {
      const v = vector(name), {input, expected: e} = v;
      const envelope = bytes(e.envelopeHex), parsed = parseUntrustedEnvelopeV2(envelope, limits);
      expect(hex(canonical(input.header))).toBe(e.headerHex);
      expect(hex(objectInfo(input.header))).toBe(e.infoHex);
      expect(hex(deriveKey(bytes(input.ikmHex), bytes(e.infoHex)))).toBe(e.derivedKeyHex);
      expect(hex(parsed.aad)).toBe(e.aadHex);
      expect(hex(parsed.ciphertext)).toBe(e.ciphertextHex);
      expect(hex(parsed.tag)).toBe(e.tagHex);
      expect(hex(sealDeterministic(bytes(input.ikmHex), input.header, bytes(input.plaintextHex), limits))).toBe(e.envelopeHex);
      expect(sha256(envelope)).toBe(e.envelopeSha256);
    });
  }
  it('matches scrypt N131072/r8/p1/dk32 with exact Unicode UTF-8 password', async () => {
    const v = vector('passwordWrap');
    const key = await passwordKey(Buffer.from(v.input.password!, 'utf8'), bytes(v.input.saltHex!));
    expect(hex(key)).toBe(v.input.ikmHex);
    key.fill(0);
  });
  it('matches independent control MAC key, authenticated bytes and Ed25519 signature', () => {
    const e = control.expected;
    expect(hex(canonical(control.input.body))).toBe(e.authenticatedBodyHex);
    expect(hex(deriveKey(root(), bytes(e.infoHex)))).toBe(e.derivedKeyHex);
    expect(mac(root(), scope(), 'control-auth', bytes(e.authenticatedBodyHex))).toBe(e.macBase64url);
    expect(hex(adminPublic(bytes(control.input.adminSeedHex)))).toBe(control.input.adminPublicKeyHex);
    expect(adminSign(bytes(control.input.adminSeedHex), bytes(e.signedBodyHex))).toBe(Buffer.from(e.signatureHex,'hex').toString('base64url'));
    expect(hex(canonical(e.record))).toBe(e.canonicalHex);
  });
  it('matches independent publication MAC and package checksum/anchor bytes', () => {
    const e = publication.expected;
    expect(hex(canonical(publication.input.body))).toBe(e.authenticatedBodyHex);
    expect(hex(deriveKey(root(), bytes(e.infoHex)))).toBe(e.derivedKeyHex);
    expect(mac(root(), scope(), 'publication-auth', bytes(e.authenticatedBodyHex))).toBe(e.macBase64url);
    expect(hex(canonical(e.record))).toBe(e.canonicalHex);
    expect(createHash('sha256').update(canonical(recoveryPackage.input.body)).digest('hex')).toBe(recoveryPackage.expected.checksum);
    expect(hex(canonical(recoveryPackage.expected.record))).toBe(recoveryPackage.expected.canonicalHex);
    expect(Buffer.from(recoveryPackage.input.body.anchorControl,'base64url')).toEqual(bytes(control.expected.canonicalHex));
    expect(Buffer.from(recoveryPackage.input.body.anchorPublication,'base64url')).toEqual(bytes(e.canonicalHex));
  });
  for (const name of ['blob','projection','index','tombstone','keyring']) {
    it(`public openObject accepts independent ${name} plaintext only after authentication`, async () => {
      const v = vector(name), {codec, budget} = harness();
      const result = await codec.openObject({root: bytes(v.input.ikmHex), envelope: bytes(v.expected.envelopeHex), expected: expected(v)});
      expect(result.status).toBe('ok');
      if (result.status === 'ok') expect(hex(result.plaintext)).toBe(v.input.plaintextHex);
      expect(budget.reserveVerification).toHaveBeenCalledOnce();
      expect(budget.recordAuthentication).toHaveBeenCalledWith(expect.anything(), true);
    });
  }
  it('public verifyControl and verifyPublication accept the independent anchored chain', async () => {
    const {codec} = harness();
    await expect(codec.verifyControl({root: root(), control: bytes(control.expected.canonicalHex), expected: controlExpected()})).resolves.toBeDefined();
    await expect(codec.verifyPublication({root: root(), publication: bytes(publication.expected.canonicalHex), expected: publicationExpected()})).resolves.toBeDefined();
  });
  it('public signing reproduces independent control and publication bytes exactly', async () => {
    const {codec} = harness();
    const signed = await codec.signControl({root: root(), adminSeed: bytes(control.input.adminSeedHex), body: control.input.body});
    expect(hex(signed)).toBe(control.expected.canonicalHex);
    const published = await codec.signPublication({root: root(), body: publication.input.body,
      control: bytes(control.expected.canonicalHex), controlExpected: controlExpected()});
    expect(hex(published)).toBe(publication.expected.canonicalHex);
  });
  it('public password/recovery unlocks use the signed control and recover the exact independent root', async () => {
    const {codec} = harness(), c = bytes(control.expected.canonicalHex);
    const passwordRoot = await codec.unlockPassword({password: vector('passwordWrap').input.password!,
      control: c, expected: controlExpected()});
    const recoveryRoot = await codec.unlockRecovery({recoverySecret: bytes(vector('recoveryWrap').input.ikmHex),
      control: c, expected: controlExpected()});
    expect(hex(passwordRoot)).toBe(hex(root()));
    expect(hex(recoveryRoot)).toBe(hex(root()));
    passwordRoot.fill(0); recoveryRoot.fill(0);
  });
  it('wrong root cannot open or verify authenticated independent bytes', async () => {
    const {codec,budget} = harness(), v = vector('projection');
    await expect(codec.openObject({root: new Uint8Array(32), envelope: bytes(v.expected.envelopeHex), expected: expected(v)})).rejects.toThrow();
    expect(budget.recordAuthentication).toHaveBeenCalledWith(expect.anything(), false);
    await expect(codec.verifyControl({root: new Uint8Array(32), control: bytes(control.expected.canonicalHex), expected: controlExpected()})).rejects.toThrow();
  });
  it('public recoverPackage derives the exact public root from complete independent offline anchors', async () => {
    const {codec} = harness();
    const result = await codec.recoverPackage({packageBytes: bytes(recoveryPackage.expected.canonicalHex),
      expectedPackageSha256: recoveryPackage.expected.sha256});
    expect(hex(result.root)).toBe(recoveryPackage.expected.rootHex);
  });
  it('wrong purpose/account/vault/epoch/object/revision/full hash never returns plaintext', async () => {
    const v = vector('projection');
    const alternatives = { purpose: 'recovery-wrap', accountBindingId: vector('blob').input.header.vaultId,
      vaultId: vector('blob').input.header.accountBindingId, keyEpoch: '1',
      objectId: vector('blob').input.header.objectId, revision: '1', envelopeSha256: '0'.repeat(64) };
    for (const [field,value] of Object.entries(alternatives)) {
      const {codec} = harness();
      await expect(codec.openObject({root: root(), envelope: bytes(v.expected.envelopeHex),
        expected: {...expected(v), [field]: value}})).rejects.toThrow();
    }
  });
  for (const part of ['tag','ciphertext','AAD'] as const) {
    it(`rejects ${part} tampering even when the caller hash matches modified bytes; no plaintext escapes`, async () => {
      const v = vector('projection'), wire = bytes(v.expected.envelopeHex);
      const aadLength = bytes(v.expected.aadHex).length;
      if (part === 'tag' || part === 'ciphertext') {
        const offset = part === 'tag' ? wire.length - 1 : aadLength;
        const original = wire[offset];
        if (original === undefined) throw new Error(`Missing ${part} byte at offset ${offset}`);
        wire[offset] = original ^ 1;
      } else {
        // Swap a canonical nonce character, preserving schema and byte lengths.
        const nonce = Buffer.from(v.input.header.nonce);
        const offset = wire.indexOf(nonce);
        expect(offset).toBeGreaterThan(8);
        wire[offset] = wire[offset] === 65 ? 66 : 65;
      }
      const {codec,budget} = harness();
      let released: unknown;
      await expect(codec.openObject({root: root(), envelope: wire,
        expected: {...expected(v), envelopeSha256: sha256(wire)}}).then(value => {released=value; return value;})).rejects.toThrow();
      expect(released).toBeUndefined();
      expect(budget.recordAuthentication).toHaveBeenCalledWith(expect.anything(), false);
    });
  }
  it('quarantines only a known-envelope future projection; future index and top-level version stop', async () => {
    const {codec} = harness(), v = vector('futureProjection');
    const result = await codec.openObject({root: root(), envelope: bytes(v.expected.envelopeHex), expected: expected(v)});
    expect(result.status).toBe('quarantine');
    expect('plaintext' in result).toBe(false);
    const futureIndex = vector('futureIndex');
    await expect(codec.openObject({root: root(), envelope: bytes(futureIndex.expected.envelopeHex), expected: expected(futureIndex)})).rejects.toThrow();
    const envelope = bytes(vector('projection').expected.envelopeHex);
    const marker = Buffer.from('"wireVersion":2');
    envelope[envelope.indexOf(marker)+marker.length-1] = 51;
    await expect(codec.openObject({root: root(), envelope,
      expected: {...expected(vector('projection')), envelopeSha256: sha256(envelope)}})).rejects.toThrow();
  });
  it('rejects forged control and publication even with matching caller digests', async () => {
    const {codec} = harness();
    const changedControl = {...control.expected.record, rootMac: Buffer.alloc(32).toString('base64url')};
    const changed = canonical(changedControl);
    await expect(codec.verifyControl({root: root(), control: changed,
      expected: {...controlExpected(), controlSha256: sha256(changed)}})).rejects.toThrow();
    const pub = canonical({...publication.expected.record, auth: Buffer.alloc(32).toString('base64url')});
    await expect(codec.verifyPublication({root: root(), publication: pub,
      expected: {...publicationExpected(), publicationSha256: sha256(pub)}})).rejects.toThrow();
    const future = canonical({...control.expected.record, controlVersion: 3});
    await expect(codec.verifyControl({root: root(), control: future,
      expected: {...controlExpected(), controlSha256: sha256(future)}})).rejects.toThrow();
  });
  it('package checksum alone cannot substitute a changed anchor', async () => {
    const {codec} = harness();
    const badBody = {...recoveryPackage.input.body, anchorPublication: Buffer.from(canonical({
      ...publication.expected.record, controlDescriptor: {controlRevision: '0', controlSha256: '0'.repeat(64)}
    })).toString('base64url')};
    const altered = canonical({...badBody, checksum: sha256(canonical(badBody))});
    await expect(codec.recoverPackage({packageBytes: altered, expectedPackageSha256: sha256(altered)})).rejects.toThrow();
  });
});
