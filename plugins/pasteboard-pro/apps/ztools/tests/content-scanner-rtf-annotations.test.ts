import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { evaluateCaptureContentPolicyV2 } from "@pasteboard-pro/core";
import type { CaptureContentPolicyInputV2 } from "@pasteboard-pro/core";
import { makeRtf, rtf } from "./content-rtf-fixtures";
import { codec, request, scanner } from "./content-scanner-v2-fixtures";

const PASS = [{ scope: "text", status: "passed" }, { scope: "links", status: "passed" }];
const SECRET = "private-text";

function annotationPart(
  body = "safe comment",
  id = "note-1",
  author = "Alice",
  date = "1180187342",
  options: { time?: string; parent?: string } = {},
) {
  const time = options.time !== undefined ? "{|*|atntime" + options.time + "}" : "";
  const parent = options.parent ? "{|*|atnparent " + options.parent + "}" : "";
  return "{|*|atnid " + id + "}{|*|atnauthor " + author + "}" + time +
    "|chatn {|*|annotation{|*|atndate " + date + "}" + parent + "|pard|plain " + body + "}";
}

function comment(body = "safe comment", id = "note-1", author = "Alice", date = "1180187342") {
  return rtf("{|rtf1|ansi|ansicpg1252|uc1 prefix " + annotationPart(body, id, author, date) + " suffix}");
}

function documentWith(...parts: string[]) {
  return rtf("{|rtf1|ansi|ansicpg1252|uc1 prefix " + parts.join(" ") + " suffix}");
}

const ANNOTATION_DATE_DESTINATION = "{\\*\\atndate 1180187342}";
const duplicateAtndateSource = comment().replace(
  ANNOTATION_DATE_DESTINATION,
  ANNOTATION_DATE_DESTINATION + ANNOTATION_DATE_DESTINATION,
);
const duplicateAtnidSecretSource = comment(rtfHex(SECRET)).replace(
  "{\\*\\atnid note-1}",
  "{\\*\\atnid first}{\\*\\atnid second}",
);

function rtfHex(value: string) {
  return Array.from(new TextEncoder().encode(value), (byte) => "\\'" + byte.toString(16).padStart(2, "0")).join("");
}

function richCodec() {
  return { ...codec("rtf", "rich-text"), richTextFormat: "rtf" as const };
}

function capture(bytes: Uint8Array, includePartial = false) {
  const representations: CaptureContentPolicyInputV2["representations"] = [
    { representationKey: "rtf", itemIndex: 0, state: "captured" as const, contentKind: "rich-text" as const, bytes },
  ];
  if (includePartial) representations.unshift({ representationKey: "plain", itemIndex: 0, state: "captured", contentKind: "text", bytes: new TextEncoder().encode("safe plain") });
  return {
    attemptId: "attempt-rtf-annotation", snapshotId: "snapshot-rtf-annotation",
    manifestRevision: "manifest-rtf-annotation", receiptId: "receipt-rtf-annotation",
    capturedRevision: "41", observedRevision: "41",
    policy: { revision: "policy-1", contentRulesEnabled: true, requireFileBodyScan: false },
    preflight: { capturedRevision: "41", policyRevision: "policy-1", captureAllowed: true, localHistoryAllowed: true, cloudUploadAllowed: false },
    representations,
  };
}

async function scanRules(literals: readonly string[] = []) {
  return scanner({ codecs: [richCodec(), codec("plain")], policy: {
    revision: "policy-1", blockLikelySecrets: false,
    contentRules: literals.map((value) => ({ type: "literal" as const, value })),
  } });
}

describe("RTF annotation structure in the real content worker", () => {
  it("admits a complete comment through the whole-copy policy gate and preserves its raw bytes", async () => {
    const runtime = await scanRules();
    const bytes = makeRtf(comment());
    const original = bytes.slice();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    try {
      const result = await evaluateCaptureContentPolicyV2(capture(bytes), {
        currentPolicyRevision: () => "policy-1", scan: runtime.scan,
      });
      expect(result.status).toBe("eligible");
      if (result.status !== "eligible") return;
      expect(result.admittedRepresentations).toHaveLength(1);
      expect(result.admittedRepresentations[0]?.bytes).toEqual(original);
      const receiptRepresentation = result.receipt.representations.find((row) => row.representationKey === "rtf");
      expect(receiptRepresentation?.retentionAllowed).toBe(true);
      if (!receiptRepresentation?.retentionAllowed) return;
      expect(receiptRepresentation.sha256).toBe(sha256);
      expect(bytes).toEqual(original);
    } finally { await runtime.dispose(); }
  });

  it.each([
    { part: "annotation ID", source: comment("safe", rtfHex(SECRET), "Alice"), literal: SECRET },
    { part: "author", source: comment("safe", "note-1", rtfHex(SECRET)), literal: SECRET },
    { part: "comment text", source: comment(rtfHex("prefix private-text suffix")), literal: SECRET },
    { part: "date destination", source: comment("safe", "note-1", "Alice", rtfHex("1180187342")), literal: "1180187342" },
    { part: "URL in comment", source: comment(rtfHex('HYPERLINK "https://example.invalid/private-text"')), literal: SECRET },
  ])("blocks a match in $part without returning content", async ({ source, literal }) => {
    const runtime = await scanRules([literal]);
    const bytes = makeRtf(source); const original = bytes.slice();
    try {
      expect(new TextDecoder().decode(bytes)).not.toContain(literal);
      const result = await runtime.scan({ ...request("", "rich-text", "rtf"), bytes });
      expect(result).toEqual([{ scope: "text", status: "blocked" }, { scope: "links", status: "blocked" }]);
      expect(bytes).toEqual(original);
      expect(JSON.stringify(result)).not.toContain(literal);
      expect(JSON.stringify(runtime.diagnostics())).not.toContain(literal);
    } finally { await runtime.dispose(); }
  });

  it("keeps body words joined across comment metadata", async () => {
    const runtime = await scanRules([SECRET]);
    const source = comment("annotation body").replace("prefix ", "pri").replace(" suffix}", "vate-text}");
    try {
      expect(await runtime.scan({ ...request("", "rich-text", "rtf"), bytes: makeRtf(source) }))
        .toEqual([{ scope: "text", status: "blocked" }, { scope: "links", status: "blocked" }]);
    } finally { await runtime.dispose(); }
  });

  it("keeps consecutive comments with distinct IDs complete in one body container", async () => {
    const runtime = await scanRules();
    const source = documentWith(
      annotationPart("first comment", "first-id", "Alice"),
      annotationPart("second comment", "second-id", "Bob"),
    );
    try {
      expect(await runtime.scan({ ...request("", "rich-text", "rtf"), bytes: makeRtf(source) })).toEqual(PASS);
    } finally { await runtime.dispose(); }
  });

  it("allows consecutive comments by the same author to reuse the author ID", async () => {
    const runtime = await scanRules();
    const source = documentWith(
      annotationPart("first comment", "shared-author-id", "Alice"),
      annotationPart("second comment", "shared-author-id", "Alice"),
    );
    try {
      expect(await runtime.scan({ ...request("", "rich-text", "rtf"), bytes: makeRtf(source) })).toEqual(PASS);
    } finally { await runtime.dispose(); }
  });

  it("still checks the first comment ID after a later distinct comment", async () => {
    const runtime = await scanRules([SECRET]);
    const source = documentWith(
      annotationPart("first comment", rtfHex(SECRET), "Alice"),
      annotationPart("second comment", "second-id", "Bob"),
    );
    try {
      expect(await runtime.scan({ ...request("", "rich-text", "rtf"), bytes: makeRtf(source) }))
        .toEqual([{ scope: "text", status: "blocked" }, { scope: "links", status: "blocked" }]);
    } finally { await runtime.dispose(); }
  });

  it("resolves an annotation parent to one completed author record", async () => {
    const runtime = await scanRules();
    const source = documentWith(
      annotationPart("parent comment", "parent-id", "Alice"),
      annotationPart("reply comment", "reply-id", "Bob", "1180187342", { parent: "parent-id" }),
    );
    try {
      expect(await runtime.scan({ ...request("", "rich-text", "rtf"), bytes: makeRtf(source) })).toEqual(PASS);
    } finally { await runtime.dispose(); }
  });

  it("accepts a same-author reply when its parent resolves to one other completed record", async () => {
    const runtime = await scanRules();
    const source = documentWith(
      annotationPart("first comment", "shared-author-id", "Alice"),
      annotationPart("reply comment", "shared-author-id", "Alice", "1180187342", { parent: "shared-author-id" }),
    );
    try {
      expect(await runtime.scan({ ...request("", "rich-text", "rtf"), bytes: makeRtf(source) })).toEqual(PASS);
    } finally { await runtime.dispose(); }
  });

  it("accepts a parent reference to a later comment in the same document", async () => {
    const runtime = await scanRules();
    const source = documentWith(
      annotationPart("reply before parent", "reply-id", "Alice", "1180187342", { parent: "later-parent-id" }),
      annotationPart("later parent comment", "later-parent-id", "Bob"),
    );
    try {
      expect(await runtime.scan({ ...request("", "rich-text", "rtf"), bytes: makeRtf(source) })).toEqual(PASS);
    } finally { await runtime.dispose(); }
  });

  it.each([
    comment("CJK \\u27979?\\u35797? safe"),
    comment("\\v hidden words \\v0 visible words"),
    comment("{\\upr{legacy safe}{\\*\\ud modern safe}}"),
    comment("\\'ef\\'f0\\'e8\\'e2\\'e5\\'f2").replace(
      "{\\rtf1\\ansi\\ansicpg1252\\uc1 ",
      "{\\rtf1\\ansi\\ansicpg1252\\uc1\\deff0{\\fonttbl{\\f0\\cpg1251 Cyrillic;}}\\f0 ",
    ),
  ])("scans supported nested text forms without altering the RTF bytes", async (source) => {
    const runtime = await scanRules();
    const bytes = makeRtf(source); const original = bytes.slice();
    try {
      expect(await runtime.scan({ ...request("", "rich-text", "rtf"), bytes })).toEqual(PASS);
      expect(bytes).toEqual(original);
    } finally { await runtime.dispose(); }
  });

  it("checks Unicode text hidden behind encoded legacy fallback bytes", async () => {
    const runtime = await scanRules([SECRET]);
    const source = rtf("{|rtf1|ansi|ansicpg1252|uc1 ") + Array.from(SECRET, (character) => {
      const unit = character.charCodeAt(0);
      const signed = unit > 32767 ? unit - 65536 : unit;
      return "\\u" + signed + "\\'" + unit.toString(16).padStart(2, "0");
    }).join("") + "}";
    try {
      expect(await runtime.scan({ ...request("", "rich-text", "rtf"), bytes: makeRtf(source) }))
        .toEqual([{ scope: "text", status: "blocked" }, { scope: "links", status: "blocked" }]);
    } finally { await runtime.dispose(); }
  });

  it.each([
    { codePage: 936, uc: 2, fallback: "\\'b2\\'e2" },
    { codePage: 65001, uc: 3, fallback: "\\'e6\\'b5\\'8b" },
  ])("blocks modern Unicode joined to following text after CP$codePage fallback bytes", async ({ codePage, uc, fallback }) => {
    const runtime = await scanRules(["你X"]);
    const source = rtf(`{|rtf1|ansi|ansicpg${codePage}|uc${uc}|u20320${fallback}X}`);
    const bytes = makeRtf(source);
    try {
      expect(new TextDecoder().decode(bytes)).not.toContain("你X");
      expect(await runtime.scan({ ...request("", "rich-text", "rtf"), bytes }))
        .toEqual([{ scope: "text", status: "blocked" }, { scope: "links", status: "blocked" }]);
    } finally { await runtime.dispose(); }
  });

  const malformedAnnotations = [
    { case: "missing author", source: comment("safe", "note-1", "Alice", "1180187342").replace("{\\*\\atnauthor Alice}", "") },
    { case: "duplicate atnid in one comment", source: comment().replace("{\\*\\atnid note-1}", "{\\*\\atnid first}{\\*\\atnid second}") },
    { case: "misordered author and ID", source: comment().replace("{\\*\\atnid note-1}{\\*\\atnauthor Alice}", "{\\*\\atnauthor Alice}{\\*\\atnid note-1}") },
    { case: "missing ID and author", source: comment().replace("{\\*\\atnid note-1}{\\*\\atnauthor Alice}", "") },
    { case: "annotation nested in footnote", source: rtf("{|rtf1|ansi|ansicpg1252|uc1 {|footnote foot {|*|atnid id}{|*|atnauthor Alice}|chatn{|*|annotation note}}}") },
    { case: "annotation nested in header", source: rtf("{|rtf1|ansi|ansicpg1252|uc1 {|header head {|*|atnid id}{|*|atnauthor Alice}|chatn{|*|annotation note}}}") },
    { case: "unknown parent", source: documentWith(annotationPart("orphan reply", "reply-id", "Alice", "1180187342", { parent: "unknown-id" })) },
    { case: "parent target has no other completed record", source: documentWith(annotationPart("self reply", "same-id", "Alice", "1180187342", { parent: "same-id" })) },
    {
      case: "parent target is ambiguous",
      source: documentWith(
      annotationPart("first author comment", "shared-id", "Alice"),
      annotationPart("second author comment", "shared-id", "Alice"),
      annotationPart("ambiguous reply", "reply-id", "Bob", "1180187342", { parent: "shared-id" }),
      ),
    },
    {
      case: "parent graph contains a cycle",
      source: documentWith(
      annotationPart("cycle member A", "cycle-a", "Alice", "1180187342", { parent: "cycle-b" }),
      annotationPart("cycle member B", "cycle-b", "Bob", "1180187342", { parent: "cycle-a" }),
      ),
    },
    { case: "nested ID does not leak into root metadata", source: rtf("{|rtf1|ansi|ansicpg1252|uc1 prefix {{|*|atnid nested-id}}{|*|atnauthor Alice}|chatn {|*|annotation{|*|atndate 1180187342}|pard|plain nested ID must not leak}} suffix}") },
    { case: "pending annotation crosses a paragraph", source: rtf("{|rtf1|ansi|ansicpg1252|uc1 prefix {|*|atnid pending-id}{|*|atnauthor Alice}|par|chatn {|*|annotation{|*|atndate 1180187342}|pard|plain body}} suffix}") },
    { case: "pending annotation crosses root body text", source: rtf("{|rtf1|ansi|ansicpg1252|uc1 prefix {|*|atnid pending-id}{|*|atnauthor Alice}intervening body text|chatn {|*|annotation{|*|atndate 1180187342}|pard|plain body}} suffix}") },
    { case: "invalid atndate", source: comment("safe", "note-1", "Alice", "not-a-date") },
    { case: "duplicate atndate", source: duplicateAtndateSource },
    { case: "month is out of range", source: documentWith(annotationPart("safe", "note-1", "Alice", "1180187342", { time: "|yr2026|mo13|dy27|hr12|min30|sec1" })) },
    { case: "day is invalid for month", source: documentWith(annotationPart("safe", "note-1", "Alice", "1180187342", { time: "|yr2026|mo2|dy30|hr12|min30|sec1" })) },
    { case: "duplicate hour field", source: documentWith(annotationPart("safe", "note-1", "Alice", "1180187342", { time: "|yr2026|mo10|dy27|hr12|hr13|min30|sec1" })) },
  ];

  it.each(malformedAnnotations)("does not pass malformed annotation: $case", async ({ source, case: caseName }) => {
    if (caseName === "duplicate atndate") {
      expect(source.split(ANNOTATION_DATE_DESTINATION)).toHaveLength(3);
    }
    const runtime = await scanRules();
    try {
      const checks = await runtime.scan({ ...request("", "rich-text", "rtf"), bytes: makeRtf(source) });
      expect(checks.some((check) => check.status === "not-scanned")).toBe(true);
    } finally { await runtime.dispose(); }
  });

  it("does not lose a definite match when the annotation structure is malformed", async () => {
    const runtime = await scanRules([SECRET]);
    expect(duplicateAtnidSecretSource.split("{\\*\\atnid")).toHaveLength(3);
    try {
      expect(await runtime.scan({ ...request("", "rich-text", "rtf"), bytes: makeRtf(duplicateAtnidSecretSource) }))
        .toEqual([{ scope: "text", status: "blocked" }, { scope: "links", status: "blocked" }]);
    } finally { await runtime.dispose(); }
  });

  it.each(["|yr2026", "|hr12", ""])("accepts standard optional annotation time fields %s", async (time) => {
    const runtime = await scanRules();
    const part = annotationPart("time-stamped comment", "timed-id", "Alice", "1180187342", {
      time,
    });
    try {
      expect(await runtime.scan({ ...request("", "rich-text", "rtf"), bytes: makeRtf(documentWith(part)) })).toEqual(PASS);
    } finally { await runtime.dispose(); }
  });

  it("keeps a safe plain representation when an unsupported annotation icon is not scanned", async () => {
    const runtime = await scanRules();
    const source = rtf("{|rtf1|ansi|ansicpg1252|uc1 {|*|atnid id}{|*|atnauthor Alice}|chatn{|*|annotation{|*|atnicn{|pict binary}}text}}}");
    try {
      const result = await evaluateCaptureContentPolicyV2(capture(makeRtf(source), true), {
        currentPolicyRevision: () => "policy-1", scan: runtime.scan,
      });
      expect(result.status).toBe("partial");
      if (result.status === "partial") expect(result.admittedRepresentations.map((row) => row.representationKey)).toEqual(["plain"]);
    } finally { await runtime.dispose(); }
  });
});
