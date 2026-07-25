import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");

const pluginConfig = JSON.parse(
  await fs.readFile(path.join(root, "plugin.json"), "utf8")
);
delete pluginConfig.development;

await fs.writeFile(
  path.join(dist, "plugin.json"),
  `${JSON.stringify(pluginConfig, null, 2)}\n`
);
await fs.copyFile(path.join(root, "logo.svg"), path.join(dist, "logo.svg"));
await fs.cp(path.join(root, "preload"), path.join(dist, "preload"), {
  recursive: true,
  force: true
});
await fs.cp(path.join(root, "mcp"), path.join(dist, "mcp"), {
  recursive: true,
  force: true
});
await fs.cp(path.join(root, "docs"), path.join(dist, "docs"), {
  recursive: true,
  force: true
});
await fs.copyFile(path.join(root, "README.md"), path.join(dist, "README.md"));
await fs.copyFile(path.join(root, "LICENSE"), path.join(dist, "LICENSE"));
await fs.copyFile(
  path.join(root, "THIRD_PARTY_NOTICES.md"),
  path.join(dist, "THIRD_PARTY_NOTICES.md")
);
