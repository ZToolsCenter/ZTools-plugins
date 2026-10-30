import { createHash } from "node:crypto";
import { wireFrame, wireMetadata } from "./native-capture-wire-fixtures";
export type NativeCodecFixture = {
  encoding: string; materialization: string; validationCodePage?: number;
  text?: { encoding: "utf-16le" | "utf-16be"; byteOrderMark: boolean;
    nullTerminated: boolean; encodingCheck: "decoded-text-matches" | "canonical-unicode-equivalent" };
};
export type NativeRowFixture = { nativeName: string; bytes: Uint8Array; nativeCodec: NativeCodecFixture;
  itemIndex?: number; derivedFrom?: string; fidelity?: "exact" | "compatible" | "reference" };
export const macCodec = (encoding: string): NativeCodecFixture => ({ encoding, materialization: "owned-pasteboard-data" });
export const windowsCodec = (encoding: string): NativeCodecFixture => ({ encoding, materialization: "current-clipboard-format-bytes" });
export function wireV2(rows: NativeRowFixture[], platform: "macos" | "windows" = "macos") {
  let offset = 0;
  const metadata = wireMetadata(rows.map((row) => {
    const result = { itemIndex: row.itemIndex ?? 0, nativeName: row.nativeName, state: "captured", offset,
      byteLength: row.bytes.byteLength, sha256: createHash("sha256").update(row.bytes).digest("hex"),
      fidelity: row.fidelity ?? "exact", ...(row.derivedFrom ? { derivedFrom: row.derivedFrom } : {}), nativeCodec: row.nativeCodec };
    offset += row.bytes.byteLength; return result;
  }));
  metadata.schemaVersion = 2; metadata.platform = platform;
  const frame = wireFrame(metadata, Buffer.concat(rows.map((row) => Buffer.from(row.bytes))));
  frame.write("PBCAP02\n", 0, "ascii"); return frame;
}
export function utf16Pair(source = "hello", options: {
  body?: string; encoding?: "utf-16le" | "utf-16be"; bom?: boolean; terminated?: boolean;
  check?: "decoded-text-matches" | "canonical-unicode-equivalent"; sourceBom?: boolean;
} = {}): NativeRowFixture[] {
  const encoding = options.encoding ?? "utf-16le"; const bom = options.bom ?? true;
  const terminated = options.terminated ?? true;
  let payload = Buffer.from((options.body ?? source) + (terminated ? "\0" : ""), "utf16le");
  if (encoding === "utf-16be") payload = Buffer.from(payload).swap16();
  const utf16 = Buffer.concat([bom ? Buffer.from(encoding === "utf-16le" ? [0xff, 0xfe] : [0xfe, 0xff]) : Buffer.alloc(0), payload]);
  const codec = macCodec("utf16-external-bytes"); codec.text = { encoding, byteOrderMark: bom,
    nullTerminated: terminated, encodingCheck: options.check ?? "decoded-text-matches" };
  return [{ nativeName: "public.utf8-plain-text", bytes: Buffer.concat([options.sourceBom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(source)]), nativeCodec: macCodec("utf-8") },
    { nativeName: "public.utf16-external-plain-text", bytes: utf16, nativeCodec: codec,
      derivedFrom: "public.utf8-plain-text", fidelity: "compatible" }];
}
