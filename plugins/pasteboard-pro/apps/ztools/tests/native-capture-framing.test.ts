import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { evaluateCaptureContentPolicyV2 } from "@pasteboard-pro/core";
import { mapNativeCaptureWireV1 } from "../preload/native-capture-adapter";
import { wireContext, wireFrame, wireMetadata } from "./native-capture-wire-fixtures";
import { scanner } from "./content-scanner-v2-fixtures";

function nulEndingCopy() {
  const utf8 = Buffer.from("hello\0", "utf8");
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("hello\0", "utf16le")]);
  const metadata = wireMetadata([
    { itemIndex: 0, nativeName: "public.utf8-plain-text", state: "captured", offset: 0,
      byteLength: utf8.length, sha256: createHash("sha256").update(utf8).digest("hex"), fidelity: "exact" },
    { itemIndex: 0, nativeName: "public.utf16-external-plain-text", state: "captured", offset: utf8.length,
      byteLength: utf16.length, sha256: createHash("sha256").update(utf16).digest("hex"),
      fidelity: "compatible", derivedFrom: "public.utf8-plain-text" },
  ]);
  return mapNativeCaptureWireV1(wireFrame(metadata, Buffer.concat([utf8, utf16])), wireContext());
}

describe("native external UTF-16 needs proved termination semantics", () => {
  it("does not invent a terminator from the last zero code unit", () => {
    const mapped = nulEndingCopy();
    const key = mapped.identities.find((row) => row.nativeName === "public.utf16-external-plain-text")!.representationKey;
    expect(mapped.codecs.find((codec) => codec.representationKey === key)?.termination).toBe("none");
  });
  it("does not admit an alias after stripping content that the native protocol did not identify as a terminator", async () => {
    const mapped = nulEndingCopy();
    const runtime = await scanner({ codecs: mapped.codecs,
      policy: { revision: wireContext().policy.revision, blockLikelySecrets: false,
        contentRules: [{ type: "literal", value: "\0" }] } });
    try {
      const result = await evaluateCaptureContentPolicyV2(mapped.input, {
        currentPolicyRevision: () => wireContext().policy.revision, scan: runtime.scan,
      });
      expect(result.status).toBe("denied");
      expect("admittedRepresentations" in result).toBe(false);
    } finally { await runtime.dispose(); }
  });
});
