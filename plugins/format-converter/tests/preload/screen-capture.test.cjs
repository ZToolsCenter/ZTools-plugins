"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { requestScreenCapture } = require("../../preload/screen-capture.cjs");

test("screen capture keeps the ZTools 3.2 image and bounds callback", async () => {
  let receivedAutoConfirm;
  const result = await requestScreenCapture({
    screenCapture(callback, autoConfirm) {
      receivedAutoConfirm = autoConfirm;
      callback("data:image/png;base64,aGVsbG8=", { x: 1, y: 2, width: 3, height: 4 });
      return Promise.resolve();
    },
  });
  assert.equal(receivedAutoConfirm, false);
  assert.deepEqual(result, {
    image: "data:image/png;base64,aGVsbG8=",
    bounds: { x: 1, y: 2, width: 3, height: 4 },
  });
});

test("screen capture propagates asynchronous host rejection", async () => {
  await assert.rejects(
    requestScreenCapture({ screenCapture() { return Promise.reject(new Error("capture ipc failed")); } }),
    /capture ipc failed/,
  );
});
