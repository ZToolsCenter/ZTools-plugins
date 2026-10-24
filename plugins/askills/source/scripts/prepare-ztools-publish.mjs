// Prepare an auditable center submission. This script does not contact GitHub.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactRoot = path.join(root, "artifacts", "ztools");
const options = new Map();
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 2) {
  const name = args[index];
  if (
    !["--plugin-dir", "--out-dir"].includes(name) ||
    !args[index + 1] ||
    options.has(name)
  )
    throw new Error(
      "Usage: pnpm prepare:ztools:publish [--plugin-dir <built-plugin>] [--out-dir <submission>]",
    );
  options.set(name, args[index + 1]);
}
const plugin = path.resolve(
  root,
  options.get("--plugin-dir") || "artifacts/ztools/Askills",
);
const output = path.resolve(
  root,
  options.get("--out-dir") || "artifacts/ztools/Askills-center",
);
for (const directory of [plugin, output]) {
  const relative = path.relative(artifactRoot, directory);
  assert(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative),
    "Use child directories of artifacts/ztools.",
  );
  let ancestor = directory;
  while (ancestor !== root) {
    const info = await lstat(ancestor).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    assert(
      !info || (info.isDirectory() && !info.isSymbolicLink()),
      `Directory must not be a link or file: ${ancestor}`,
    );
    ancestor = path.dirname(ancestor);
  }
}
assert(
  output !== plugin &&
    !output.startsWith(plugin + path.sep) &&
    !plugin.startsWith(output + path.sep),
  "Submission and plugin directories must not overlap.",
);
assert.equal(
  (
    await readdir(output).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    })
  ).length,
  0,
  "Choose an empty submission directory.",
);

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    result.stderr || result.stdout || `${command} failed`,
  );
  return result.stdout.trim();
}
assert.equal(
  run("git", ["status", "--porcelain"]),
  "",
  "Commit the source changes before preparing a source snapshot.",
);
const commit = run("git", ["rev-parse", "HEAD"]);
const manifest = JSON.parse(
  await readFile(path.join(root, "ztools/plugin.json"), "utf8"),
);
const builtManifest = JSON.parse(
  await readFile(path.join(plugin, "plugin.json"), "utf8"),
);
assert.deepEqual(
  builtManifest,
  manifest,
  "Rebuild the plugin with the current manifest.",
);
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
for (const name of ["preload.js", "bridge.cjs", "package.json"]) {
  assert(
    (await readFile(path.join(plugin, name))).equals(
      await readFile(path.join(root, "ztools", name)),
    ),
    `Rebuild the plugin: ${name} is stale.`,
  );
}

const checksums = {};
async function inspect(directory, relative = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = path.posix.join(relative, entry.name);
    assert(!entry.isSymbolicLink(), `Unexpected link in plugin: ${name}`);
    if (entry.isDirectory())
      await inspect(path.join(directory, entry.name), name);
    else {
      assert(entry.isFile(), `Unexpected file type: ${name}`);
      assert(
        !/(^|\/)(\.env(?:\..*)?|\.git|node_modules|.*\.(?:sqlite|db|pem|key))$/i.test(
          name,
        ),
        `Unexpected private/runtime file: ${name}`,
      );
      checksums[name] = createHash("sha256")
        .update(await readFile(path.join(directory, entry.name)))
        .digest("hex");
    }
  }
}
await inspect(plugin);
await mkdir(output, { recursive: true });
await cp(plugin, path.join(output, "payload"), {
  recursive: true,
  force: false,
  errorOnExist: true,
});
await mkdir(path.join(output, "source"));
const temporary = await mkdtemp(path.join(root, ".askills/ztools-publish-"));
const archive = path.join(temporary, "source.tar");
run("git", ["archive", "--format=tar", "--output", archive, commit]);
run("tar", ["-xf", archive, "-C", path.join(output, "source")]);
await writeFile(
  path.join(output, "plugin.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
await cp(path.join(plugin, "logo.png"), path.join(output, "logo.png"));
await cp(path.join(root, "LICENSE"), path.join(output, "LICENSE"));
await cp(
  path.join(root, "ztools/CHANGELOG.md"),
  path.join(output, "CHANGELOG.md"),
);
await writeFile(path.join(output, ".gitignore"), "node_modules/\ndist/\n");
await writeFile(path.join(output, ".gitattributes"), "payload/** -text\n");
await writeFile(
  path.join(output, "package.json"),
  JSON.stringify(
    {
      name: "askills-ztools-submission",
      version: manifest.version,
      private: true,
      type: "module",
      license: "MIT",
      scripts: { build: "node build.mjs" },
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  path.join(output, "build.mjs"),
  `import { cp, mkdir, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const manifest = JSON.parse(await readFile('source-manifest.json', 'utf8'));
const actualFiles = [];
async function verify(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    assert(!entry.isSymbolicLink(), 'Unexpected link: ' + name);
    if (entry.isDirectory()) await verify(directory + '/' + entry.name, name + '/');
    else {
      assert(entry.isFile(), 'Unexpected file type: ' + name);
      const bytes = await readFile(directory + '/' + entry.name);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.files[name], 'Payload changed: ' + name);
      actualFiles.push(name);
    }
  }
}
await verify('payload');
assert.deepEqual(actualFiles.sort(), Object.keys(manifest.files).sort(), 'Payload file list changed');
await mkdir('dist');
for (const name of await readdir('payload')) await cp('payload/' + name, 'dist/' + name, { recursive: true, force: false, errorOnExist: true });
console.log('Verified Askills payload copied to dist. Native Rust source is in source/src-tauri.');
`,
);
await writeFile(
  path.join(output, "source-manifest.json"),
  JSON.stringify(
    {
      repository: "https://github.com/Candquarzy/Askills",
      sourceCommit: commit,
      pluginVersion: manifest.version,
      files: checksums,
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  path.join(output, "README.md"),
  `# Askills

中英文 Agent Skills 管理器，为本地 skills 库、项目部署和 GitHub 来源提供图形界面。作者：Candquarzy。当前支持 Windows x64。

## 使用

安装后，在 ZTools 搜索 Askills、skills库、skills项目、skills来源或skills设置。支持导入、显示名称、Markdown 阅读、固定版本部署、升级回滚、库迁移、中英界面及透明主题。

与桌面版共用 %LOCALAPPDATA%\\asklils 中的数据。切换前退出占用同一库的另一实例；出现 LibraryBusy 时关闭另一实例后刷新。

## 构建与源码

payload/ 是经过本机 ZTools 验证的插件内容，包括预编译的 Windows x64 Rust helper。中心构建执行 node build.mjs，逐文件验证 SHA-256 后将 payload/ 复制到 dist/；最终插件不包含源码快照或构建材料。

source/ 包含完整的 React、Rust、锁文件、测试和构建脚本，来自 Askills commit ${commit}。source-manifest.json 记录来源提交与每个运行文件的摘要。preload.js 和 bridge.cjs 保持可读。

重新编译需要 Windows x64、Node.js 24、pnpm 11.22.0、Rust stable 和 MSVC。在 source/ 执行 pnpm install --frozen-lockfile，然后 pnpm build:ztools；生成 source/artifacts/ztools/Askills/ 与 Askills.zpx。Rust helper 可以单独执行 cargo build --manifest-path src-tauri/Cargo.toml --locked --release --bin askills-ztools。

## 许可证

应用源码采用 MIT，见 LICENSE。界面使用本机字体，不内置字体文件；图标文字相关的 MiSans 原始许可见 payload/licenses/MiSans.LICENSE.txt。来源下载不会执行 skill 脚本，项目写入需要用户选择目录和确认。
`,
);
console.log(`Prepared center submission: ${output}`);
console.log(`Source commit: ${commit}`);
console.log("Nothing has been pushed or published.");
