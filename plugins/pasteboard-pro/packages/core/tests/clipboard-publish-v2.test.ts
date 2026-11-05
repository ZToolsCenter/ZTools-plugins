import { describe, expect, it } from "vitest";

import {
  ChangeSequenceV2Schema,
  ClipboardJournalChangeEventV2Schema,
  ClipboardJournalCursorExpiredV2Schema,
  ClipboardJournalHostResetV2Schema,
  ClipboardJournalPageV2Schema,
  ClipboardJournalReadResultV2Schema,
  ClipboardPublishExchangeV2Schema,
  ClipboardPublishResultV2Schema,
  PastePlanV2Schema,
} from "../src/clipboard-publish-v2";

const publishContext = {
  planId: "plan-1",
  snapshotId: "snapshot-1",
  manifestRevision: "manifest-rev-2",
  plannedRepresentationKeys: ["plain", "html"],
  omittedRepresentationKeys: ["private"],
};

const sha256 = "b".repeat(64);

function upsert(changeSeq: string) {
  return {
    hostEpoch: "epoch-1",
    changeSeq,
    eventType: "upsert" as const,
    snapshotId: "snapshot-1",
    manifestRevision: "manifest-rev-1",
    manifestRef: "manifest:snapshot-1:manifest-rev-1",
    manifestSha256: sha256,
  };
}

describe("PastePlanV2Schema", () => {
  it("accepts a frozen compatible plan with explicit omissions", () => {
    const result = PastePlanV2Schema.safeParse({
      schemaVersion: 2,
      ...publishContext,
      mode: "compatible",
    });

    expect(result.success).toBe(true);
  });

  it("rejects duplicate or overlapping planned and omitted keys", () => {
    const duplicate = {
      schemaVersion: 2,
      ...publishContext,
      plannedRepresentationKeys: ["plain", "plain"],
      mode: "original",
    };
    const overlap = {
      schemaVersion: 2,
      ...publishContext,
      omittedRepresentationKeys: ["html"],
      mode: "partial",
    };

    expect(PastePlanV2Schema.safeParse(duplicate).success).toBe(false);
    expect(PastePlanV2Schema.safeParse(overlap).success).toBe(false);
  });

  it("rejects legacy command, path and raw-format properties", () => {
    const injectedInput = {
      schemaVersion: 2,
      ...publishContext,
      mode: "original",
      nativeFormat: "CF_PRIVATEFIRST",
      filePath: "/private/clipboard.bin",
      execute: "unexpected",
    };

    expect(PastePlanV2Schema.safeParse(injectedInput).success).toBe(false);
  });
});

describe("ClipboardPublishResultV2Schema", () => {
  it("accepts committed only when written keys exactly cover the frozen plan", () => {
    const valid = {
      ...publishContext,
      status: "committed",
      writeRevision: "write-rev-4",
      writtenRepresentationKeys: ["html", "plain"],
    };
    const incomplete = { ...valid, writtenRepresentationKeys: ["plain"] };
    const additional = { ...valid, writtenRepresentationKeys: ["plain", "html", "private"] };

    expect(ClipboardPublishResultV2Schema.safeParse(valid).success).toBe(true);
    expect(ClipboardPublishResultV2Schema.safeParse(incomplete).success).toBe(false);
    expect(ClipboardPublishResultV2Schema.safeParse(additional).success).toBe(false);
  });

  it("accepts partial writes only when written and missing keys partition the plan", () => {
    const valid = {
      ...publishContext,
      status: "partial-write",
      writtenRepresentationKeys: ["plain"],
      missingRepresentationKeys: ["html"],
      clipboardMayHaveChanged: true,
      reasonCode: "write-failed",
      recovery: "not-attempted",
    };
    const keyGap = { ...valid, missingRepresentationKeys: [] };
    const overlapping = {
      ...valid,
      missingRepresentationKeys: ["plain", "html"],
    };
    const missingSideEffect = { ...valid, clipboardMayHaveChanged: false };

    expect(ClipboardPublishResultV2Schema.safeParse(valid).success).toBe(true);
    expect(ClipboardPublishResultV2Schema.safeParse(keyGap).success).toBe(false);
    expect(ClipboardPublishResultV2Schema.safeParse(overlapping).success).toBe(false);
    expect(ClipboardPublishResultV2Schema.safeParse(missingSideEffect).success).toBe(false);
  });

  it("represents a fully written but unconfirmed publication without inventing missing keys", () => {
    const unconfirmed = {
      ...publishContext,
      status: "partial-write",
      writtenRepresentationKeys: ["plain", "html"],
      missingRepresentationKeys: [],
      clipboardMayHaveChanged: true,
      reasonCode: "publication-unconfirmed",
      recovery: "not-attempted",
    };
    const ordinaryWithoutMissing = {
      ...unconfirmed,
      reasonCode: "write-failed",
    };
    const unconfirmedIncomplete = {
      ...unconfirmed,
      writtenRepresentationKeys: ["plain"],
    };

    expect(ClipboardPublishResultV2Schema.safeParse(unconfirmed).success).toBe(true);
    expect(ClipboardPublishResultV2Schema.safeParse(ordinaryWithoutMissing).success).toBe(false);
    expect(ClipboardPublishResultV2Schema.safeParse(unconfirmedIncomplete).success).toBe(false);
  });

  it("keeps non-mutation outcomes tied to the same plan and rejects hidden mutations", () => {
    const failed = {
      ...publishContext,
      status: "failed",
      clipboardMayHaveChanged: false,
      reasonCode: "window-unavailable",
    };
    const destructiveFailure = { ...failed, clipboardMayHaveChanged: true };

    expect(ClipboardPublishResultV2Schema.safeParse(failed).success).toBe(true);
    expect(ClipboardPublishResultV2Schema.safeParse(destructiveFailure).success).toBe(false);
  });

  it("rejects an unsupported status carrying V1 or raw clipboard fields", () => {
    const legacyShape = {
      ...publishContext,
      status: "unsupported",
      clipboardMayHaveChanged: false,
      reasonCode: "codec-unavailable",
      content: "must not be silently discarded",
    };

    expect(ClipboardPublishResultV2Schema.safeParse(legacyShape).success).toBe(false);
  });
});

describe("ClipboardPublishExchangeV2Schema", () => {
  it("binds the publish receipt to the exact plan and manifest revision", () => {
    const plan = {
      schemaVersion: 2,
      ...publishContext,
      mode: "compatible",
    };
    const result = {
      ...publishContext,
      status: "committed",
      writeRevision: "write-rev-4",
      writtenRepresentationKeys: ["plain", "html"],
    };

    expect(ClipboardPublishExchangeV2Schema.safeParse({ plan, result }).success).toBe(true);
    expect(
      ClipboardPublishExchangeV2Schema.safeParse({
        plan,
        result: { ...result, manifestRevision: "stale-revision" },
      }).success,
    ).toBe(false);
    expect(
      ClipboardPublishExchangeV2Schema.safeParse({
        plan,
        result: { ...result, omittedRepresentationKeys: [] },
      }).success,
    ).toBe(false);
  });
});

describe("ChangeSequenceV2Schema", () => {
  it("accepts canonical unsigned 64-bit decimal strings", () => {
    expect(ChangeSequenceV2Schema.safeParse("0").success).toBe(true);
    expect(ChangeSequenceV2Schema.safeParse("18446744073709551615").success).toBe(true);
  });

  it("rejects signed, non-canonical and overflowing sequence values", () => {
    for (const value of [
      "-1",
      "+1",
      "01",
      "abc",
      "",
      "-",
      "18446744073709551616",
      "999999999999999999999",
    ]) {
      expect(() => ChangeSequenceV2Schema.safeParse(value)).not.toThrow();
      expect(ChangeSequenceV2Schema.safeParse(value).success).toBe(false);
    }
  });
});

describe("ClipboardJournalChangeEventV2Schema", () => {
  it("requires complete immutable references for upsert and delete events", () => {
    const missingManifestRef = { ...upsert("4"), manifestRef: undefined };
    const deleteEvent = {
      hostEpoch: "epoch-1",
      changeSeq: "5",
      eventType: "delete",
      snapshotId: "snapshot-1",
      tombstoneRevision: "tombstone-rev-1",
      tombstoneRef: "tombstone:snapshot-1:tombstone-rev-1",
      tombstoneSha256: sha256,
    };
    const missingDeleteDigest = { ...deleteEvent, tombstoneSha256: undefined };

    expect(ClipboardJournalChangeEventV2Schema.safeParse(upsert("4")).success).toBe(true);
    expect(ClipboardJournalChangeEventV2Schema.safeParse(missingManifestRef).success).toBe(false);
    expect(ClipboardJournalChangeEventV2Schema.safeParse(deleteEvent).success).toBe(true);
    expect(ClipboardJournalChangeEventV2Schema.safeParse(missingDeleteDigest).success).toBe(false);
  });

  it("stores policy outcomes as redacted reason codes with no snapshot body", () => {
    const redacted = {
      hostEpoch: "epoch-1",
      changeSeq: "6",
      eventType: "outcome",
      attemptId: "capture-attempt-1",
      outcomeCode: "policy-denied",
    };
    const withBody = { ...redacted, text: "secret clipboard contents" };
    const withManifest = { ...redacted, manifestRef: "manifest:secret" };
    const bodyAsCode = {
      ...redacted,
      outcomeCode: "secret clipboard contents from an unknown native error",
    };

    expect(ClipboardJournalChangeEventV2Schema.safeParse(redacted).success).toBe(true);
    expect(ClipboardJournalChangeEventV2Schema.safeParse(withBody).success).toBe(false);
    expect(ClipboardJournalChangeEventV2Schema.safeParse(withManifest).success).toBe(false);
    expect(ClipboardJournalChangeEventV2Schema.safeParse(bodyAsCode).success).toBe(false);
  });

  it("accepts only the frozen outcome code vocabulary", () => {
    const codes = [
      "policy-denied",
      "unsupported",
      "permission-denied",
      "superseded",
      "over-limit",
      "timeout",
      "capture-failed",
      "storage-failed",
    ];

    for (const outcomeCode of codes) {
      expect(
        ClipboardJournalChangeEventV2Schema.safeParse({
          hostEpoch: "epoch-1",
          changeSeq: "6",
          eventType: "outcome",
          attemptId: "capture-attempt-1",
          outcomeCode,
        }).success,
      ).toBe(true);
    }
  });

  it("rejects legacy event keys and invalid sequence overflow", () => {
    const deleteEventWithBody = {
      hostEpoch: "epoch-1",
      changeSeq: "8",
      eventType: "delete",
      snapshotId: "snapshot-1",
      tombstoneRevision: "tombstone-rev-1",
      tombstoneRef: "tombstone:snapshot-1:tombstone-rev-1",
      tombstoneSha256: sha256,
      text: "deleted clipboard content must not enter the journal",
    };

    expect(
      ClipboardJournalChangeEventV2Schema.safeParse({
        ...upsert("4"),
        content: { text: "legacy value" },
      }).success,
    ).toBe(false);
    expect(ClipboardJournalChangeEventV2Schema.safeParse(deleteEventWithBody).success).toBe(false);
    expect(ClipboardJournalChangeEventV2Schema.safeParse(upsert("18446744073709551616")).success)
      .toBe(false);
  });
});

describe("ClipboardJournalReadResultV2Schema", () => {
  it("accepts a contiguous page bounded by its journal head", () => {
    const result = ClipboardJournalPageV2Schema.safeParse({
      status: "ok",
      hostEpoch: "epoch-1",
      after: "4",
      nextCursor: "6",
      retentionFloor: "1",
      latestChangeSeq: "7",
      limit: 2,
      events: [upsert("5"), upsert("6")],
    });

    expect(result.success).toBe(true);
    expect(ClipboardJournalReadResultV2Schema.safeParse(result.data).success).toBe(true);
  });

  it("rejects pages with sequence gaps, epoch mixing, false cursors or expired cursors", () => {
    const page = {
      status: "ok",
      hostEpoch: "epoch-1",
      after: "4",
      nextCursor: "6",
      retentionFloor: "1",
      latestChangeSeq: "7",
      limit: 2,
      events: [upsert("5"), upsert("6")],
    };
    const gap = { ...page, events: [upsert("5"), upsert("7")] };
    const foreignEpoch = { ...page, events: [upsert("5"), { ...upsert("6"), hostEpoch: "epoch-2" }] };
    const badCursor = { ...page, nextCursor: "5" };
    const retentionGap = { ...page, after: "1", retentionFloor: "4", events: [upsert("5"), upsert("6")] };
    const eventsPastHead = {
      ...page,
      after: "0",
      nextCursor: "2",
      latestChangeSeq: "1",
      retentionFloor: "1",
      events: [upsert("1"), upsert("2")],
    };
    const cursorPastHead = {
      ...page,
      after: "0",
      nextCursor: "2",
      latestChangeSeq: "1",
      retentionFloor: "1",
      events: [upsert("1")],
    };
    const cursorPastHeadResult = ClipboardJournalPageV2Schema.safeParse(cursorPastHead);

    expect(ClipboardJournalPageV2Schema.safeParse(gap).success).toBe(false);
    expect(ClipboardJournalPageV2Schema.safeParse(foreignEpoch).success).toBe(false);
    expect(ClipboardJournalPageV2Schema.safeParse(badCursor).success).toBe(false);
    expect(ClipboardJournalPageV2Schema.safeParse(retentionGap).success).toBe(false);
    expect(ClipboardJournalPageV2Schema.safeParse(eventsPastHead).success).toBe(false);
    expect(cursorPastHeadResult.success).toBe(false);
    if (!cursorPastHeadResult.success) {
      expect(
        cursorPastHeadResult.error.issues.some(
          (issue) => issue.message === "nextCursor cannot exceed latestChangeSeq",
        ),
      ).toBe(true);
    }
  });

  it("requires cursor-expired and host-reset to be explicit read outcomes", () => {
    const expired = {
      status: "cursor-expired",
      hostEpoch: "epoch-1",
      requestedCursor: "1",
      retentionFloor: "4",
      reason: "retention",
    };
    const reset = {
      status: "host-reset",
      expectedHostEpoch: "epoch-old",
      hostEpoch: "epoch-new",
      requestedCursor: "900",
      retentionFloor: "1",
      reason: "host-epoch-changed",
    };

    expect(ClipboardJournalCursorExpiredV2Schema.safeParse(expired).success).toBe(true);
    expect(ClipboardJournalHostResetV2Schema.safeParse(reset).success).toBe(true);
    expect(ClipboardJournalReadResultV2Schema.safeParse(expired).success).toBe(true);
    expect(ClipboardJournalReadResultV2Schema.safeParse(reset).success).toBe(true);
    expect(
      ClipboardJournalCursorExpiredV2Schema.safeParse({ ...expired, retentionFloor: "2" }).success,
    ).toBe(false);
  });
});
