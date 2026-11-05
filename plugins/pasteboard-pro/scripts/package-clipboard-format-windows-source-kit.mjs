import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeWindowsSourceKit } from "./lib/windows-source-kit.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(scriptPath), "..");

function parseArguments(args) {
  const options = { root: pluginRoot, outputDirectory: undefined };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (!["--root", "--output-dir"].includes(argument)) throw new TypeError(`Unknown argument: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new TypeError(`Missing value for ${argument}`);
    index += 1;
    if (argument === "--root") options.root = path.resolve(value);
    else options.outputDirectory = value;
  }
  if (options.outputDirectory) options.outputDirectory = path.resolve(options.root, options.outputDirectory);
  return options;
}

async function main(args) {
  const options = parseArguments(args);
  if (options.help) {
    process.stdout.write("Usage: node scripts/package-clipboard-format-windows-source-kit.mjs [--root <plugin-root>] [--output-dir <plugin-root/artifacts/path>]\n");
    return;
  }
  const result = await writeWindowsSourceKit(options.root, options.outputDirectory);
  process.stdout.write(`${JSON.stringify(result.receipt, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === scriptPath) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
