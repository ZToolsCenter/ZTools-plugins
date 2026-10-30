import { fileURLToPath } from "node:url";
import { parseStorageArguments, runStorageFoundation } from "./lib/windows-storage-probe.mjs";

try {
  const request = parseStorageArguments(process.argv.slice(2));
  const receipt = await runStorageFoundation(fileURLToPath(new URL("../", import.meta.url)), request);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  process.exitCode = request.mode === "describe" && !receipt.errorCode || receipt.execution === "PASS" ? 0 : 1;
} catch {
  process.stderr.write("Usage: node scripts/clipboard-storage-g1.mjs --describe | --self-test --binary artifacts/pasteboardpro/windows-storage-foundation/<build>/windows-storage-foundation.exe --expected-binary-sha256 <sha256>\n");
  process.exitCode = 2;
}
