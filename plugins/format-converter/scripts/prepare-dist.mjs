import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const manifest = JSON.parse(await fs.readFile(path.join(root, "plugin.json"), "utf8"));
delete manifest.development;
await fs.writeFile(path.join(dist, "plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`);

for (const file of ["logo.svg", "README.md", "CHANGELOG.md", "LICENSE", "THIRD_PARTY_NOTICES.md"]) {
  await fs.copyFile(path.join(root, file), path.join(dist, file));
}
await fs.cp(path.join(root, "docs"), path.join(dist, "docs"), { recursive: true, force: true });
await fs.cp(path.join(root, "preload"), path.join(dist, "preload"), { recursive: true, force: true, filter: source => !source.includes(`${path.sep}node_modules${path.sep}`) });

execFileSync(npmCommand, ["ci", "--omit=dev", "--include=optional", "--no-audit", "--no-fund"], {
  cwd: path.join(dist, "preload"),
  stdio: "inherit"
});
