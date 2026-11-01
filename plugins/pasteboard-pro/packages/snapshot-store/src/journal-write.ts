import { acknowledgeOutboxV2 } from "./outbox-acknowledgements.js";
import { listReferencedObjectsInSnapshotV2 } from "./journal-roots.js";
import { readDeletedHeadV2 } from "./deletion-records.js";
import { assertConsumerPruneAllowedV2 } from "./consumer-roots.js";
import { ChangeSequenceV2Schema } from "@pasteboard-pro/core";
import type { RootDatabase } from "lmdb";

import { storeErrorV2 } from "./errors.js";
import {
  attemptKeyV2,
  eventKeyV2,
  headKeyV2,
  JOURNAL_META_V2,
  JournalHeadSchemaV2,
  manifestKeyV2,
  outboxKeyV2,
  parseEventAtKey,
  validateAttemptEventV2,
  parseStoredRecordV2,
  rawRecordKeyV2,
  readJournalStateV2,
  receiptKeyV2,
  referenceKeyV2,
  sequenceFromKey,
  validateStoredCaptureV2,
} from "./journal-records.js";
import {
  canonicalJsonV2,
  isSnapshotStoreError,
  parseAttemptRecordV2,
  parseEventJsonV2,
  sha256V2,
  validateAttemptIdV2,
  validateCommitV2,
  validateOutcomeCodeV2,
} from "./journal-validation.js";
import type {
  JournalCommitResultV2,
  JournalFaultPointV2,
  SnapshotCommitV2,
} from "./types.js";

const MAX_SEQUENCE = 18_446_744_073_709_551_615n;
type JournalDatabase = RootDatabase<string, string>;
type AtomicWriteV2 = <T>(callback: () => T) => T;

function ensureStringValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") storeErrorV2("storage-corrupt");
  return value;
}

function writeJson(db: JournalDatabase, key: string, value: unknown): void {
  db.putSync(key, canonicalJsonV2(value));
}

function nextSequence(current: string): string {
  const next = BigInt(current) + 1n;
  if (next > MAX_SEQUENCE) storeErrorV2("over-limit");
  return next.toString();
}

function readWriteValue(db: JournalDatabase, key: string): string | undefined {
  return ensureStringValue(db.get(key));
}

function injectFault(
  fault: ((point: JournalFaultPointV2) => void) | undefined,
  point: JournalFaultPointV2,
): void {
  fault?.(point);
}

function parseHeadForWrite(
  db: JournalDatabase,
  snapshotId: string,
  hostEpoch: string,
): { snapshotId: string; manifestRevision: string } | undefined {
  if (readDeletedHeadV2(db, undefined, snapshotId, hostEpoch)) storeErrorV2("conflict");
  const json = readWriteValue(db, headKeyV2(snapshotId));
  if (json === undefined) return undefined;
  const head = parseStoredRecordV2(json, JournalHeadSchemaV2);
  if (head.snapshotId !== snapshotId) storeErrorV2("storage-corrupt");
  validateStoredCaptureV2(db, snapshotId, head.manifestRevision, hostEpoch);
  return head;
}

function readExistingAttempt(
  db: JournalDatabase,
  attemptId: string,
  hostEpoch: string,
  headSeq: string,
) {
  const json = readWriteValue(db, attemptKeyV2(attemptId));
  if (json === undefined) return undefined;
  const record = parseAttemptRecordV2(json);
  if (record.event.hostEpoch !== hostEpoch ||
      BigInt(record.event.changeSeq) > BigInt(headSeq)) storeErrorV2("storage-corrupt");
  return record;
}

function buildUpsertEvent(
  hostEpoch: string,
  changeSeq: string,
  command: SnapshotCommitV2,
  manifestSha256: string,
) {
  const event = {
    hostEpoch,
    changeSeq,
    eventType: "upsert" as const,
    snapshotId: command.manifest.snapshotId,
    manifestRevision: command.manifest.manifestRevision,
    manifestRef: manifestKeyV2(command.manifest.snapshotId, command.manifest.manifestRevision),
    manifestSha256,
  };
  return parseEventJsonV2(canonicalJsonV2(event));
}

function buildOutcomeEvent(
  hostEpoch: string,
  changeSeq: string,
  attemptId: string,
  outcomeCode: ReturnType<typeof validateOutcomeCodeV2>,
) {
  return parseEventJsonV2(canonicalJsonV2({
    hostEpoch,
    changeSeq,
    eventType: "outcome",
    attemptId,
    outcomeCode,
  }));
}

function validatePriorCaptureIntegrity(
  db: JournalDatabase,
  hostEpoch: string,
  command: SnapshotCommitV2,
  headSeq: string,
  retentionFloor: string,
  priorAttempt: Extract<ReturnType<typeof readExistingAttempt>, { kind: "capture" }>,
): void {
  const attemptEvent = priorAttempt.event;
  if (
    attemptEvent.eventType !== "upsert" ||
    attemptEvent.snapshotId !== command.manifest.snapshotId ||
    attemptEvent.manifestRevision !== command.manifest.manifestRevision ||
    attemptEvent.manifestRef !== manifestKeyV2(
      command.manifest.snapshotId, command.manifest.manifestRevision,
    )
  ) storeErrorV2("storage-corrupt");

  const capture = validateAttemptEventV2(
    db, undefined, attemptEvent, hostEpoch, headSeq, retentionFloor,
  );
  if (!capture ||
      capture.receipt.attemptId !== command.receipt.attemptId ||
      capture.receipt.receiptId !== command.receipt.receiptId) {
    storeErrorV2("storage-corrupt");
  }

  let storedFingerprint: string;
  try {
    storedFingerprint = validateCommitV2({
      manifest: capture.manifest,
      receipt: capture.receipt,
      rawObjects: capture.bindings,
      expectedManifestRevision: command.expectedManifestRevision,
    }, hostEpoch).fingerprint;
  } catch {
    storeErrorV2("storage-corrupt");
  }
  if (storedFingerprint !== priorAttempt.fingerprint) storeErrorV2("storage-corrupt");
}

function checkCaptureInTransaction(
  db: JournalDatabase,
  hostEpoch: string,
  command: SnapshotCommitV2,
  fingerprint: string,
  manifestSha256: string,
): JournalCommitResultV2 | undefined {
  const state = readJournalStateV2(readWriteValue.bind(undefined, db));
  if (state.hostEpoch !== hostEpoch) storeErrorV2("storage-corrupt");

  const priorAttempt = readExistingAttempt(
    db, command.receipt.attemptId, hostEpoch, state.headSeq,
  );
  if (priorAttempt) {
    if (priorAttempt.kind !== "capture" || priorAttempt.fingerprint !== fingerprint) {
      storeErrorV2("conflict");
    }
    validatePriorCaptureIntegrity(
      db, hostEpoch, command, state.headSeq, state.retentionFloor, priorAttempt,
    );
    if (priorAttempt.event.eventType !== "upsert" ||
        priorAttempt.event.manifestSha256 !== manifestSha256) {
      storeErrorV2("storage-corrupt");
    }
    return Object.freeze({
      event: parseEventJsonV2(canonicalJsonV2(priorAttempt.event)),
      replayed: true,
    });
  }

  const currentHead = parseHeadForWrite(db, command.manifest.snapshotId, hostEpoch);
  if (currentHead === undefined) {
    if (command.expectedManifestRevision !== null) storeErrorV2("conflict");
  } else if (command.expectedManifestRevision !== currentHead.manifestRevision) {
    storeErrorV2("conflict");
  }

  if (readWriteValue(db, manifestKeyV2(
    command.manifest.snapshotId,
    command.manifest.manifestRevision,
  )) !== undefined) storeErrorV2("conflict");
  if (readWriteValue(db, receiptKeyV2(command.receipt.receiptId)) !== undefined) {
    storeErrorV2("conflict");
  }
  return undefined;
}

export function createJournalWriteMethodsV2(
  db: JournalDatabase,
  hostEpoch: string,
  fault: ((point: JournalFaultPointV2) => void) | undefined,
  publicMethodsAllowed: () => void,
  runWrite: AtomicWriteV2,
) {
const checkCapture = (input: SnapshotCommitV2): JournalCommitResultV2 | undefined => {
  publicMethodsAllowed();
  const validated = validateCommitV2(input, hostEpoch);
  return runWrite(() => checkCaptureInTransaction(
    db!, hostEpoch, validated.command, validated.fingerprint, validated.manifestSha256,
  ));
};

const commitCapture = (
  input: SnapshotCommitV2,
  guard: () => void,
): JournalCommitResultV2 => {
  publicMethodsAllowed();
  if (typeof guard !== "function") storeErrorV2("invalid-input");
  const validated = validateCommitV2(input, hostEpoch);
  const command = validated.command;
  return runWrite(() => {
    const checked = checkCaptureInTransaction(
      db!, hostEpoch, command, validated.fingerprint, validated.manifestSha256,
    );
    if (checked) return checked;
    const state = readJournalStateV2(readWriteValue.bind(undefined, db!));
    if (state.hostEpoch !== hostEpoch) storeErrorV2("storage-corrupt");

    guard();
    injectFault(fault, "before-manifest");

    writeJson(db!, manifestKeyV2(
      command.manifest.snapshotId,
      command.manifest.manifestRevision,
    ), {
      snapshotId: command.manifest.snapshotId,
      manifestRevision: command.manifest.manifestRevision,
      manifestJson: validated.manifestJson,
      sha256: validated.manifestSha256,
    });
    injectFault(fault, "after-manifest");

    writeJson(db!, receiptKeyV2(command.receipt.receiptId), {
      receiptId: command.receipt.receiptId,
      snapshotId: command.receipt.snapshotId,
      manifestRevision: command.receipt.manifestRevision,
      attemptId: command.receipt.attemptId,
      receiptJson: validated.receiptJson,
      sha256: sha256V2(validated.receiptJson),
    });
    injectFault(fault, "after-receipt");

    writeJson(db!, rawRecordKeyV2(
      command.manifest.snapshotId,
      command.manifest.manifestRevision,
    ), {
      snapshotId: command.manifest.snapshotId,
      manifestRevision: command.manifest.manifestRevision,
      bindings: command.rawObjects,
    });
    for (const binding of command.rawObjects) {
      const key = referenceKeyV2(
        command.manifest.snapshotId,
        command.manifest.manifestRevision,
        binding.representationKey,
      );
      if (readWriteValue(db!, key) !== undefined) storeErrorV2("storage-corrupt");
      writeJson(db!, key, {
        snapshotId: command.manifest.snapshotId,
        manifestRevision: command.manifest.manifestRevision,
        binding,
      });
    }
    injectFault(fault, "after-objects");

    const changeSeq = nextSequence(state.headSeq);
    if (readWriteValue(db!, eventKeyV2(changeSeq)) !== undefined ||
        readWriteValue(db!, outboxKeyV2(changeSeq)) !== undefined) {
      storeErrorV2("storage-corrupt");
    }
    const event = buildUpsertEvent(hostEpoch, changeSeq, command, validated.manifestSha256);
    writeJson(db!, eventKeyV2(changeSeq), event);
    writeJson(db!, outboxKeyV2(changeSeq), event);
    writeJson(db!, attemptKeyV2(command.receipt.attemptId), {
      kind: "capture",
      fingerprint: validated.fingerprint,
      event,
    });
    db!.putSync(JOURNAL_META_V2.headSeq, changeSeq);
    injectFault(fault, "after-event");
    injectFault(fault, "before-head");
    guard();
    writeJson(db!, headKeyV2(command.manifest.snapshotId), {
      snapshotId: command.manifest.snapshotId,
      manifestRevision: command.manifest.manifestRevision,
    });
    return Object.freeze({ event, replayed: false });
  });
};

const recordOutcome = (
  rawAttemptId: string,
  rawOutcomeCode: Parameters<typeof validateOutcomeCodeV2>[0],
): JournalCommitResultV2 => {
  publicMethodsAllowed();
  const attemptId = validateAttemptIdV2(rawAttemptId);
  const outcomeCode = validateOutcomeCodeV2(rawOutcomeCode);
  const fingerprint = sha256V2(canonicalJsonV2({ attemptId, outcomeCode }));
  return runWrite(() => {
    const state = readJournalStateV2(readWriteValue.bind(undefined, db!));
    if (state.hostEpoch !== hostEpoch) storeErrorV2("storage-corrupt");
    const priorAttempt = readExistingAttempt(db!, attemptId, hostEpoch, state.headSeq);
    if (priorAttempt) {
      if (priorAttempt.kind !== "outcome" ||
          priorAttempt.fingerprint !== fingerprint ||
          priorAttempt.event.eventType !== "outcome" ||
          priorAttempt.event.attemptId !== attemptId ||
          priorAttempt.event.outcomeCode !== outcomeCode) {
        storeErrorV2("conflict");
      }
      validateAttemptEventV2(
        db!, undefined, priorAttempt.event, hostEpoch, state.headSeq, state.retentionFloor,
      );
      return Object.freeze({
        event: parseEventJsonV2(canonicalJsonV2(priorAttempt.event)),
        replayed: true,
      });
    }

    const changeSeq = nextSequence(state.headSeq);
    if (readWriteValue(db!, eventKeyV2(changeSeq)) !== undefined ||
        readWriteValue(db!, outboxKeyV2(changeSeq)) !== undefined) {
      storeErrorV2("storage-corrupt");
    }
    const event = buildOutcomeEvent(hostEpoch, changeSeq, attemptId, outcomeCode);
    writeJson(db!, eventKeyV2(changeSeq), event);
    writeJson(db!, outboxKeyV2(changeSeq), event);
    writeJson(db!, attemptKeyV2(attemptId), {
      kind: "outcome",
      fingerprint,
      event,
    });
    db!.putSync(JOURNAL_META_V2.headSeq, changeSeq);
    injectFault(fault, "after-event");
    return Object.freeze({ event, replayed: false });
  });
};

const acknowledgeOutbox = (changeSeq: string): void => {
  publicMethodsAllowed();
  runWrite(() => acknowledgeOutboxV2(db, hostEpoch, changeSeq,
    () => injectFault(fault, "after-outbox-ack")));
};

const pruneThrough = (rawChangeSeq: string): void => {
  publicMethodsAllowed();
  if (!ChangeSequenceV2Schema.safeParse(rawChangeSeq).success) {
    storeErrorV2("invalid-input");
  }
  runWrite(() => {
    const state = readJournalStateV2(readWriteValue.bind(undefined, db!));
    const through = BigInt(rawChangeSeq);
    const floor = BigInt(state.retentionFloor);
    const head = BigInt(state.headSeq);
    if (through > head) storeErrorV2("invalid-input");
    if (through < floor) return;
    if (through === MAX_SEQUENCE) storeErrorV2("over-limit");
    listReferencedObjectsInSnapshotV2(db, undefined, hostEpoch);
    assertConsumerPruneAllowedV2(db, hostEpoch, through.toString());

    let expected = floor;
    const start = eventKeyV2(floor.toString());
    const end = eventKeyV2((through + 1n).toString());
    for (const entry of db!.getRange({ start, end })) {
      if (typeof entry.key !== "string" ||
          BigInt(sequenceFromKey(entry.key, "event:")) !== expected) {
        storeErrorV2("storage-corrupt");
      }
      parseEventAtKey(db!, undefined, entry.key, "event:", hostEpoch);
      expected += 1n;
    }
    if (expected !== through + 1n) storeErrorV2("storage-corrupt");
    for (let sequence = floor; sequence <= through; sequence += 1n) {
      if (!db!.removeSync(eventKeyV2(sequence.toString()))) {
        storeErrorV2("storage-corrupt");
      }
    }
    db!.putSync(JOURNAL_META_V2.retentionFloor, (through + 1n).toString());
  });
};
  return Object.freeze({ checkCapture, commitCapture, recordOutcome, acknowledgeOutbox, pruneThrough });
}
