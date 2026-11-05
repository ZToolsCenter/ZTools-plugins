// Real Rust + preload integration; every operation stays inside a fresh fixture.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, access } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { createHost } = require("../ztools/bridge.cjs");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helperPath = path.resolve(
  process.env.ASKILLS_ZTOOLS_HELPER ||
    path.join(root, "artifacts/ztools/Askills/helper/askills-ztools.exe"),
);
await access(helperPath);
await mkdir(path.join(root, ".askills"), { recursive: true });
const fixture = await mkdtemp(path.join(root, ".askills/ztools-helper-"));
const data = path.join(fixture, "data");
const source = path.join(fixture, "本地 skill");
const projectPath = path.join(fixture, "project");
const destination = path.join(fixture, "new-library");
await Promise.all([source, projectPath, destination].map((dir) => mkdir(dir)));
const markdown = (text) =>
  `---\nname: ztools-fixture\ndescription: ZTools integration fixture\nlicense: MIT\n---\n# ${text}\n`;
await writeFile(path.join(source, "SKILL.md"), markdown("Original"));
const children = [];
const hosts = [];

function harness() {
  const events = {};
  let selected;
  const host = createHost({
    helperPath,
    testDataDirectory: data,
    spawnProcess: (...args) => {
      const child = spawn(...args);
      const closed = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Helper exited with ${code}`));
        });
      });
      // Keep rejection observed even when the test is still asserting responses.
      closed.catch(() => {});
      children.push(closed);
      return child;
    },
    ztools: {
      onPluginEnter: (callback) => {
        events.enter = callback;
      },
      onPluginOut: (callback) => {
        events.out = callback;
      },
      onThemeChange: () => {},
      isDarkColors: () => false,
      showOpenDialog: () => selected,
      shellOpenExternal: () => {
        throw new Error("No browser opens in helper tests");
      },
    },
  });
  hosts.push(host);
  events.enter({ code: "library" });
  return {
    host,
    events,
    async select(folder, purpose) {
      selected = [folder];
      return host.invoke("pick_directory", { purpose });
    },
  };
}

try {
  const first = harness();
  const call = async (command, args) => {
    try {
      return await first.host.invoke(command, args);
    } catch (error) {
      error.message = `${command}: ${error.message}`;
      throw error;
    }
  };
  const info = await call("get_app_info");
  const packageJson = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  assert.equal(info.version, packageJson.version);
  assert.equal(info.protocolVersion, 1);
  const [, fonts] = await Promise.all([
    call("get_snapshot"),
    call("list_system_fonts"),
  ]);
  assert(fonts.includes("Microsoft YaHei"));
  assert(fonts.includes("Arial"));
  await assert.rejects(call("list_system_fonts", { path: source }), {
    code: "InvalidRequest",
  });
  assert.equal((await call("get_snapshot")).skills.length, 0);
  await assert.rejects(
    call("register_directory_selection", { path: source, purpose: "import" }),
    { code: "UnsupportedCommand" },
  );
  await assert.rejects(call("get_snapshot", { path: source }), {
    code: "InvalidRequest",
  });
  const selection = await first.select(source, "import");
  await assert.rejects(
    call("register_project", { selectionId: selection.id }),
    { code: "InvalidSelection" },
  );
  const preview = await call("prepare_import", { selectionId: selection.id });
  assert.match(preview.preview.markdown, /Original/);
  assert.equal((await call("get_snapshot")).skills.length, 0);
  const skill = await call("finish_import", { importId: preview.id });
  const alias = await call("set_skill_display_name", {
    skillId: skill.id,
    displayName: "本地测试",
  });
  assert.equal(alias.displayName, "本地测试");
  const chosenProject = await first.select(projectPath, "project");
  const project = await call("register_project", {
    selectionId: chosenProject.id,
  });
  const plan = await call("preview_deployment", {
    projectId: project.id,
    revisionId: skill.latestRevisionId,
    agent: "codex",
    mode: "auto",
  });
  assert.equal(plan.conflict, null);
  const deployment = await call("apply_deployment", { planId: plan.id });
  assert.equal(
    await readFile(path.join(deployment.targetPath, "SKILL.md"), "utf8"),
    markdown("Original"),
  );

  // Re-import a changed revision and exercise the existing upgrade/rollback path.
  await writeFile(path.join(source, "SKILL.md"), markdown("Updated"));
  const newerSelection = await first.select(source, "import");
  const newerPreview = await call("prepare_import", {
    selectionId: newerSelection.id,
  });
  const newerSkill = await call("finish_import", { importId: newerPreview.id });
  const upgrade = await call("preview_deployment", {
    projectId: project.id,
    revisionId: newerSkill.latestRevisionId,
    agent: "codex",
    mode: "auto",
  });
  await call("apply_deployment", { planId: upgrade.id });
  assert.match(
    await readFile(path.join(deployment.targetPath, "SKILL.md"), "utf8"),
    /Updated/,
  );
  await call("rollback_deployment", { deploymentId: deployment.id });
  assert.match(
    await readFile(path.join(deployment.targetPath, "SKILL.md"), "utf8"),
    /Original/,
  );

  const chosenLibrary = await first.select(destination, "library");
  const movePlan = await call("preview_library_migration", {
    selectionId: chosenLibrary.id,
  });
  assert.equal(movePlan.deploymentCount, 1);
  await call("set_library_root", { selectionId: chosenLibrary.id });
  assert.match(
    await readFile(path.join(deployment.targetPath, "SKILL.md"), "utf8"),
    /Original/,
  );
  await call("set_locale", { locale: "en" });
  await call("set_appearance", {
    appearance: { mode: "dark", accentColor: "#744da9", fontFamily: "Arial" },
  });
  await call("remember_repository", {
    repository: "https://github.com/Candquarzy/Askills",
  });
  assert.equal(
    await call("get_download_progress", { requestId: "absent" }),
    null,
  );
  await call("cancel_operation");
  assert.equal((await call("get_snapshot")).locale, "en");

  // A competing instance must fail safely; retry after EOF must see saved data.
  const second = harness();
  await assert.rejects(second.host.invoke("get_snapshot"), {
    code: "LibraryBusy",
  });
  first.events.out(false);
  await Promise.all(children.slice());
  const reloaded = await second.host.invoke("get_snapshot");
  assert.equal(reloaded.skills[0].displayName, "本地测试");
  assert.equal(reloaded.locale, "en");
  assert.equal(reloaded.appearance.mode, "dark");
  assert.equal(reloaded.appearance.fontFamily, "Arial");
  assert.equal(
    path.toNamespacedPath(reloaded.libraryRoot),
    path.toNamespacedPath(destination),
  );
  assert.deepEqual(reloaded.repositoryHistory, [
    "https://github.com/candquarzy/askills",
  ]);
  await second.host.invoke("remove_deployment", {
    deploymentId: deployment.id,
  });
  await assert.rejects(access(deployment.targetPath), { code: "ENOENT" });
  assert.match(
    await readFile(path.join(source, "SKILL.md"), "utf8"),
    /Updated/,
  );
  console.log(
    JSON.stringify(
      {
        version: info.version,
        fixture,
        deploymentMode: deployment.mode,
        checks: [
          "real stdio + preload",
          "denied commands/arguments/purpose",
          "preview and confirmed import",
          "project deployment",
          "upgrade and rollback",
          "library migration",
          "preferences and history",
          "instance lock and retry",
          "managed removal",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  hosts.forEach((host) => host.close());
  await Promise.all(children);
}
