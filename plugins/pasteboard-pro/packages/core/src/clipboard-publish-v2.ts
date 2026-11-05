import { z } from "zod";

const IdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const ObjectRefSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const RepresentationKeySchema = IdentifierSchema;
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

function addUniqueIssue(values: readonly string[], path: (string | number)[], ctx: z.RefinementCtx) {
  if (new Set(values).size !== values.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: "representation keys must be unique",
    });
  }
}

function addNoOverlapIssue(
  left: readonly string[],
  right: readonly string[],
  path: (string | number)[],
  ctx: z.RefinementCtx,
) {
  const rightValues = new Set(right);
  if (left.some((value) => rightValues.has(value))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: "planned and omitted representation keys must not overlap",
    });
  }
}

export const PastePlanV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    planId: IdentifierSchema,
    snapshotId: IdentifierSchema,
    manifestRevision: IdentifierSchema,
    mode: z.enum(["original", "compatible", "plain-text", "queue", "partial"]),
    plannedRepresentationKeys: z.array(RepresentationKeySchema).min(1),
    omittedRepresentationKeys: z.array(RepresentationKeySchema),
  })
  .strict()
  .superRefine((plan, ctx) => {
    addUniqueIssue(plan.plannedRepresentationKeys, ["plannedRepresentationKeys"], ctx);
    addUniqueIssue(plan.omittedRepresentationKeys, ["omittedRepresentationKeys"], ctx);
    addNoOverlapIssue(
      plan.plannedRepresentationKeys,
      plan.omittedRepresentationKeys,
      ["omittedRepresentationKeys"],
      ctx,
    );
  });

const PublishContextV2Schema = z
  .object({
    planId: IdentifierSchema,
    snapshotId: IdentifierSchema,
    manifestRevision: IdentifierSchema,
    plannedRepresentationKeys: z.array(RepresentationKeySchema).min(1),
    omittedRepresentationKeys: z.array(RepresentationKeySchema),
  })
  .strict();

const PublishCommittedV2Schema = PublishContextV2Schema.extend({
  status: z.literal("committed"),
  writeRevision: IdentifierSchema,
  writtenRepresentationKeys: z.array(RepresentationKeySchema).min(1),
}).strict();

const PublishPartialWriteV2Schema = PublishContextV2Schema.extend({
  status: z.literal("partial-write"),
  writeRevision: IdentifierSchema.optional(),
  writtenRepresentationKeys: z.array(RepresentationKeySchema),
  missingRepresentationKeys: z.array(RepresentationKeySchema),
  clipboardMayHaveChanged: z.literal(true),
  reasonCode: IdentifierSchema,
  recovery: z.enum(["not-attempted", "restored", "failed", "superseded"]),
}).strict();

const PublishNonMutationV2Schema = PublishContextV2Schema.extend({
  status: z.enum(["unsupported", "superseded", "permission-denied", "failed"]),
  clipboardMayHaveChanged: z.literal(false),
  observedRevision: IdentifierSchema.optional(),
  reasonCode: IdentifierSchema,
}).strict();

export const ClipboardPublishResultV2Schema = z
  .union([
    PublishCommittedV2Schema,
    PublishPartialWriteV2Schema,
    PublishNonMutationV2Schema,
  ])
  .superRefine((result, ctx) => {
    addUniqueIssue(result.plannedRepresentationKeys, ["plannedRepresentationKeys"], ctx);
    addUniqueIssue(result.omittedRepresentationKeys, ["omittedRepresentationKeys"], ctx);
    addNoOverlapIssue(
      result.plannedRepresentationKeys,
      result.omittedRepresentationKeys,
      ["omittedRepresentationKeys"],
      ctx,
    );

    if (result.status === "committed") {
      addUniqueIssue(result.writtenRepresentationKeys, ["writtenRepresentationKeys"], ctx);
      if (!sameKeys(result.plannedRepresentationKeys, result.writtenRepresentationKeys)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["writtenRepresentationKeys"],
          message: "committed results must confirm every planned representation exactly once",
        });
      }
      return;
    }

    if (result.status === "partial-write") {
      addUniqueIssue(result.writtenRepresentationKeys, ["writtenRepresentationKeys"], ctx);
      addUniqueIssue(result.missingRepresentationKeys, ["missingRepresentationKeys"], ctx);
      addNoOverlapIssue(
        result.writtenRepresentationKeys,
        result.missingRepresentationKeys,
        ["missingRepresentationKeys"],
        ctx,
      );
      const allPlannedWritten = sameKeys(
        result.plannedRepresentationKeys,
        result.writtenRepresentationKeys,
      );
      if (result.reasonCode === "publication-unconfirmed") {
        if (result.missingRepresentationKeys.length !== 0 || !allPlannedWritten) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["writtenRepresentationKeys"],
            message:
              "publication-unconfirmed requires every planned key written and no missing keys",
          });
        }
      } else if (result.missingRepresentationKeys.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["missingRepresentationKeys"],
          message: "partial writes require missing keys unless publication is unconfirmed",
        });
      }
      if (!sameKeys(
        result.plannedRepresentationKeys,
        [...result.writtenRepresentationKeys, ...result.missingRepresentationKeys],
      )) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["missingRepresentationKeys"],
          message: "written and missing keys must account for every planned representation",
        });
      }
      return;
    }

    if (result.status === "failed" && result.clipboardMayHaveChanged) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clipboardMayHaveChanged"],
        message: "a failed mutation must be reported as partial-write",
      });
    }
  });

export const ClipboardPublishExchangeV2Schema = z
  .object({
    plan: PastePlanV2Schema,
    result: ClipboardPublishResultV2Schema,
  })
  .strict()
  .superRefine(({ plan, result }, ctx) => {
    if (
      plan.planId !== result.planId ||
      plan.snapshotId !== result.snapshotId ||
      plan.manifestRevision !== result.manifestRevision
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["result"],
        message: "publish results must identify the exact frozen plan and manifest revision",
      });
    }
    if (
      !sameOrderedKeys(plan.plannedRepresentationKeys, result.plannedRepresentationKeys) ||
      !sameOrderedKeys(plan.omittedRepresentationKeys, result.omittedRepresentationKeys)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["result"],
        message: "publish result key lists must match the frozen plan exactly",
      });
    }
  });

function sameKeys(expected: readonly string[], actual: readonly string[]): boolean {
  if (expected.length !== actual.length) return false;
  const actualKeys = new Set(actual);
  return expected.every((key) => actualKeys.has(key));
}

const CHANGE_SEQUENCE_PATTERN = /^(0|[1-9][0-9]{0,19})$/;

export const ChangeSequenceV2Schema = z
  .string()
  .regex(CHANGE_SEQUENCE_PATTERN)
  .refine(
    (value) =>
      CHANGE_SEQUENCE_PATTERN.test(value) &&
      BigInt(value) <= 18_446_744_073_709_551_615n,
    {
      message: "changeSeq must fit an unsigned 64-bit integer",
    },
  );
export type ChangeSequenceV2 = z.infer<typeof ChangeSequenceV2Schema>;

export const ClipboardJournalOutcomeCodeV2Schema = z.enum([
  "policy-denied",
  "unsupported",
  "permission-denied",
  "superseded",
  "over-limit",
  "timeout",
  "capture-failed",
  "storage-failed",
]);
export type ClipboardJournalOutcomeCodeV2 = z.infer<
  typeof ClipboardJournalOutcomeCodeV2Schema
>;

const ChangeEventBaseV2Schema = z.object({
  hostEpoch: IdentifierSchema,
  changeSeq: ChangeSequenceV2Schema,
  eventType: z.enum(["upsert", "outcome", "delete"]),
});

const UpsertChangeEventV2Schema = ChangeEventBaseV2Schema.extend({
  eventType: z.literal("upsert"),
  snapshotId: IdentifierSchema,
  manifestRevision: IdentifierSchema,
  manifestRef: ObjectRefSchema,
  manifestSha256: Sha256Schema,
}).strict();

const RedactedOutcomeChangeEventV2Schema = ChangeEventBaseV2Schema.extend({
  eventType: z.literal("outcome"),
  attemptId: IdentifierSchema,
  outcomeCode: ClipboardJournalOutcomeCodeV2Schema,
}).strict();

const DeleteChangeEventV2Schema = ChangeEventBaseV2Schema.extend({
  eventType: z.literal("delete"),
  snapshotId: IdentifierSchema,
  tombstoneRevision: IdentifierSchema,
  tombstoneRef: ObjectRefSchema,
  tombstoneSha256: Sha256Schema,
}).strict();

export const ClipboardJournalChangeEventV2Schema = z.union([
  UpsertChangeEventV2Schema,
  RedactedOutcomeChangeEventV2Schema,
  DeleteChangeEventV2Schema,
]);

export const ClipboardJournalPageV2Schema = z
  .object({
    status: z.literal("ok"),
    hostEpoch: IdentifierSchema,
    after: ChangeSequenceV2Schema,
    nextCursor: ChangeSequenceV2Schema,
    retentionFloor: ChangeSequenceV2Schema,
    latestChangeSeq: ChangeSequenceV2Schema,
    limit: z.number().int().min(1).max(500),
    events: z.array(ClipboardJournalChangeEventV2Schema),
  })
  .strict()
  .superRefine((page, ctx) => {
    const after = BigInt(page.after);
    const floor = BigInt(page.retentionFloor);
    const latest = BigInt(page.latestChangeSeq);
    const next = BigInt(page.nextCursor);

    if (floor > after + 1n) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["after"],
        message: "an expired cursor must return cursor-expired instead of a page",
      });
    }
    if (after > latest) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["after"],
        message: "after cannot be ahead of latestChangeSeq",
      });
    }
    if (next > latest) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nextCursor"],
        message: "nextCursor cannot exceed latestChangeSeq",
      });
    }
    if (page.events.length > page.limit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["events"],
        message: "events cannot exceed the requested page limit",
      });
    }

    let expectedSeq = after + 1n;
    for (const [index, event] of page.events.entries()) {
      const actualSeq = BigInt(event.changeSeq);
      if (actualSeq > latest) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["events", index, "changeSeq"],
          message: "event changeSeq cannot exceed latestChangeSeq",
        });
      }
      if (event.hostEpoch !== page.hostEpoch || actualSeq !== expectedSeq) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["events", index],
          message: "page events must match this host epoch and form a contiguous sequence",
        });
      }
      expectedSeq += 1n;
    }

    const expectedNext = page.events.length === 0
      ? after
      : BigInt(page.events[page.events.length - 1]!.changeSeq);
    if (next !== expectedNext) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nextCursor"],
        message: "nextCursor must equal the last returned sequence or after when empty",
      });
    }
    if (page.events.length < page.limit && next !== latest) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["latestChangeSeq"],
        message: "a short page must reach the journal head",
      });
    }
  });

export const ClipboardJournalCursorExpiredV2Schema = z
  .object({
    status: z.literal("cursor-expired"),
    hostEpoch: IdentifierSchema,
    requestedCursor: ChangeSequenceV2Schema,
    retentionFloor: ChangeSequenceV2Schema,
    reason: z.literal("retention"),
  })
  .strict()
  .refine(
    ({ requestedCursor, retentionFloor }) =>
      BigInt(retentionFloor) > BigInt(requestedCursor) + 1n,
    { message: "cursor-expired requires a retention gap" },
  );
export type ClipboardJournalCursorExpiredV2 = z.infer<
  typeof ClipboardJournalCursorExpiredV2Schema
>;

export const ClipboardJournalHostResetV2Schema = z
  .object({
    status: z.literal("host-reset"),
    expectedHostEpoch: IdentifierSchema,
    hostEpoch: IdentifierSchema,
    requestedCursor: ChangeSequenceV2Schema,
    retentionFloor: ChangeSequenceV2Schema,
    reason: z.literal("host-epoch-changed"),
  })
  .strict()
  .refine(({ expectedHostEpoch, hostEpoch }) => expectedHostEpoch !== hostEpoch, {
    message: "host-reset must identify a new journal epoch",
  });
export type ClipboardJournalHostResetV2 = z.infer<
  typeof ClipboardJournalHostResetV2Schema
>;

export const ClipboardJournalReadResultV2Schema = z.union([
  ClipboardJournalPageV2Schema,
  ClipboardJournalCursorExpiredV2Schema,
  ClipboardJournalHostResetV2Schema,
]);

export type PastePlanV2 = z.infer<typeof PastePlanV2Schema>;
export type ClipboardPublishResultV2 = z.infer<typeof ClipboardPublishResultV2Schema>;
export type ClipboardPublishExchangeV2 = z.infer<
  typeof ClipboardPublishExchangeV2Schema
>;
export type ClipboardJournalChangeEventV2 = z.infer<
  typeof ClipboardJournalChangeEventV2Schema
>;
export type ClipboardJournalPageV2 = z.infer<typeof ClipboardJournalPageV2Schema>;
export type ClipboardJournalReadResultV2 = z.infer<
  typeof ClipboardJournalReadResultV2Schema
>;

function sameOrderedKeys(expected: readonly string[], actual: readonly string[]): boolean {
  return expected.length === actual.length && expected.every((key, index) => key === actual[index]);
}
