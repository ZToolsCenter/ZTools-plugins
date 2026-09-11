"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ocrImages } = require("../../preload/image-converter.cjs");

test("terminates OCR worker when the job is cancelled", async () => {
  let terminated = 0;
  const controller = new AbortController();
  const worker = {
    recognize: () => new Promise(() => undefined),
    async terminate() { terminated += 1; }
  };
  const pending = ocrImages(["image.png"], { signal: controller.signal, workerFactory: async () => worker });
  controller.abort();
  await assert.rejects(pending, error => error.code === "JOB_CANCELLED");
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(terminated >= 1);
});
