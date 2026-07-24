import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifyAssembledPackage } from "../scripts/assemble-dist.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function packageFixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "pasteboard-pro-package-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, "assets"));
  await writeFile(
    path.join(root, "plugin.json"),
    JSON.stringify({
      main: "index.html",
      preload: "preload.js",
      logo: "logo.svg",
    }),
  );
  await Promise.all([
    writeFile(path.join(root, "index.html"), "<!doctype html>"),
    writeFile(path.join(root, "preload.js"), ""),
    writeFile(path.join(root, "logo.svg"), "<svg/>", "utf8"),
    writeFile(path.join(root, "package.json"), '{"type":"commonjs"}'),
    writeFile(path.join(root, "pasteboard-vision"), "binary"),
    writeFile(path.join(root, "assets", "index.js"), ""),
  ]);
  await chmod(path.join(root, "pasteboard-vision"), 0o755);
  return root;
}

describe("ZTools package assembly verifier", () => {
  it("accepts the expected release package shape", async () => {
    const root = await packageFixture();
    const result = await verifyAssembledPackage(root);
    expect(result.files).toContain("pasteboard-vision");
    expect(result.files).toContain(path.join("assets", "index.js"));
  });

  it("rejects source maps and credential-like files", async () => {
    const root = await packageFixture();
    await writeFile(path.join(root, "assets", "index.js.map"), "{}");
    await expect(verifyAssembledPackage(root)).rejects.toThrow();
  });
});
