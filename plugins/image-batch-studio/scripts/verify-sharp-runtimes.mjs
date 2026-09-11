import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distPreload = path.join(root, "dist", "preload");
const runtimeConfig = JSON.parse(
  await fs.readFile(path.join(root, "scripts", "sharp-runtime-targets.json"), "utf8")
);
const runtimeLock = JSON.parse(
  await fs.readFile(path.join(root, "scripts", "runtime", "package-lock.json"), "utf8")
);
const manifest = JSON.parse(await fs.readFile(path.join(root, "dist", "plugin.json"), "utf8"));
const sharpPackage = JSON.parse(
  await fs.readFile(path.join(distPreload, "node_modules", "sharp", "package.json"), "utf8")
);
const errors = [];

if (sharpPackage.version !== runtimeConfig.sharpVersion) {
  errors.push(`sharp version ${sharpPackage.version} (expected ${runtimeConfig.sharpVersion})`);
}

for (const target of runtimeConfig.targets) {
  for (const runtimePackage of target.packages) {
    const lockEntry = runtimeLock.packages[`node_modules/${runtimePackage.name}`];
    if (!lockEntry) {
      errors.push(`${runtimePackage.name} missing from runtime lockfile`);
      continue;
    }
    if (lockEntry.version !== runtimePackage.version) {
      errors.push(`${runtimePackage.name} version ${runtimePackage.version} (lockfile ${lockEntry.version})`);
    }
    if (lockEntry.integrity !== runtimePackage.integrity) {
      errors.push(`${runtimePackage.name} integrity mismatch`);
    }
    if (lockEntry.resolved !== runtimePackage.url) {
      errors.push(`${runtimePackage.name} URL mismatch`);
    }
    if (!runtimePackage.url.startsWith("https://") || !runtimePackage.integrity.startsWith("sha512-")) {
      errors.push(`${runtimePackage.name} must use HTTPS and SHA-512`);
    }
  }
}

const bundledImgPackages = await fs.readdir(path.join(distPreload, "node_modules", "@img")).catch(() => []);
const bundledNative = bundledImgPackages.filter((name) => name.startsWith("sharp-"));
if (bundledNative.length > 0) {
  errors.push(`native Sharp packages must be downloaded at runtime: ${bundledNative.join(", ")}`);
}

if (manifest.unpack) errors.push("plugin.json must not unpack runtime-downloaded native files");
for (const platform of ["darwin", "win32"]) {
  if (!manifest.platform?.includes(platform)) errors.push(`plugin.json must enable ${platform}`);
}

if (errors.length > 0) throw new Error(`Sharp runtime verification failed: ${errors.join("; ")}`);

console.log(
  JSON.stringify(
    {
      ok: true,
      sharp: runtimeConfig.sharpVersion,
      targets: runtimeConfig.targets.map((target) => `${target.platform}/${target.arch}`),
      bundledNative: false
    },
    null,
    2
  )
);
