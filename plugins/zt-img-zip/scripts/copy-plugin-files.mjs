import { cpSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const dist = resolve(root, "dist");

for (const file of ["preload.cjs", "logo.png"]) {
  copyFileSync(resolve(root, file), resolve(dist, file));
}

cpSync(resolve(root, "preload"), resolve(dist, "preload"), { recursive: true });

const plugin = JSON.parse(readFileSync(resolve(root, "plugin.json"), "utf8"));
plugin.main = "index.html";
plugin.preload = "preload/services.js";
delete plugin.development;
writeFileSync(resolve(dist, "plugin.json"), `${JSON.stringify(plugin, null, 2)}\n`, "utf8");
