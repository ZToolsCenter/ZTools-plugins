import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { createBrotliCompress, constants as zlibConstants } from "node:zlib";
import { createPackage } from "@electron/asar";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactRoot = path.join(root, "artifacts", "ztools");
const options = process.argv.slice(2);
if (options.length && (options.length !== 2 || options[0] !== "--out-dir")) {
  throw new Error(
    "Usage: pnpm build:ztools [--out-dir artifacts/ztools/<directory>]",
  );
}
const output = path.resolve(root, options[1] ?? "artifacts/ztools/Askills");
const zpxPath = output + ".zpx";
const relativeOutput = path.relative(artifactRoot, output);
if (
  !relativeOutput ||
  relativeOutput.startsWith("..") ||
  path.isAbsolute(relativeOutput)
) {
  throw new Error("Output must be a child directory of artifacts/ztools.");
}
if (process.platform !== "win32") {
  throw new Error(
    "The ZTools plugin currently targets Windows x64. Build it on Windows.",
  );
}
if (process.arch !== "x64")
  throw new Error("Build the ZTools helper with Windows x64 Node.js.");

async function assertPlainAncestors(directory) {
  let current = directory;
  while (current !== root) {
    const relative = path.relative(root, current);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Invalid output path.");
    const info = await lstat(current).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (info && (!info.isDirectory() || info.isSymbolicLink())) {
      throw new Error(
        `Build directory must not be a link or a file: ${current}`,
      );
    }
    current = path.dirname(current);
  }
}

await assertPlainAncestors(output);
const contents = await readdir(output).catch((error) => {
  if (error.code === "ENOENT") return [];
  throw error;
});
if (contents.length) {
  throw new Error(
    "Output directory is not empty. Choose another --out-dir to preserve the existing plugin.",
  );
}
if (
  await lstat(zpxPath).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  })
)
  throw new Error("The .zpx package already exists; choose another --out-dir.");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      shell: false,
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} failed (${code}).`));
    });
  });
}

async function pnpm(args) {
  // pnpm run supplies its real executable/JS entry. Using it directly avoids
  // invoking cmd.exe or interpolating project paths into a shell command.
  const executable = process.env.npm_execpath;
  if (executable && /\.[cm]?js$/i.test(executable)) {
    await run(process.execPath, [executable, ...args]);
  } else {
    await run(executable || "pnpm", args);
  }
}

const stagingRoot = path.join(root, ".askills");
await assertPlainAncestors(stagingRoot);
await mkdir(stagingRoot, { recursive: true });
const staging = await mkdtemp(path.join(stagingRoot, "ztools-build-"));
const frontend = path.join(staging, "frontend");
await pnpm(["exec", "tsc"]);
await pnpm(["exec", "vite", "build", "--mode", "ztools", "--outDir", frontend]);
await run("cargo", [
  "build",
  "--manifest-path",
  "src-tauri/Cargo.toml",
  "--locked",
  "--bin",
  "askills-ztools",
  "--release",
]);

const manifest = JSON.parse(
  await readFile(path.join(root, "ztools", "plugin.json"), "utf8"),
);
if (!/^\d+\.\d+\.\d+$/.test(manifest.version))
  throw new Error("The ZTools plugin version must use major.minor.patch.");
const helper = path.join(
  root,
  "src-tauri",
  "target",
  "release",
  "askills-ztools.exe",
);
const helperBytes = await readFile(helper);
if (helperBytes.readUInt16LE(0) !== 0x5a4d)
  throw new Error("Helper is not a Windows executable.");
const peOffset = helperBytes.readUInt32LE(0x3c);
if (
  helperBytes.readUInt32LE(peOffset) !== 0x4550 ||
  helperBytes.readUInt16LE(peOffset + 4) !== 0x8664
) {
  throw new Error("Helper must be a Windows x64 executable.");
}
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "form-action 'none'",
].join("; ");
const htmlPath = path.join(frontend, "index.html");
let html = await readFile(htmlPath, "utf8");
if (!html.includes("<head>"))
  throw new Error("Frontend is missing its HTML head.");
html = html.replace(
  "<head>",
  `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}">`,
);
await writeFile(htmlPath, html);

// Build everything successfully before creating the requested plugin directory.
// Refuse a target that became nonempty during a long Rust compilation.
await assertPlainAncestors(output);
await mkdir(output, { recursive: true });
if ((await readdir(output)).length)
  throw new Error("Output changed while building; choose another directory.");
for (const name of await readdir(frontend)) {
  await cp(path.join(frontend, name), path.join(output, name), {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
}
for (const name of ["preload.js", "bridge.cjs", "package.json"]) {
  await cp(path.join(root, "ztools", name), path.join(output, name), {
    force: false,
    errorOnExist: true,
  });
}
await writeFile(
  path.join(output, "plugin.json"),
  JSON.stringify(manifest, null, 2) + "\n",
  { flag: "wx" },
);
await cp(
  path.join(root, "src-tauri", "icons", "128x128.png"),
  path.join(output, "logo.png"),
  { force: false },
);
await mkdir(path.join(output, "helper"));
await cp(helper, path.join(output, "helper", "askills-ztools.exe"), {
  force: false,
});
await cp(path.join(root, "LICENSE"), path.join(output, "LICENSE.txt"), {
  force: false,
});
await mkdir(path.join(output, "licenses"));
await cp(
  path.join(root, "third-party", "fonts", "MiSans.LICENSE.txt"),
  path.join(output, "licenses", "MiSans.LICENSE.txt"),
  { force: false },
);
// ZTools' own packager stores a complete ASAR in Brotli (quality 5). The helper
// is included here; the host applies manifest.unpack during local installation.
const archivePath = path.join(staging, "Askills.asar");
await createPackage(output, archivePath);
await pipeline(
  createReadStream(archivePath),
  createBrotliCompress({ params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } }),
  createWriteStream(zpxPath, { flags: "wx" }),
);
console.log(`ZTools development plugin is ready: ${output}`);
console.log(
  `Import ${path.join(output, "plugin.json")} in the ZTools plugin developer view. Nothing has been published.`,
);
console.log(`Local installation package: ${zpxPath}`);
