import assert from "node:assert/strict";
import test from "node:test";
import {
  compareAppVersions,
  isSupportedZToolsVersion,
} from "../../src/utils/app-version.js";

test("ZTools 3.2.0 及更高版本通过最低版本检查", () => {
  assert.equal(isSupportedZToolsVersion("3.2.0"), true);
  assert.equal(isSupportedZToolsVersion("3.2.1-beta.1"), true);
  assert.equal(isSupportedZToolsVersion("v4.0.0"), true);
});

test("低于最低版本或最低版本预发布版本不通过", () => {
  assert.equal(isSupportedZToolsVersion("3.1.9"), false);
  assert.equal(isSupportedZToolsVersion("3.2.0-beta.1"), false);
  assert.equal(isSupportedZToolsVersion(""), false);
});

test("版本比较遵循预发布版本优先级", () => {
  assert.equal(compareAppVersions("3.2.0-rc.1", "3.2.0"), -1);
  assert.equal(compareAppVersions("3.2.0-beta.2", "3.2.0-beta.1"), 1);
  assert.equal(compareAppVersions("invalid", "3.2.0"), null);
});
