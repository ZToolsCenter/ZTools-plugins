/** Structurally valid only; none of these types imply authentication or authorization. */
export type V2Descriptor = Readonly<{
    objectType: 'projection' | 'tombstone' | 'index' | 'keyring';
    objectId: string;
    revision: string;
    envelopeSha256: string;
}>;
export type V2ControlDescriptor = Readonly<{
    controlRevision: string;
    controlSha256: string;
}>;
export type V2Transition = Readonly<{
    previousEpoch: string;
    previousRootId: string;
    previousManagementInstanceId: string;
    previousControlDigest: string;
    previousPublicationDigest: string;
}>;
export type ControlV2 = Readonly<{
    controlVersion: 2;
    suite: 'PBV2-A256GCM-HKDF256-SCRYPT1';
    model: 'portable-snapshot-v2';
    accountBindingId: string;
    vaultId: string;
    keyEpoch: string;
    rootId: string;
    managementInstanceId: string;
    controlRevision: string;
    prevControlDigest: string | null;
    adminPublicKey: string;
    writerDomains: readonly Readonly<{
        writerDomainId: string;
        status: 'active' | 'revoked';
    }>[];
    passwordWrap: string;
    recoveryWrap: string;
    keyringDescriptor: (V2Descriptor & Readonly<{ objectType: 'keyring' }>) | null;
    transition: V2Transition | null;
    rootMac: string;
    adminSignature: string;
}>;
export type PublicationRootV2 = Readonly<{
    publicationVersion: 2;
    suite: 'PBV2-A256GCM-HKDF256-SCRYPT1';
    model: 'portable-snapshot-v2';
    accountBindingId: string;
    vaultId: string;
    keyEpoch: string;
    publicationRevision: string;
    previousPublicationDigest: string | null;
    controlDescriptor: V2ControlDescriptor;
    indexDescriptor: V2Descriptor & Readonly<{ objectType: 'index' }>;
    auth: string;
}>;
export type RecoveryPackageV2 = Readonly<{
    packageVersion: 2;
    suite: 'PBV2-A256GCM-HKDF256-SCRYPT1';
    model: 'portable-snapshot-v2';
    accountBindingId: string;
    vaultId: string;
    recoverySecret: string;
    adminSeed: string;
    adminPublicKeyFingerprint: string;
    anchorControl: string;
    anchorPublication: string;
    checksum: string;
}>;
export type HistoryKeyringV2 = Readonly<{
    keyringVersion: 2;
    accountBindingId: string;
    vaultId: string;
    keyEpoch: string;
    history: readonly Readonly<{
        keyEpoch: string;
        root: string;
    }>[];
}>;
export type SourceCursorV2 = Readonly<{
    hostEpoch: string;
    changeSeq: string;
}>;
export type ProvenanceV2 = Readonly<{
    relation: 'undisclosed';
}> | Readonly<{
    relation: 'byte-identical';
    sourceAlias: string;
    sourceSha256: string;
}> | Readonly<{
    relation: 'converted';
    sourceAlias: string;
    sourceSha256: string;
    codecId: string;
    codecVersion: string;
}>;
export type PortableRepresentationV2 = Readonly<{
    representationHandle: string;
    portableCodecId: string;
    codecVersion: string;
    blobId: string;
    blobRevision: string;
    sha256: string;
    byteLength: number;
    provenance: ProvenanceV2;
}>;
export type ProjectionV2 = Readonly<{
    bodyVersion: 2;
    projectionId: string;
    sourceSnapshotId: string;
    sourceManifestRevision: string;
    sourceCursor: SourceCursorV2;
    originDeviceId: string;
    items: readonly Readonly<{
        itemIndex: number;
        representations: readonly PortableRepresentationV2[];
    }>[];
    omissions: readonly Readonly<{
        itemIndex: number;
        reasonCode: 'unsupported' | 'policy-blocked' | 'local-only' | 'over-limit' | 'unavailable';
    }>[];
    projectionDigest: string;
}>;
export type BlobMetadataV2 = Readonly<{
    bodyVersion: 2;
    blobId: string;
    blobRevision: string;
    byteLength: number;
    sha256: string;
    portableCodecId: string;
    codecVersion: string;
}>;
export type IndexV2 = Readonly<{
    bodyVersion: 2;
    indexRevision: string;
    entries: readonly (V2Descriptor & Readonly<{ objectType: 'projection' | 'tombstone' }>)[];
    sourceWatermarks: readonly Readonly<{
        originDeviceId: string;
        approvedHostEpoch: string;
        sourceSnapshotId: string;
        changeSeq: string;
        deleted: boolean;
    }>[];
}>;
export type TombstoneV2 = Readonly<{
    bodyVersion: 2;
    sourceSnapshotId: string;
    originDeviceId: string;
    sourceCursor: SourceCursorV2;
    tombstoneRevision: string;
}>;
