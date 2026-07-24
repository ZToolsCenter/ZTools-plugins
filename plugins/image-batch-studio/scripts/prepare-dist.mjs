import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");
const preloadDir = path.join(dist, "preload");
const primaryDarwinCpu = "arm64";
const runtimeDependencies = {
  gifenc: "1.0.3",
  "pdf-lib": "1.17.1",
  sharp: "0.34.5"
};
const darwinSharpRuntimes = [
  {
    cpu: "arm64",
    packages: ["sharp-darwin-arm64", "sharp-libvips-darwin-arm64"]
  },
  {
    cpu: "x64",
    packages: ["sharp-darwin-x64", "sharp-libvips-darwin-x64"]
  }
];

function npmInstall(args) {
  execFileSync("npm", args, {
    cwd: root,
    stdio: "inherit"
  });
}

async function installDarwinSharpRuntime(cpu) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `ztools-sharp-darwin-${cpu}-`));
  try {
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify(
        {
          type: "commonjs",
          dependencies: {
            sharp: runtimeDependencies.sharp
          }
        },
        null,
        2
      )
    );

    npmInstall(["install", "--omit=dev", "--include=optional", "--prefix", tempDir, "--os=darwin", `--cpu=${cpu}`]);

    const sourceImgDir = path.join(tempDir, "node_modules", "@img");
    const targetImgDir = path.join(preloadDir, "node_modules", "@img");
    const runtime = darwinSharpRuntimes.find((item) => item.cpu === cpu);
    if (!runtime) throw new Error(`Unsupported darwin sharp cpu: ${cpu}`);

    await fs.mkdir(targetImgDir, { recursive: true });
    for (const packageName of runtime.packages) {
      const sourcePackage = path.join(sourceImgDir, packageName);
      await fs.access(sourcePackage);
      await fs.cp(sourcePackage, path.join(targetImgDir, packageName), {
        recursive: true,
        force: true
      });
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function installDarwinSharpRuntimes() {
  for (const runtime of darwinSharpRuntimes) {
    await installDarwinSharpRuntime(runtime.cpu);
  }
}

await fs.mkdir(preloadDir, { recursive: true });
const pluginConfig = JSON.parse(await fs.readFile(path.join(root, "plugin.json"), "utf8"));
delete pluginConfig.development;
await fs.writeFile(path.join(dist, "plugin.json"), `${JSON.stringify(pluginConfig, null, 2)}\n`);
await fs.copyFile(path.join(root, "logo.svg"), path.join(dist, "logo.svg"));
await fs.copyFile(path.join(root, "cover.png"), path.join(dist, "cover.png"));
await fs.writeFile(
  path.join(preloadDir, "package.json"),
  JSON.stringify(
    {
      type: "commonjs",
      dependencies: runtimeDependencies
    },
    null,
    2
  )
);

npmInstall(["install", "--omit=dev", "--include=optional", "--prefix", preloadDir, "--os=darwin", `--cpu=${primaryDarwinCpu}`]);
await installDarwinSharpRuntimes();
