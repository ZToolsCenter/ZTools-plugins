import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileDragGrantStore } from "../src/preload/file-drag-grants";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

async function createOutput(name = "output.png") {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "image-batch-drag-"));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, name);
  await fs.writeFile(filePath, "generated");
  return filePath;
}

describe("generated output drag grants", () => {
  it("rejects arbitrary files and consumes generated-file grants once", async () => {
    const generated = await createOutput();
    const arbitrary = await createOutput("arbitrary.png");
    const grants = createFileDragGrantStore();

    await expect(grants.consume(arbitrary)).rejects.toThrow("刚刚由插件生成");
    await grants.grant(generated);
    await expect(grants.consume(generated)).resolves.toEqual([await fs.realpath(generated)]);
    await expect(grants.consume(generated)).rejects.toThrow("刚刚由插件生成");
  });

  it("expires grants and verifies the output remains a regular file", async () => {
    const generated = await createOutput();
    let currentTime = 100;
    const grants = createFileDragGrantStore({ now: () => currentTime, ttlMs: 50 });
    await grants.grant(generated);

    currentTime = 151;
    await expect(grants.consume(generated)).rejects.toThrow("刚刚由插件生成");
    await fs.rm(generated);
    await expect(grants.grant(generated)).rejects.toThrow("文件已不存在");
  });
});
