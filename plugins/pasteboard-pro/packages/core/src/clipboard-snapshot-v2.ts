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
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const BoundedMetadataSchema = z.string().trim().min(1).max(512);
const FileReferenceLocatorV2Schema = z
  .string()
  .min(1)
  .max(4096)
  .refine((locator) => {
    if (/[\u0000-\u001f\u007f]/.test(locator)) return false;
    if (/^file:/i.test(locator)) {
      try {
        return new URL(locator).protocol === "file:";
      } catch {
        return false;
      }
    }

    return (
      /^[A-Za-z]:[\\/]/.test(locator) ||
      /^\\\\[^\\/]+[\\/][^\\/]+/.test(locator) ||
      locator.startsWith("/")
    );
  }, "file references must be file URLs or absolute local paths");

export const ClipboardPlatformV2Schema = z.enum(["macos", "windows", "linux"]);
export type ClipboardPlatformV2 = z.infer<typeof ClipboardPlatformV2Schema>;

export const ClipboardItemModelV2Schema = z.enum([
  "macos-items",
  "windows-format-set",
  "linux-clipboard",
]);
export type ClipboardItemModelV2 = z.infer<typeof ClipboardItemModelV2Schema>;

export const SourceApplicationIdentityV2Schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bundle-id"), identifier: BoundedMetadataSchema }).strict(),
  z.object({ kind: z.literal("aumid"), identifier: BoundedMetadataSchema }).strict(),
  z.object({ kind: z.literal("executable"), identifier: BoundedMetadataSchema }).strict(),
  z.object({ kind: z.literal("unknown") }).strict(),
]);
export type SourceApplicationIdentityV2 = z.infer<
  typeof SourceApplicationIdentityV2Schema
>;

export const ClipboardSourceV2Schema = z
  .object({
    hostEpoch: IdentifierSchema,
    platform: ClipboardPlatformV2Schema,
    osRevision: BoundedMetadataSchema,
    capturedAt: z.string().datetime({ offset: false }),
    osBuild: BoundedMetadataSchema,
    architecture: BoundedMetadataSchema,
    adapterVersion: BoundedMetadataSchema,
    itemModel: ClipboardItemModelV2Schema,
    sourceApplication: SourceApplicationIdentityV2Schema,
    attribution: z.enum(["trusted", "heuristic", "unknown"]),
  })
  .strict()
  .superRefine((source, ctx) => {
    const expectedModel = {
      macos: "macos-items",
      windows: "windows-format-set",
      linux: "linux-clipboard",
    } as const;

    if (source.itemModel !== expectedModel[source.platform]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["itemModel"],
        message: "itemModel must match the source platform",
      });
    }

    const validIdentityKinds: Record<ClipboardPlatformV2, readonly string[]> = {
      macos: ["bundle-id", "executable", "unknown"],
      windows: ["aumid", "executable", "unknown"],
      linux: ["executable", "unknown"],
    };

    if (!validIdentityKinds[source.platform].includes(source.sourceApplication.kind)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceApplication", "kind"],
        message: "source application identity kind must match the source platform",
      });
    }

    if (source.attribution === "unknown" && source.sourceApplication.kind !== "unknown") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceApplication"],
        message: "unknown attribution must not claim a source application identity",
      });
    }
  });
export type ClipboardSourceV2 = z.infer<typeof ClipboardSourceV2Schema>;

const RepresentationIdentityV2Schema = z
  .object({
    representationKey: IdentifierSchema,
    formatId: BoundedMetadataSchema,
    nativeName: BoundedMetadataSchema,
    mime: BoundedMetadataSchema.optional(),
  })
  .strict();

const ReadyBlobRepresentationV2Schema = RepresentationIdentityV2Schema.extend({
  state: z.literal("ready"),
  storage: z.literal("blob"),
  fidelity: z.enum(["exact", "compatible"]),
  byteLength: z.number().int().nonnegative().safe(),
  sha256: Sha256Schema,
  blobRef: ObjectRefSchema,
  derivedFrom: IdentifierSchema.optional(),
}).strict();

const ReadyFileReferenceV2Schema = RepresentationIdentityV2Schema.extend({
  state: z.literal("ready"),
  storage: z.literal("file-reference"),
  fidelity: z.literal("reference"),
  originDeviceId: IdentifierSchema,
  references: z
    .array(
      z
        .object({
          url: FileReferenceLocatorV2Schema,
          isDirectory: z.boolean(),
          observedAvailability: z.enum(["available", "missing", "unknown"]),
        })
        .strict(),
    )
    .min(1),
}).strict();

const UnavailableRepresentationV2Schema = RepresentationIdentityV2Schema.extend({
  state: z.enum([
    "unsupported",
    "timeout",
    "over-limit",
    "failed",
    "policy-blocked",
  ]),
  reasonCode: IdentifierSchema,
}).strict();

export const ClipboardRepresentationV2Schema = z.union([
  ReadyBlobRepresentationV2Schema,
  ReadyFileReferenceV2Schema,
  UnavailableRepresentationV2Schema,
]);

export const ClipboardItemV2Schema = z
  .object({
    index: z.number().int().nonnegative().safe(),
    representations: z.array(ClipboardRepresentationV2Schema).min(1),
  })
  .strict();

export const SnapshotCoverageV2Schema = z
  .object({
    requested: z.number().int().nonnegative().safe(),
    captured: z.number().int().nonnegative().safe(),
    omitted: z.number().int().nonnegative().safe(),
  })
  .strict()
  .refine(({ requested, captured, omitted }) => requested === captured + omitted, {
    message: "requested must equal captured plus omitted",
  });
export type SnapshotCoverageV2 = z.infer<typeof SnapshotCoverageV2Schema>;

export const ClipboardSnapshotManifestV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    snapshotId: IdentifierSchema,
    manifestRevision: IdentifierSchema,
    source: ClipboardSourceV2Schema,
    policyReceiptId: IdentifierSchema,
    items: z.array(ClipboardItemV2Schema).min(1),
    coverage: SnapshotCoverageV2Schema,
    captureState: z.enum(["ready", "partial", "failed"]),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const seenIndexes = new Set<number>();
    const seenRepresentationKeys = new Set<string>();
    const derivedSources: Array<{ itemIndex: number; key: string; source: string }> = [];
    const readyCount = manifest.items.reduce((count, item) => {
      for (const representation of item.representations) {
        if (seenRepresentationKeys.has(representation.representationKey)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["items", item.index, "representations"],
            message: "representationKey must be unique across the manifest",
          });
        }
        seenRepresentationKeys.add(representation.representationKey);

        if (representation.state === "ready") {
          count += 1;
          if ("derivedFrom" in representation && representation.derivedFrom !== undefined) {
            derivedSources.push({
              itemIndex: item.index,
              key: representation.representationKey,
              source: representation.derivedFrom,
            });
          }
        }
      }

      return count;
    }, 0);
    const representationCount = manifest.items.reduce(
      (count, item) => count + item.representations.length,
      0,
    );

    manifest.items.forEach((item, position) => {
      if (seenIndexes.has(item.index)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", position, "index"],
          message: "item index must be unique",
        });
      }
      seenIndexes.add(item.index);

      if (position > 0 && item.index <= manifest.items[position - 1]!.index) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", position, "index"],
          message: "items must be ordered by increasing source index",
        });
      }
    });

    for (const derived of derivedSources) {
      const sourceItem = manifest.items.find((item) => item.index === derived.itemIndex);
      if (!sourceItem?.representations.some((entry) => entry.representationKey === derived.source)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", derived.itemIndex, "representations", derived.key, "derivedFrom"],
          message: "derivedFrom must reference a representation in the same item",
        });
      }
    }

    const { requested, captured, omitted } = manifest.coverage;
    if (requested !== representationCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coverage", "requested"],
        message: "every requested format must be represented by one manifest entry",
      });
    }
    if (captured !== readyCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coverage", "captured"],
        message: "captured must equal the number of ready representations",
      });
    }
    if (omitted !== representationCount - readyCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coverage", "omitted"],
        message: "omitted must equal the number of unavailable representations",
      });
    }

    const expectedState =
      readyCount === representationCount ? "ready" : readyCount > 0 ? "partial" : "failed";
    if (manifest.captureState !== expectedState) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["captureState"],
        message: `captureState must be ${expectedState} for this coverage`,
      });
    }

    if (manifest.source.platform === "windows" &&
      (manifest.items.length !== 1 || manifest.items[0]?.index !== 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "Windows format sets must use one logical item at index zero",
      });
    }
  });

export type ClipboardRepresentationV2 = z.infer<typeof ClipboardRepresentationV2Schema>;
export type ClipboardItemV2 = z.infer<typeof ClipboardItemV2Schema>;
export type ClipboardSnapshotManifestV2 = z.infer<
  typeof ClipboardSnapshotManifestV2Schema
>;
