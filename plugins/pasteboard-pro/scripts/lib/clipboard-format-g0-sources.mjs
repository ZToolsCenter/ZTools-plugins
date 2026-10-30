import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createG0Receipt } from "./clipboard-format-g0-report.mjs";

const digest = data => createHash("sha256").update(data).digest("hex");
const runnerSources = Object.freeze([
  "scripts/clipboard-format-g0.mjs", "scripts/lib/clipboard-format-g0-report.mjs",
  "scripts/lib/clipboard-format-g0-cases.mjs", "scripts/lib/clipboard-format-g0-sources.mjs",
  "scripts/lib/bounded-process.mjs", "scripts/lib/process-rss.mjs",
  "scripts/lib/clipboard-format-g0-windows-receipts.mjs",
]);

export async function collectG0Sources(root, platform) {
  if (!["darwin", "win32"].includes(platform)) throw new TypeError("Unsupported source platform");
  const directory = path.join(root, "native/clipboard-format", platform === "darwin" ? "macos" : "windows");
  const sources = await listSources(directory, 96);
  const files = sources.map(source => path.relative(root, path.join(directory, source)).replaceAll(path.sep, "/"));
  if (platform === "win32") {
    const common = path.join(root, "native/clipboard-format/common");
    for (const source of await listSources(common, 48)) {
      files.push(path.relative(root, path.join(common, source)).replaceAll(path.sep, "/"));
    }
  } else {
    files.push("native/clipboard-format/common/clipboard_uri_syntax.cpp",
      "native/clipboard-format/common/clipboard_uri_syntax.h",
      "native/clipboard-format/common/clipboard_rtf.cpp", "native/clipboard-format/common/clipboard_rtf.h",
      "native/clipboard-format/common/clipboard_capture_wire.cpp", "native/clipboard-format/common/clipboard_capture_wire.h",
      "native/clipboard-format/common/clipboard_sha256.cpp", "native/clipboard-format/common/clipboard_sha256.h",
      "native/clipboard-format/common/clipboard_capture_codec.cpp", "native/clipboard-format/common/clipboard_capture_codec.h");
  }
  files.push(...runnerSources);
  const sourceHashes = {};
  for (const source of files.sort()) sourceHashes[source] = digest(await readFile(path.join(root, source)));
  return { directory, sources, sourceHashes };
}

async function listSources(directory, maximum) {
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries.filter(entry => entry.isFile() &&
    (entry.name === "CMakeLists.txt" || /\.(?:h|hpp|cpp|mm)$/u.test(entry.name))).map(entry => entry.name).sort();
  if (names.length === 0 || names.length > maximum) throw new TypeError("Invalid bounded native source set");
  return names;
}

export async function verifyBuiltProbe(root, { platform, architecture, receiptBytes, binary, binaryBytes }) {
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  if (receipt.schemaVersion !== 1 || receipt.stage !== "G0" || receipt.platform !== platform ||
      receipt.architecture !== architecture || receipt.execution !== "PASS" || receipt.gateComplete !== false ||
      receipt.errorCode !== undefined) throw new TypeError("Receipt is not a matching successful G0 build");
  createG0Receipt(receipt); // Revalidate the native case set, resource observations and runtime fingerprint.
  if (receipt.binarySha256 !== digest(binaryBytes) || receipt.commands.at(-1).command !== binary) {
    throw new TypeError("Binary does not match its successful build receipt");
  }
  const { sourceHashes } = await collectG0Sources(root, platform);
  const expected = Object.keys(sourceHashes).sort();
  const actual = Object.keys(receipt.sourceHashes).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected) ||
      expected.some(source => receipt.sourceHashes[source] !== sourceHashes[source])) {
    throw new TypeError("Receipt source inventory is stale or incomplete");
  }
  return { receipt, receiptSha256: digest(receiptBytes), binarySha256: digest(binaryBytes) };
}
