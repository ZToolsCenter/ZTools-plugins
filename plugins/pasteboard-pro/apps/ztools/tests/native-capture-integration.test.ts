import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateCaptureContentPolicyV2 } from "@pasteboard-pro/core";
import { mapNativeCaptureWire } from "../preload/native-capture-adapter";
import { wireContext } from "./native-capture-wire-fixtures";
import { scanner } from "./content-scanner-v2-fixtures";
import { attestNativeFixture, nativeWireArtifacts, runNativeWireFixture } from "./native-capture-helper-fixture";

describe.skipIf(process.platform !== "darwin")("actual private AppKit capture -> native wire -> V2 gate", () => {
  const observations: Array<{ name: string; status: "PASS" }> = [];
  let attestation: Awaited<ReturnType<typeof attestNativeFixture>>;
  let wire: Buffer;
  beforeAll(async () => {
    attestation = await attestNativeFixture();
    const result = await runNativeWireFixture(true);
    expect(result.code).toBe(0); expect(result.stderr).toBe("");
    expect(result.exitConfirmed && result.streamsClosed).toBe(true);
    wire = result.stdout;
  });
  afterAll(async () => {
    if (!wire || !attestation) return;
    await writeFile(path.join(nativeWireArtifacts, process.versions.electron
      ? "v019-electron-native-ingress.json" : "v019-node-native-ingress.json"), JSON.stringify({
      execution: observations.length === 5 ? "PASS" : "FAIL", scope: "synthetic-private-named-pasteboard-only",
      runtime: { node: process.versions.node, electron: process.versions.electron ?? null },
      attestation, wireSha256: createHash("sha256").update(wire).digest("hex"), wireBytes: wire.length,
      cases: observations, exitConfirmed: true, streamsClosed: true, productionWiring: false,
    }, null, 2) + "\n");
  });
  it("refuses the fixed wire mode before any board access without supervision", async () => {
    const result = await runNativeWireFixture(false);
    expect(result.code).toBe(2); expect(result.stdout.length).toBe(0);
    expect(result.stderr).toBe("supervision-required\n");
    observations.push({ name: "unsupervised-no-payload", status: "PASS" });
  });
  it("maps actual native owned bytes and keeps every unavailable row", () => {
    const result = mapNativeCaptureWire(wire, wireContext());
    const names = result.identities.map((row) => row.nativeName);
    expect(names).toContain("public.utf8-plain-text");
    expect(names).toContain("public.html"); expect(names).toContain("public.rtf");
    expect(result.input.representations.some((row) => row.state === "unavailable")).toBe(true);
    expect(result.input.representations.some((row) => row.itemIndex > 0)).toBe(true);
    expect(result.input.preflight.captureAllowed).toBe(true);
    expect(result.input.preflight.capturedRevision).toBe(result.input.capturedRevision);
    expect(result.identities).toHaveLength(result.input.representations.length);
    observations.push({ name: "actual-native-bytes-and-complete-inventory", status: "PASS" });
  });
  it("runs actual HTML/plaintext/RTF workers with original bytes", async () => {
    const mapped = mapNativeCaptureWire(wire, wireContext());
    const runtime = await scanner({ codecs: mapped.codecs,
      policy: { revision: wireContext().policy.revision, blockLikelySecrets: true, contentRules: [] } });
    try {
      const result = await evaluateCaptureContentPolicyV2(mapped.input, {
        currentPolicyRevision: () => wireContext().policy.revision, scan: runtime.scan,
      });
      expect(result.status).toBe("partial");
      if (result.status !== "partial") throw new Error("native-fixture-unexpected-gate-status");
      const htmlKey = mapped.identities.find((row) => row.nativeName === "public.html")!.representationKey;
      const rtfKey = mapped.identities.find((row) => row.nativeName === "public.rtf")!.representationKey;
      expect(result.admittedRepresentations.some((row) => row.representationKey === htmlKey)).toBe(true);
      expect(result.admittedRepresentations.some((row) => row.representationKey === rtfKey)).toBe(true);
      expect(result.receipt.permissions).toEqual({ preview: false, paste: false, sync: false });
      observations.push({ name: "native-html-and-rtf-worker-admission", status: "PASS" });
    } finally { await runtime.dispose(); }
  });
  it("rejects the entire actual native copy if an allowed scope matches", async () => {
    const mapped = mapNativeCaptureWire(wire, wireContext());
    const runtime = await scanner({ codecs: mapped.codecs,
      policy: { revision: wireContext().policy.revision, blockLikelySecrets: false,
        contentRules: [{ type: "literal", value: "wire fixture hello" }] } });
    try {
      const result = await evaluateCaptureContentPolicyV2(mapped.input, {
        currentPolicyRevision: () => wireContext().policy.revision, scan: runtime.scan,
      });
      expect(result.status).toBe("denied");
      if (result.status === "denied") expect(result.reasonCode).toBe("content-match");
      expect("admittedRepresentations" in result).toBe(false); expect("receipt" in result).toBe(false);
      observations.push({ name: "native-copy-whole-copy-match-denial", status: "PASS" });
    } finally { await runtime.dispose(); }
  });
  it("rejects stale policy after mapping rather than storing the native payload", async () => {
    const mapped = mapNativeCaptureWire(wire, wireContext());
    const result = await evaluateCaptureContentPolicyV2(mapped.input, {
      currentPolicyRevision: () => "new-policy", scan: async () => { throw new Error("must-not-scan"); },
    });
    expect(result.status).toBe("policy-changed");
    observations.push({ name: "native-mapping-policy-revocation", status: "PASS" });
  });
});
