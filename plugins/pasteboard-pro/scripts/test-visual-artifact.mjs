import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { verifyVisualArtifact } from "./verify-visual-artifact.mjs";

const hosts = ["atools", "ztools"];
const docks = ["floating", "bottom", "left", "right"];
const themes = ["light", "dark"];
const densities = ["expanded", "compact"];
const motions = ["full", "reduced"];
const features = ["search", "pinboard", "preview", "paste-stack"];
const pngFixture = Buffer.from("89504e470d0a1a0a66697874757265", "hex");
const root = await mkdtemp(path.join(os.tmpdir(), "pasteboardpro-visual-test-"));

function radii(dock, motion) {
  const value = {
    topLeft: "16px",
    topRight: "16px",
    bottomLeft: "16px",
    bottomRight: "16px",
    transitionDuration: motion === "reduced" ? "0s" : "0.2s",
  };
  if (dock === "bottom") value.bottomLeft = value.bottomRight = "0px";
  if (dock === "left") value.topLeft = value.bottomLeft = "0px";
  if (dock === "right") value.topRight = value.bottomRight = "0px";
  return value;
}

async function addRecord(records, host, state, dock = "bottom", motion = "full") {
  const screenshot = `${host}/${state}.png`;
  await mkdir(path.join(root, host), { recursive: true });
  await writeFile(path.join(root, screenshot), pngFixture);
  records.push({
    host,
    state,
    screenshot,
    viewport: { width: 1280, height: 720 },
    shelf: { x: 20, y: 20, width: 900, height: 360 },
    radii: radii(dock, motion),
    consoleErrors: [],
  });
}

try {
  const records = [];
  for (const dock of docks) {
    for (const theme of themes) {
      for (const density of densities) {
        for (const motion of motions) {
          const state = `${dock}-${theme}-${density}-${motion}`;
          for (const host of hosts) await addRecord(records, host, state, dock, motion);
        }
      }
    }
  }
  for (const host of hosts) {
    for (const feature of features) await addRecord(records, host, feature);
  }
  await writeFile(
    path.join(root, "visual-matrix.json"),
    JSON.stringify({
      schemaVersion: 1,
      pass: true,
      matrixStates: 32,
      screenshots: 72,
      records,
    }),
  );

  const summary = await verifyVisualArtifact(root);
  assert.deepEqual(summary.hostCounts, { atools: 36, ztools: 36 });
  assert.equal(summary.screenshots, 72);

  await unlink(path.join(root, "atools", "search.png"));
  await assert.rejects(verifyVisualArtifact(root), /ENOENT|Missing screenshot/u);
  console.log("PasteboardPro visual artifact verifier tested");
} finally {
  await rm(root, { recursive: true, force: true });
}
