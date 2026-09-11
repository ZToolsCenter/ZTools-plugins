import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const matrixPattern = /^(floating|bottom|left|right)-(light|dark)-(expanded|compact)-(full|reduced)$/u;
const featureStates = new Set(["search", "pinboard", "preview", "paste-stack"]);
const hosts = ["atools", "ztools"];

const radiusIsZero = (value) => value === "0px" || value === "0";

function validateDock(record, dock) {
  const radii = record.radii;
  assert.equal(typeof radii, "object", `${record.screenshot} has no radii evidence`);
  if (dock === "bottom") {
    assert.equal(radiusIsZero(radii.bottomLeft), true, `${record.screenshot} bottom-left radius is not zero`);
    assert.equal(radiusIsZero(radii.bottomRight), true, `${record.screenshot} bottom-right radius is not zero`);
  } else if (dock === "left") {
    assert.equal(radiusIsZero(radii.topLeft), true, `${record.screenshot} top-left radius is not zero`);
    assert.equal(radiusIsZero(radii.bottomLeft), true, `${record.screenshot} bottom-left radius is not zero`);
  } else if (dock === "right") {
    assert.equal(radiusIsZero(radii.topRight), true, `${record.screenshot} top-right radius is not zero`);
    assert.equal(radiusIsZero(radii.bottomRight), true, `${record.screenshot} bottom-right radius is not zero`);
  } else {
    assert.equal(radiusIsZero(radii.topLeft), false, `${record.screenshot} floating radius collapsed`);
    assert.equal(radiusIsZero(radii.bottomRight), false, `${record.screenshot} floating radius collapsed`);
  }
}

export async function verifyVisualArtifact(artifactRoot) {
  const absoluteRoot = path.resolve(artifactRoot);
  const report = JSON.parse(await readFile(path.join(absoluteRoot, "visual-matrix.json"), "utf8"));
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.pass, true, "Visual matrix report is not marked pass");
  assert.equal(report.matrixStates, 32);
  assert.equal(report.screenshots, 72);
  assert.equal(Array.isArray(report.records), true);
  assert.equal(report.records.length, 72);

  const screenshotPaths = new Set();
  const matrixPairs = new Map();
  const featurePairs = new Map();
  const hostCounts = new Map(hosts.map((host) => [host, 0]));

  for (const record of report.records) {
    assert.ok(hosts.includes(record.host), `Unknown visual host: ${record.host}`);
    assert.equal(typeof record.state, "string");
    assert.equal(record.screenshot, `${record.host}/${record.state}.png`);
    assert.equal(path.posix.isAbsolute(record.screenshot), false);
    assert.equal(record.screenshot.split("/").includes(".."), false);
    assert.equal(screenshotPaths.has(record.screenshot), false, `Duplicate screenshot: ${record.screenshot}`);
    screenshotPaths.add(record.screenshot);
    hostCounts.set(record.host, hostCounts.get(record.host) + 1);

    assert.deepEqual(record.consoleErrors, [], `${record.screenshot} has console or page errors`);
    const { viewport, shelf } = record;
    for (const [label, value] of Object.entries({
      viewportWidth: viewport?.width,
      viewportHeight: viewport?.height,
      shelfX: shelf?.x,
      shelfY: shelf?.y,
      shelfWidth: shelf?.width,
      shelfHeight: shelf?.height,
    })) {
      assert.equal(Number.isFinite(value), true, `${record.screenshot} has invalid ${label}`);
    }
    assert.ok(shelf.x >= 0 && shelf.y >= 0, `${record.screenshot} escapes the viewport origin`);
    assert.ok(shelf.x + shelf.width <= viewport.width + 1, `${record.screenshot} overflows horizontally`);
    assert.ok(shelf.y + shelf.height <= viewport.height + 1, `${record.screenshot} overflows vertically`);

    const matrix = record.state.match(matrixPattern);
    if (matrix) {
      const [, dock, , , motion] = matrix;
      validateDock(record, dock);
      if (motion === "reduced") {
        assert.equal(record.radii.transitionDuration, "0s", `${record.screenshot} retains motion`);
      }
      const pair = matrixPairs.get(record.state) ?? [];
      pair.push(record);
      matrixPairs.set(record.state, pair);
    } else {
      assert.equal(featureStates.has(record.state), true, `Unknown visual state: ${record.state}`);
      const pair = featurePairs.get(record.state) ?? [];
      pair.push(record);
      featurePairs.set(record.state, pair);
    }

    const screenshot = await stat(path.join(absoluteRoot, ...record.screenshot.split("/")));
    assert.equal(screenshot.isFile(), true, `Missing screenshot file: ${record.screenshot}`);
    assert.ok(screenshot.size > 8, `Screenshot file is empty: ${record.screenshot}`);
  }

  assert.equal(screenshotPaths.size, 72);
  assert.deepEqual(Object.fromEntries(hostCounts), { atools: 36, ztools: 36 });
  assert.equal(matrixPairs.size, 32);
  assert.equal(featurePairs.size, 4);

  for (const [state, pair] of matrixPairs) {
    assert.equal(pair.length, 2, `${state} is not represented by both hosts`);
    assert.deepEqual(new Set(pair.map((record) => record.host)), new Set(hosts));
    assert.ok(Math.abs(pair[0].shelf.width - pair[1].shelf.width) <= 4, `${state} shelf widths diverge`);
    assert.ok(Math.abs(pair[0].shelf.x - pair[1].shelf.x) <= 4, `${state} shelf positions diverge`);
  }
  for (const [state, pair] of featurePairs) {
    assert.equal(pair.length, 2, `${state} is not represented by both hosts`);
    assert.deepEqual(new Set(pair.map((record) => record.host)), new Set(hosts));
  }

  return {
    schemaVersion: report.schemaVersion,
    screenshots: report.records.length,
    matrixStates: matrixPairs.size,
    featureStates: featurePairs.size,
    hostCounts: Object.fromEntries(hostCounts),
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const artifactRoot = process.argv[2] ?? "artifacts/pasteboardpro/visual-matrix";
  const summary = await verifyVisualArtifact(artifactRoot);
  console.log(
    `PasteboardPro visual artifact verified (${summary.screenshots} screenshots, ${summary.matrixStates} matrix states)`,
  );
}
