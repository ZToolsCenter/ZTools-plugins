import { z } from "zod";
import {
  ContentKindV2Schema,
  ContentScanStatusV2Schema,
  ContentScanCheckV2Schema,
  ScanScopeV2Schema,
  type ContentKindV2,
  type ScanScopeV2,
} from "@pasteboard-pro/core";
import { isArrayBufferBackedUint8ArrayV2 } from "@pasteboard-pro/core";

export {
  ContentKindV2Schema,
  ContentScanStatusV2Schema,
  ContentScanCheckV2Schema,
  ScanScopeV2Schema,
};
export type { ContentKindV2, ScanScopeV2 };

const IdentifierV2Schema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const RevisionV2Schema = z.string().min(1).max(512).refine((value) => value.trim().length > 0);
const RuleValueV2Schema = z.string().min(1).max(256);
const RuleFlagsV2Schema = z
  .string()
  .max(4)
  .refine((flags) => [...flags].every((flag) => "imsu".includes(flag)) && new Set(flags).size === flags.length);
const ContentRuleV2Schema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("literal"), value: RuleValueV2Schema }).strict(),
    z.object({ type: z.literal("wildcard"), value: RuleValueV2Schema }).strict(),
    z.object({ type: z.literal("regex"), value: RuleValueV2Schema, flags: RuleFlagsV2Schema.optional() }).strict(),
  ])
  .readonly();

export const ScanPolicyV2Schema = z
  .object({
    revision: RevisionV2Schema,
    blockLikelySecrets: z.boolean(),
    contentRules: z.array(ContentRuleV2Schema).max(32).readonly(),
  })
  .strict()
  .readonly();
export type ScanPolicyV2 = Readonly<{
  revision: string;
  blockLikelySecrets: boolean;
  contentRules: readonly z.infer<typeof ContentRuleV2Schema>[];
}>;

export const ScanCodecV2Schema = z
  .object({
    representationKey: IdentifierV2Schema,
    contentKind: ContentKindV2Schema,
    richTextFormat: z.enum(["html", "rtf"]).optional(),
    htmlContainer: z.enum(["cf-html"]).optional(),
    encoding: z.enum(["utf-8", "utf-16le", "utf-16be"]).optional(),
    termination: z.enum(["none", "nul"]).optional(),
  })
  .strict()
  .superRefine((codec, ctx) => {
    if (codec.richTextFormat !== undefined && codec.contentKind !== "rich-text") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["richTextFormat"], message: "rich text formats require rich-text content" });
    }
    if (codec.htmlContainer !== undefined &&
        (codec.contentKind !== "rich-text" || codec.richTextFormat !== "html" ||
         codec.encoding !== "utf-8" || codec.termination !== "none")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["htmlContainer"], message: "CF_HTML requires UTF-8 HTML rich text without termination" });
    }
    if (codec.richTextFormat === "rtf" &&
        (codec.encoding !== undefined || codec.termination !== undefined || codec.htmlContainer !== undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["richTextFormat"], message: "RTF uses its own byte-level charset and framing" });
    }
    if (codec.contentKind === "rich-text" && codec.richTextFormat === "html") {
      if (codec.encoding === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["encoding"], message: "HTML rich text codecs require an explicit encoding" });
      }
      if (codec.termination === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["termination"], message: "HTML rich text codecs require explicit framing" });
      }
    }
    if ((codec.contentKind === "text" || codec.contentKind === "url") && codec.encoding === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["encoding"], message: "text codecs require an encoding" });
    }
  })
  .readonly();
export type ScanCodecV2 = z.infer<typeof ScanCodecV2Schema>;

const ItemIndexV2Schema = z.number().int().safe().min(0).max(31);
const RequiredScopesV2Schema = z.array(ScanScopeV2Schema).max(6).readonly();
export const ContentPolicyScanRequestV2Schema = z
  .object({
    policyRevision: RevisionV2Schema,
    representationKey: IdentifierV2Schema,
    itemIndex: ItemIndexV2Schema,
    contentKind: ContentKindV2Schema,
    requiredScopes: RequiredScopesV2Schema,
    bytes: z.custom<Uint8Array>(isArrayBufferBackedUint8ArrayV2),
  })
  .strict()
  .superRefine((request, ctx) => {
    if (new Set(request.requiredScopes).size !== request.requiredScopes.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["requiredScopes"], message: "scopes must be unique" });
    }
  })
  .readonly();

const ScanWorkerRequestV2Schema = z
  .object({
    policyRevision: RevisionV2Schema,
    representationKey: IdentifierV2Schema,
    itemIndex: ItemIndexV2Schema,
    contentKind: ContentKindV2Schema,
    requiredScopes: RequiredScopesV2Schema,
    bytes: z.custom<Uint8Array>(isArrayBufferBackedUint8ArrayV2),
  })
  .strict()
  .superRefine((request, ctx) => {
    if (new Set(request.requiredScopes).size !== request.requiredScopes.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["requiredScopes"], message: "scopes must be unique" });
    }
  })
  .readonly();

export const ScanWorkerTaskV2Schema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: IdentifierV2Schema,
    policy: ScanPolicyV2Schema,
    codec: ScanCodecV2Schema,
    request: ScanWorkerRequestV2Schema,
  })
  .strict()
  .superRefine((task, ctx) => {
    if (task.request.policyRevision !== task.policy.revision) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["request", "policyRevision"], message: "policy revision mismatch" });
    }
    if (task.request.representationKey !== task.codec.representationKey) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["request", "representationKey"], message: "codec identity mismatch" });
    }
    if (task.request.contentKind !== task.codec.contentKind) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["request", "contentKind"], message: "codec kind mismatch" });
    }
  })
  .readonly();
export type ScanWorkerTaskV2 = z.infer<typeof ScanWorkerTaskV2Schema>;

export const ScanWorkerResponseV2Schema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: IdentifierV2Schema,
    policyRevision: RevisionV2Schema,
    representationKey: IdentifierV2Schema,
    checks: z.array(ContentScanCheckV2Schema).max(6).readonly(),
  })
  .strict()
  .superRefine((response, ctx) => {
    const scopes = response.checks.map((check) => check.scope);
    if (new Set(scopes).size !== scopes.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["checks"], message: "scopes must be unique" });
    }
  })
  .readonly();
export type ScanWorkerResponseV2 = z.infer<typeof ScanWorkerResponseV2Schema>;
