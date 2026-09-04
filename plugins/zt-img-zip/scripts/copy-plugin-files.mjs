import { execFileSync } from "node:child_process";
import { cpSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();
const dist = resolve(root, "dist");
const preloadDist = resolve(dist, "preload");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const npmCache = process.env.npm_config_cache || resolve(root, ".npm-cache");
const bundledSharpTargets = [
  { os: "darwin", cpu: "x64" },
  { os: "darwin", cpu: "arm64" },
  { os: "win32", cpu: "x64" },
];

for (const file of ["preload.cjs", "logo.png"]) {
  copyFileSync(resolve(root, file), resolve(dist, file));
}

cpSync(resolve(root, "preload"), preloadDist, { recursive: true });

writeFileSync(
  resolve(preloadDist, "package.json"),
  `${JSON.stringify(
    {
      type: "commonjs",
      private: true,
      dependencies: {
        sharp: packageJson.dependencies.sharp,
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);

function npmInstall(args, cwd) {
  execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--package-lock=false", "--cache", npmCache, ...args], {
    cwd,
    stdio: "inherit",
  });
}

npmInstall([], preloadDist);

for (const target of bundledSharpTargets) {
  const targetDir = mkdtempSync(join(tmpdir(), `zt-img-zip-sharp-${target.os}-${target.cpu}-`));
  try {
    npmInstall([`--os=${target.os}`, `--cpu=${target.cpu}`, `sharp@${packageJson.dependencies.sharp}`], targetDir);
    const sourceImgDir = join(targetDir, "node_modules", "@img");
    const targetImgDir = join(preloadDist, "node_modules", "@img");
    if (existsSync(sourceImgDir)) {
      cpSync(sourceImgDir, targetImgDir, { recursive: true });
    }
  } finally {
    rmSync(targetDir, { recursive: true, force: true });
  }
}

const plugin = JSON.parse(readFileSync(resolve(root, "plugin.json"), "utf8"));
plugin.main = "index.html";
plugin.preload = "preload/services.js";
delete plugin.development;
writeFileSync(resolve(dist, "plugin.json"), `${JSON.stringify(plugin, null, 2)}\n`, "utf8");
