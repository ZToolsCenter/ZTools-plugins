import { createServer } from "node:http";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { scanner, request } from "./content-scanner-v2-fixtures";
import { cfHtml, replaceCfOffset } from "./cf-html-fixtures";

async function cfScanner() {
  return scanner({ policy: { revision: "policy-1", blockLikelySecrets: true,
    contentRules: [{ type: "literal", value: "private-text" }] }, codecs: [{
      representationKey: "html", contentKind: "rich-text", richTextFormat: "html",
      htmlContainer: "cf-html", encoding: "utf-8", termination: "none",
    }] });
}
function cfRequest(bytes: Uint8Array) { return { ...request("", "rich-text", "html"), bytes }; }
const complete = [{ scope: "text", status: "passed" }, { scope: "links", status: "passed" }];

describe("offline byte-offset CF_HTML container scanning", () => {
  it.each([
    cfHtml(), cfHtml("<b>中文🙂</b>"), cfHtml("<b>hello</b>", { newline: "\n" }),
    cfHtml("<b>hello</b>", { newline: "\r" }), cfHtml("<b>hello</b>", { context: false }),
    cfHtml("<b>hello</b>", { selection: true, sourceUrl: "https://example.invalid/clean" }),
  ])("scans a valid UTF-8 container while preserving every original byte %#", async (bytes) => {
    const runtime = await cfScanner(); const original = bytes.slice();
    try { expect(await runtime.scan(cfRequest(bytes))).toEqual(complete); expect(bytes).toEqual(original); }
    finally { await runtime.dispose(); }
  });
  it.each([
    cfHtml("<span>pri<b>vate</b>-text</span>"),
    cfHtml("<b>public</b>", { before: '<div hidden>pri<b>vate</b>-text</div>' }),
    cfHtml("<b>public</b>", { after: '<span data-token="private&#45;text">public</span>' }),
    cfHtml("<b>public</b>", { sourceUrl: "https://example.invalid/private%2Dtext" }),
    cfHtml("<b>public</b>", { sourceUrl: "https://example.invalid/%2570rivate-text" }),
    cfHtml("<b>public</b>", { extraHeader: [["X-Token", "private%2Dtext"]] }),
  ])("finds matches in fragment, hidden context and encoded header metadata %#", async (bytes) => {
    const runtime = await cfScanner();
    try { expect((await runtime.scan(cfRequest(bytes))).some((check) => check.status === "blocked")).toBe(true); }
    finally { await runtime.dispose(); }
  });
  it.each([
    cfHtml("<b>hello</b>", { duplicate: "StartHTML" }),
    replaceCfOffset(cfHtml(), "EndHTML", "9999999999"),
    replaceCfOffset(cfHtml(), "StartFragment", "-1"),
    replaceCfOffset(cfHtml(), "StartHTML", "0000000000garbage"),
    replaceCfOffset(cfHtml(), "EndHTML", "18446744073709551616"),
    replaceCfOffset(cfHtml(), "StartHTML", "        -1"),
    Buffer.concat([cfHtml(), Buffer.from("unexplained-tail")]),
    Buffer.from(cfHtml().toString("utf8").replace("Version:1.0", "Version:9.0")),
    Buffer.from(cfHtml().toString("utf8").replace("<!--EndFragment-->", "<!--EndFragment-!>")),
  ])("never marks malformed or ambiguous container offsets complete %#", async (bytes) => {
    const runtime = await cfScanner();
    try { const checks = await runtime.scan(cfRequest(bytes)); expect(checks.every((check) => check.status !== "passed")).toBe(true); }
    finally { await runtime.dispose(); }
  });
  it("does not accept byte offsets in the middle of a UTF-8 scalar", async () => {
    const bytes = cfHtml("中文"); const text = bytes.toString("utf8");
    const start = Number(/StartFragment:([0-9]+)/.exec(text)![1]);
    const bad = replaceCfOffset(bytes, "StartFragment", String(start + 1).padStart(10, "0"));
    const runtime = await cfScanner();
    try { expect((await runtime.scan(cfRequest(bad))).every((check) => check.status !== "passed")).toBe(true); }
    finally { await runtime.dispose(); }
  });
  it("keeps a raw known match blocked even when container validation fails", async () => {
    const bytes = replaceCfOffset(cfHtml("private-text"), "EndHTML", "9999999999");
    const runtime = await cfScanner();
    try { expect((await runtime.scan(cfRequest(bytes))).some((check) => check.status === "blocked")).toBe(true); }
    finally { await runtime.dispose(); }
  });
  it("never resolves SourceURL or external body resources", async () => {
    let hits = 0; const server = createServer((_req, res) => { hits++; res.end("private-text"); });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address(); if (!address || typeof address === "string") throw new Error("no-server-address");
    const url = `http://127.0.0.1:${address.port}/resource`;
    const runtime = await cfScanner();
    try {
      const checks = await runtime.scan(cfRequest(cfHtml(`<img src="${url}">`, { sourceUrl: url })));
      expect(checks.some((check) => check.status === "not-scanned")).toBe(true); expect(hits).toBe(0);
    } finally { await runtime.dispose(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
  it.each([122, 123])("counts a blank separator in the 128 header-line bound: extra fields %s", async (count) => {
    const extraHeader = Array.from({ length: count }, (_, n): [string, string] => [`X-${n}`, "safe"]);
    const bytes = cfHtml("<b>hello</b>", { extraHeader, blankSeparator: true });
    const runtime = await cfScanner();
    try { const result = await runtime.scan(cfRequest(bytes));
      expect(result.every((check) => check.status === "passed")).toBe(count === 122);
    } finally { await runtime.dispose(); }
  });

});
