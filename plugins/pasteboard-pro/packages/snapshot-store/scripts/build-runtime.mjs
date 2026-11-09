import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "vite";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(packageRoot, "../..");
const entry = {
  index: path.join(packageRoot, "src/index.ts"),
  "g3-verification-budget": path.join(packageRoot, "src/g3-verification-budget/index.ts"),
};
const coreEntry = path.resolve(root, "packages/core/src/index.ts");

await build({
  configFile: false,
  root: packageRoot,
  logLevel: "warn",
  resolve: { alias: [{ find: "@pasteboard-pro/core", replacement: coreEntry }] },
  build: {
    lib: { entry, formats: ["es"], fileName: (_format, name) => `${name}.mjs` },
    outDir: path.join(packageRoot, "dist/runtime"),
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    target: "node20.19",
    rollupOptions: {
      external: (id) => id.startsWith("node:") || id === "lmdb" || id === "zod",
    },
  },
});

const tsc = path.resolve(root, "node_modules/typescript/bin/tsc");
const result = spawnSync(process.execPath, [tsc, "--build", path.join(packageRoot, "tsconfig.json"), "--pretty", "false"], {
  cwd: root,
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
