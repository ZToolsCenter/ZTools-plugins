import { createServer } from "node:http";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { evaluateCaptureContentPolicyV2 } from "@pasteboard-pro/core";
import { codec, request, scanner } from "./content-scanner-v2-fixtures";

function htmlCodec() {
  return { ...codec("html", "rich-text"), richTextFormat: "html" as const, encoding: "utf-8" as const, termination: "none" as const };
}
async function htmlScanner(literal = "private-text") {
  return scanner({ codecs: [htmlCodec()], policy: {
    revision: "policy-1", blockLikelySecrets: true, contentRules: [{ type: "literal", value: literal }],
  } });
}
function htmlRequest(html: string) { return request(html, "rich-text", "html"); }
const passed = [{ scope: "text", status: "passed" }, { scope: "links", status: "passed" }];

describe("offline HTML Worker privacy projection", () => {
  it.each([
    "<p>Hello <b>world</b></p>",
    '<html><head><meta charset="utf-8"></head><body><!--StartFragment--><p style="font-weight:700;color:rgb(1,2,3)">Hello <span>world</span></p><!--EndFragment--></body></html>',
    '<table><tr><td>row 1</td><td><a href="https://example.invalid/clean">value</a></td></tr></table>',
  ])("accepts complete common formatted HTML without altering raw bytes %#", async (html) => {
    const runtime = await htmlScanner(); const input = htmlRequest(html); const original = input.bytes.slice();
    try { expect(await runtime.scan(input)).toEqual(passed); expect(input.bytes).toEqual(original); }
    finally { await runtime.dispose(); }
  });

  it.each([
    "<p>pri<b>vate</b>-text</p>",
    "<p>pri&#118;ate-text</p>",
    '<p data-token="private&#x2d;text">public</p>',
    '<meta property="og:image" content="https://example.invalid/%70rivate-text"><p>public</p>',
    '<meta name="twitter:image" content="https://example.invalid/private%2Dtext"><p>public</p>',
    '<meta itemprop="sameAs" content="https://example.invalid/%70rivate-text"><p>public</p>',
    '<p data-token="private%2Dtext">public</p>',
    '<div hidden style="display:none">private-text</div><p>public</p>',
    "<template><span>private-text</span></template><p>public</p>",
    "<template>pri<b>vate</b>-text</template><p>public</p>",
    "<!-- private-text --><p>public</p>",
    "<noscript><b>private-text</b></noscript><p>public</p>",
    '<span data-token="safe" data-token="pri&#118;ate-text">public</span>',
    String.raw`<p style='font-family:"pri\76 ate-text"'>public</p>`,
    '<p style="font-family:pri/**/vate-text">public</p>',
  ])("detects split, encoded or non-visible payload content %#", async (html) => {
    const runtime = await htmlScanner();
    try {
      const result = await runtime.scan(htmlRequest(html));
      expect(result.some((check) => check.status === "blocked")).toBe(true);
      expect(JSON.stringify(result)).not.toContain("private-text");
      expect(JSON.stringify(runtime.diagnostics())).not.toContain("private-text");
    } finally { await runtime.dispose(); }
  });

  it("joins inline token fragments for likely-secret inspection", async () => {
    const runtime = await htmlScanner();
    try {
      const result = await runtime.scan(htmlRequest("<p><span>Bea</span><b>rer</b> abcdefghijklmnopqrstuvwxyz012345</p>"));
      expect(result).toContainEqual({ scope: "text", status: "blocked" });
    } finally { await runtime.dispose(); }
  });

  it("checks entity- and percent-decoded links without requesting resources", async () => {
    const runtime = await htmlScanner();
    try {
      const result = await runtime.scan(htmlRequest('<a href="https://example.invalid/?q=private%2Dtext&amp;a=1">public</a>'));
      expect(result).toContainEqual({ scope: "links", status: "blocked" });
    } finally { await runtime.dispose(); }
  });

  it.each([
    '<p data-token="one" data-token="two">safe</p>',
    '<script>throw new Error("script-must-not-execute")</script><p>safe</p>',
    '<p onclick="return 1">safe</p>',
    '<iframe srcdoc="&lt;p&gt;safe&lt;/p&gt;"></iframe>',
    '<link rel="alternate StyleSheet" href="https://example.invalid/theme.css"><p>safe</p>',
    '<style>@import "https://example.invalid/theme.css";</style><p>safe</p>',
    '<style>p:before{content:"pri" "vate-text"}</style><p>safe</p>',
    '<svg><text>safe</text></svg>',
    '<p style="background-image:url(https://example.invalid/image.png)">safe</p>',
    '<style>p{background:url(data:image/png;base64,aGVsbG8=)}</style><p>safe</p>',
  ])("does not claim complete text inspection for unsupported or ambiguous content %#", async (html) => {
    const runtime = await htmlScanner();
    try { const result = await runtime.scan(htmlRequest(html)); expect(result.find((check) => check.scope === "text")?.status).not.toBe("passed"); }
    finally { await runtime.dispose(); }
  });

  it("keeps a known match blocked even when the document cannot be fully projected", async () => {
    const runtime = await htmlScanner();
    try { expect((await runtime.scan(htmlRequest('<script>"private-text"</script>'))).some((check) => check.status === "blocked")).toBe(true); }
    finally { await runtime.dispose(); }
  });

  it.each([
    "<div>".repeat(129) + "safe" + "</div>".repeat(129),
    "<span>x</span>".repeat(10001),
  ])("does not truncate a depth/node budget overflow and mark it passed %#", async (html) => {
    const runtime = await htmlScanner();
    try { const result = await runtime.scan(htmlRequest(html)); expect(result.some((check) => check.status === "not-scanned")).toBe(true); }
    finally { await runtime.dispose(); }
  });

  it("does not fetch embedded image data and marks unavailable binary inspection", async () => {
    let hits = 0;
    const server = createServer((_req, res) => { hits++; res.end("private-text"); });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address(); if (!address || typeof address === "string") throw new Error("No server address");
    const runtime = await htmlScanner();
    try {
      const result = await runtime.scan(htmlRequest(`<img src="http://127.0.0.1:${address.port}/image"><p>public</p>`));
      expect(result.some((check) => check.status === "not-scanned")).toBe(true);
      expect(hits).toBe(0);
    } finally { await runtime.dispose(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it("rejects whole-copy admission when a real HTML projection finds a hidden match", async () => {
    const runtime = await scanner({ codecs: [codec("plain"), htmlCodec()], policy: {
      revision: "policy-1", blockLikelySecrets: true, contentRules: [{ type: "literal", value: "private-text" }],
    } });
    const input = {
      attemptId: "attempt-1", snapshotId: "snapshot-1", manifestRevision: "manifest-1", receiptId: "receipt-1", capturedRevision: "41", observedRevision: "43",
      policy: { revision: "policy-1", contentRulesEnabled: true, requireFileBodyScan: false },
      preflight: { capturedRevision: "41", policyRevision: "policy-1", captureAllowed: true, localHistoryAllowed: true, cloudUploadAllowed: false },
      representations: [{ representationKey: "plain", itemIndex: 0, state: "captured", contentKind: "text", bytes: request().bytes },
        { representationKey: "html", itemIndex: 0, state: "captured", contentKind: "rich-text", bytes: htmlRequest("<p>pri<b>vate</b>-text</p>").bytes }],
    };
    try {
      expect(await evaluateCaptureContentPolicyV2(input, { currentPolicyRevision: () => "policy-1", scan: runtime.scan })).toEqual({ status: "denied", attemptId: "attempt-1", outcomeCode: "policy-denied", reasonCode: "content-match" });
    } finally { await runtime.dispose(); }
  });

  it("uses the dedicated RTF worker instead of interpreting RTF bytes as HTML", async () => {
    const runtime = await scanner({ codecs: [{ ...codec("html", "rich-text"), richTextFormat: "rtf" as const }] });
    try { expect(await runtime.scan(htmlRequest("{\\rtf1 safe}"))).toEqual([{ scope: "text", status: "passed" }, { scope: "links", status: "passed" }]); expect(runtime.diagnostics().started).toBe(1); }
    finally { await runtime.dispose(); }
  });
});
