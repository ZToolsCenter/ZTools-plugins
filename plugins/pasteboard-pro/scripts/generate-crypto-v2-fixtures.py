#!/usr/bin/env python3
"""Independent PBV2 protocol oracle. ALL inputs and keys are PUBLIC TEST-ONLY.

This is deliberately not a generic RFC8785 implementation: fixed schemas use
ASCII keys and JSON numbers restricted to safe integers (no floats). Unicode
scalar string values are encoded as UTF-8 without normalization. Python lexical
key sorting agrees with UTF-16 ordering only within this restricted key domain.
No product code is imported, no credentials or user clipboard data are read.
"""
import argparse
import base64
import hashlib
import hmac
import json
import platform
import struct
from pathlib import Path

import cryptography
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

SUITE = 'PBV2-A256GCM-HKDF256-SCRYPT1'
MODEL = 'portable-snapshot-v2'
ADR_SHA256 = 'cdf462681a8170c5e2a92089d23c22817217df9d956b5bcff3edeb498b577d00'
BASE = Path(__file__).resolve().parents[1]


def b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('ascii')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def public_bytes(start, length=32):
    """Public synthetic deterministic byte sequence, NEVER product entropy."""
    return bytes((start + i) % 256 for i in range(length))


def jcs(value):
    def check(node):
        if isinstance(node, dict):
            for key, item in node.items():
                assert isinstance(key, str) and key.isascii(), 'ASCII schema keys only'
                check(item)
        elif isinstance(node, list):
            for item in node:
                check(item)
        elif isinstance(node, str):
            node.encode('utf-8', errors='strict')
        elif isinstance(node, bool) or node is None:
            pass
        else:
            assert isinstance(node, int) and abs(node) <= 9007199254740991
    check(value)
    return json.dumps(value, sort_keys=True, ensure_ascii=False,
                      separators=(',', ':'), allow_nan=False).encode('utf-8')


def hkdf(ikm, info):
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=bytes(32), info=info).derive(ikm)


def object_info(header):
    return jcs(['PasteboardPro/v2', SUITE, MODEL, header['purpose'],
                header['accountBindingId'], header['vaultId'], header['keyEpoch'],
                header['writerDomainId'], header['objectType'], header['objectId'],
                header['revision'], header['attemptId']])


def envelope(ikm, header, plaintext):
    assert int(header['plaintextLength']) == len(plaintext)
    header_bytes = jcs(header)
    aad = b'PBV2' + struct.pack('>I', len(header_bytes)) + header_bytes
    info = object_info(header)
    key = hkdf(ikm, info)
    nonce = base64.urlsafe_b64decode(header['nonce'] + '==')
    sealed = AESGCM(key).encrypt(nonce, plaintext, aad)
    container = aad + sealed
    return {'input': {'ikmHex': ikm.hex(), 'header': header,
                      'plaintextHex': plaintext.hex()},
            'expected': {'headerHex': header_bytes.hex(), 'infoHex': info.hex(),
                         'derivedKeyHex': key.hex(), 'aadHex': aad.hex(),
                         'ciphertextHex': sealed[:-16].hex(), 'tagHex': sealed[-16:].hex(),
                         'envelopeHex': container.hex(), 'envelopeBase64url': b64(container),
                         'envelopeSha256': digest(container)}}


def generate():
    root, recovery, seed = public_bytes(0), public_bytes(32), public_bytes(64)
    account, vault, domain = b64(public_bytes(96, 16)), b64(public_bytes(112, 16)), b64(public_bytes(128))
    scope = {'accountBindingId': account, 'vaultId': vault, 'keyEpoch': '0'}
    serial = 0

    def header(kind, purpose, plaintext, object_start, epoch='0', params=None):
        nonlocal serial
        serial += 1
        result = {'wireVersion': 2, 'suite': SUITE, 'model': MODEL, 'purpose': purpose,
                  **scope, 'keyEpoch': epoch, 'objectType': kind,
                  'objectId': b64(public_bytes(object_start, 16)), 'revision': '0',
                  'writerDomainId': domain, 'attemptId': b64(public_bytes(160 + serial)),
                  'nonce': b64(public_bytes(200 + serial, 12)), 'plaintextLength': str(len(plaintext))}
        if params is not None:
            result['wrapParams'] = params
        return result

    text = 'PUBLIC TEST ONLY — 剪贴板 🧪\ne\u0301 ≠ é\r\n'.encode('utf-8')
    blob_id = b64(public_bytes(1, 16))
    metadata = {'bodyVersion': 2, 'blobId': blob_id, 'blobRevision': '0',
                'byteLength': len(text), 'sha256': digest(text),
                'portableCodecId': 'text-utf8', 'codecVersion': '1'}
    mb = jcs(metadata)
    blob_body = struct.pack('>I', len(mb)) + mb + text
    vectors = {'blob': envelope(root, header('blob', 'object-seal', blob_body, 1), blob_body)}
    vectors['blob']['input'].update({'portableText': text.decode('utf-8'), 'metadata': metadata})
    projection_id = b64(public_bytes(2, 16))
    projection = {'bodyVersion': 2, 'projectionId': projection_id,
                  'sourceSnapshotId': b64(public_bytes(3, 16)),
                  'sourceManifestRevision': b64(public_bytes(4, 16)),
                  'sourceCursor': {'hostEpoch': 'public-test-host-epoch', 'changeSeq': '18446744073709551615'},
                  'originDeviceId': b64(public_bytes(5, 16)),
                  'items': [{'itemIndex': 0, 'representations': [{
                      'representationHandle': b64(public_bytes(6, 16)),
                      'portableCodecId': 'text-utf8', 'codecVersion': '1', 'blobId': blob_id,
                      'blobRevision': '0', 'sha256': digest(text), 'byteLength': len(text),
                      'provenance': {'relation': 'byte-identical',
                                     'sourceAlias': b64(public_bytes(7, 16)), 'sourceSha256': digest(text)}}]}],
                  'omissions': [{'itemIndex': 1, 'reasonCode': 'policy-blocked'}]}
    projection['projectionDigest'] = digest(jcs(projection))
    projection_bytes = jcs(projection)
    vectors['projection'] = envelope(root, header('projection', 'object-seal', projection_bytes, 2), projection_bytes)
    index = {'bodyVersion': 2, 'indexRevision': '0', 'entries': [{
        'objectType': 'projection', 'objectId': projection_id, 'revision': '0',
        'envelopeSha256': vectors['projection']['expected']['envelopeSha256']}],
        'sourceWatermarks': [{'originDeviceId': projection['originDeviceId'],
            'approvedHostEpoch': projection['sourceCursor']['hostEpoch'],
            'sourceSnapshotId': projection['sourceSnapshotId'],
            'changeSeq': projection['sourceCursor']['changeSeq'], 'deleted': False}]}
    index_bytes = jcs(index)
    vectors['index'] = envelope(root, header('index', 'object-seal', index_bytes, 8), index_bytes)
    tombstone = {'bodyVersion': 2, 'sourceSnapshotId': projection['sourceSnapshotId'],
                 'originDeviceId': projection['originDeviceId'],
                 'sourceCursor': projection['sourceCursor'], 'tombstoneRevision': '0'}
    tb = jcs(tombstone)
    vectors['tombstone'] = envelope(root, header('tombstone', 'object-seal', tb, 9), tb)
    keyring = {'keyringVersion': 2, **scope, 'keyEpoch': '1',
               'history': [{'keyEpoch': '0', 'root': b64(public_bytes(240))}]}
    kb = jcs(keyring)
    vectors['keyring'] = envelope(public_bytes(224), header('keyring', 'object-seal', kb, 10, epoch='1'), kb)
    vectors['keyring']['expected']['plaintextSha256'] = digest(kb)
    password = 'PUBLIC TEST ONLY password 密码 🧪'
    salt = public_bytes(16)
    password_ikm = Scrypt(salt=salt, length=32, n=131072, r=8, p=1).derive(password.encode('utf-8'))
    params = {'kind': 'password', 'kdf': 'scrypt', 'N': 131072, 'r': 8, 'p': 1,
              'dkLen': 32, 'salt': b64(salt)}
    vectors['passwordWrap'] = envelope(password_ikm, header('root-wrap', 'password-wrap', root, 11, params=params), root)
    vectors['passwordWrap']['input'].update({'password': password, 'passwordUtf8Hex': password.encode('utf-8').hex(), 'saltHex': salt.hex()})
    vectors['recoveryWrap'] = envelope(recovery, header('root-wrap', 'recovery-wrap', root, 12,
                                       params={'kind': 'recovery', 'kdf': 'hkdf-sha256'}), root)
    admin = Ed25519PrivateKey.from_private_bytes(seed)
    public = admin.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    control = {'controlVersion': 2, 'suite': SUITE, 'model': MODEL, **scope,
               'rootId': b64(public_bytes(24)), 'managementInstanceId': b64(public_bytes(56)),
               'controlRevision': '0', 'prevControlDigest': None, 'adminPublicKey': b64(public),
               'writerDomains': [{'writerDomainId': domain, 'status': 'active'}],
               'passwordWrap': vectors['passwordWrap']['expected']['envelopeBase64url'],
               'recoveryWrap': vectors['recoveryWrap']['expected']['envelopeBase64url'],
               'keyringDescriptor': None, 'transition': None}

    def authenticate(body, role):
        info = jcs(['PasteboardPro/v2', SUITE, MODEL, role, account, vault, '0'])
        key = hkdf(root, info)
        auth = hmac.new(key, jcs(body), hashlib.sha256).digest()
        return {'infoHex': info.hex(), 'derivedKeyHex': key.hex(),
                'authenticatedBodyHex': jcs(body).hex(), 'macHex': auth.hex(), 'macBase64url': b64(auth)}

    control_expected = authenticate(control, 'control-auth')
    unsigned = {**control, 'rootMac': control_expected['macBase64url']}
    signature = admin.sign(jcs(unsigned))
    signed_control = {**unsigned, 'adminSignature': b64(signature)}
    cb = jcs(signed_control)
    control_expected.update({'signedBodyHex': jcs(unsigned).hex(), 'signatureHex': signature.hex(),
                             'canonicalHex': cb.hex(), 'sha256': digest(cb), 'record': signed_control})
    vectors['control'] = {'input': {'body': control, 'rootHex': root.hex(), 'adminSeedHex': seed.hex(),
                                   'adminPublicKeyHex': public.hex()}, 'expected': control_expected}
    publication = {'publicationVersion': 2, 'suite': SUITE, 'model': MODEL, **scope,
                   'publicationRevision': '0', 'previousPublicationDigest': None,
                   'controlDescriptor': {'controlRevision': '0', 'controlSha256': digest(cb)},
                   'indexDescriptor': {'objectType': 'index', 'objectId': vectors['index']['input']['header']['objectId'],
                                       'revision': '0', 'envelopeSha256': vectors['index']['expected']['envelopeSha256']}}
    pe = authenticate(publication, 'publication-auth')
    signed_publication = {**publication, 'auth': pe['macBase64url']}
    pb = jcs(signed_publication)
    pe.update({'canonicalHex': pb.hex(), 'sha256': digest(pb), 'record': signed_publication})
    vectors['publication'] = {'input': {'body': publication, 'rootHex': root.hex()}, 'expected': pe}
    package = {'packageVersion': 2, 'suite': SUITE, 'model': MODEL, **scope,
               'recoverySecret': b64(recovery), 'adminSeed': b64(seed),
               'adminPublicKeyFingerprint': digest(public),
               'anchorControl': b64(cb), 'anchorPublication': b64(pb)}
    # Recovery package scope omits keyEpoch; anchors carry the authenticated epoch.
    del package['keyEpoch']
    checksum = digest(jcs(package))
    package_record = {**package, 'checksum': checksum}
    package_bytes = jcs(package_record)
    vectors['recoveryPackage'] = {'input': {'body': package}, 'expected': {
        'checksum': checksum, 'canonicalHex': package_bytes.hex(), 'sha256': digest(package_bytes),
        'record': package_record, 'rootHex': root.hex(), 'adminPublicKeyHex': public.hex()}}
    for name, body in [('futureProjection', {'bodyVersion': 3}), ('futureIndex', {**index, 'bodyVersion': 3})]:
        data = jcs(body)
        kind = 'projection' if name == 'futureProjection' else 'index'
        vectors[name] = envelope(root, header(kind, 'object-seal', data, 13 if kind == 'projection' else 14), data)
    return {'publicTestOnly': True, 'warning': 'All passwords, roots, seeds, salts, attempts and nonces are PUBLIC synthetic test literals. Never use for real data.',
            'oracle': {'implementation': 'Python cryptography independent of Node implementation',
                       'canonicalDomain': 'ASCII schema keys; safe integer JSON numbers; Unicode scalar string values; no floats',
                       'adrSha256': ADR_SHA256, 'suite': SUITE, 'model': MODEL},
            'vectors': vectors}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--receipt', type=Path, required=True)
    args = parser.parse_args()
    adr = BASE / 'docs/clipboard-format-fidelity/G3_CRYPTO_ADR.md'
    assert digest(adr.read_bytes()) == ADR_SHA256, 'Accepted ADR changed; review before regenerating'
    fixture = generate()
    data = json.dumps(fixture, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False).encode('utf-8') + b'\n'
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(data)
    receipt = {'publicTestOnly': True, 'python': platform.python_version(),
               'cryptography': cryptography.__version__, 'generatorSha256': digest(Path(__file__).read_bytes()),
               'adrSha256': ADR_SHA256, 'fixtureSha256': digest(data), 'fixtureBytes': len(data),
               'config': {'scrypt': {'N': 131072, 'r': 8, 'p': 1, 'dkLen': 32},
                          'hkdfSaltHex': bytes(32).hex(), 'aes': 'AES-256-GCM nonce12 tag16',
                          'canonicalDomain': fixture['oracle']['canonicalDomain']},
               'limitations': ['library protocol crypto interop only', 'trusted owner/OS key isolation/policy/transport NOT-RUN',
                               'Windows10/11 and six directions NOT-RUN', 'not G3 end-to-end acceptance']}
    args.receipt.parent.mkdir(parents=True, exist_ok=True)
    args.receipt.write_bytes(json.dumps(receipt, indent=2, sort_keys=True).encode('utf-8') + b'\n')
    print(json.dumps({'fixtureSha256': digest(data), 'bytes': len(data), 'cryptography': cryptography.__version__}))


if __name__ == '__main__':
    main()
