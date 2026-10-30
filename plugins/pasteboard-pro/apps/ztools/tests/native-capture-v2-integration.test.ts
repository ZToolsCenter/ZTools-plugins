import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateCaptureContentPolicyV2 } from "@pasteboard-pro/core";
import { mapNativeCaptureWire } from "../preload/native-capture-adapter";
import { scanner } from "./content-scanner-v2-fixtures";
import { wireContext } from "./native-capture-wire-fixtures";
import { attestNativeFixture, nativeWireArtifacts, runNativeWireFixture } from "./native-capture-helper-fixture";

describe.skipIf(process.platform !== "darwin")("actual AppKit codec evidence reaches Node admission", () => {
  let source: Awaited<ReturnType<typeof attestNativeFixture>>;
  const observations: Array<Record<string, unknown>> = [];
  beforeAll(async () => { source = await attestNativeFixture(); });
  afterAll(async () => {
    if (!source) return;
    await writeFile(path.join(nativeWireArtifacts, process.versions.electron
      ? "v019-electron-codec-ingress.json" : "v019-node-codec-ingress.json"), JSON.stringify({
      execution: observations.length === 6 ? "PASS" : "FAIL", scope: "synthetic-private-AppKit-codec-evidence-only",
      runtime: { node: process.versions.node, electron: process.versions.electron ?? null }, source,
      cases: observations, rawPersisted: false, productionWiring: false,
    }, null, 2) + "\n");
  });
  it.each([
    ["--capture-wire-nul-content-fixture", false, false, "utf-16le"],
    ["--capture-wire-terminated-fixture", true, false, "utf-16le"],
    ["--capture-wire-bomless-be-fixture", true, false, "utf-16be"],
  ] as const)("validates actual native analyzer output from %s", async (mode, terminated, bom, encoding) => {
    const result = await runNativeWireFixture(true, mode);
    expect(result.code).toBe(0); expect(result.stderr).toBe("");
    const mapped = mapNativeCaptureWire(result.stdout, wireContext());
    expect(mapped.metadata.schemaVersion).toBe(2);
    const alias = mapped.identities.find((row) => row.nativeName === "public.utf16-external-plain-text")!;
    expect(alias.nativeCodec?.text).toMatchObject({ nullTerminated: terminated, byteOrderMark: bom,
      encodingCheck: "decoded-text-matches", encoding });
    const runtime = await scanner({ codecs: mapped.codecs,
      policy: { revision: wireContext().policy.revision, blockLikelySecrets: false, contentRules: [] } });
    try {
      const gate = await evaluateCaptureContentPolicyV2(mapped.input, {
        currentPolicyRevision: () => wireContext().policy.revision, scan: runtime.scan,
      });
      if (terminated) {
        expect(gate.status === "eligible" || gate.status === "partial").toBe(true);
        if (gate.status !== "eligible" && gate.status !== "partial") throw new Error("native-evidence-not-admitted");
        expect(gate.admittedRepresentations.some((row) => row.representationKey === alias.representationKey)).toBe(true);
      } else {
        expect(gate.status).toBe("denied");
        expect(mapped.codecs.some((row) => row.representationKey === alias.representationKey)).toBe(false);
      }
      observations.push({ mode, status: "PASS", nativeCodec: alias.nativeCodec,
        wireSha256: createHash("sha256").update(result.stdout).digest("hex"), exitConfirmed: result.exitConfirmed,
        streamsClosed: result.streamsClosed, gateStatus: gate.status });
    } finally { await runtime.dispose(); }
  });
  it.each(["--capture-wire-nul-content-fixture", "--capture-wire-terminated-fixture", "--capture-wire-bomless-be-fixture"] as const)("requires supervision for %s", async (mode) => {
    const result = await runNativeWireFixture(false, mode);
    expect(result.code).toBe(2); expect(result.stdout.length).toBe(0);
    expect(result.stderr).toBe("supervision-required\n");
    observations.push({ mode, status: "PASS", supervisionRequired: true, exitConfirmed: result.exitConfirmed, streamsClosed: result.streamsClosed });
  });

});
