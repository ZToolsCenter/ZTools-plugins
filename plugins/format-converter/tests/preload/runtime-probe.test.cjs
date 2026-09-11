"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { officeCliCandidates, browserCandidates, libreOfficeCandidates } = require("../../preload/runtime-probe.cjs");

test("discovers platform-specific binaries without accepting renderer paths", () => {
  const winEnv = { PATH: "C:\\Tools", LOCALAPPDATA: "C:\\Users\\A\\AppData\\Local", PROGRAMFILES: "C:\\Program Files", "PROGRAMFILES(X86)": "C:\\Program Files (x86)", USERPROFILE: "C:\\Users\\A" };
  assert.ok(officeCliCandidates("win32", winEnv).some(item => item.endsWith(path.join("OfficeCLI", "officecli.exe"))));
  assert.ok(browserCandidates("win32", winEnv).some(item => item.toLowerCase().includes("edge")));
  assert.ok(libreOfficeCandidates("win32", winEnv).some(item => item.endsWith("soffice.exe")));
  assert.ok(browserCandidates("darwin", { HOME: "/Users/a" }).some(item => item.includes("Google Chrome.app")));
  assert.ok(libreOfficeCandidates("linux", { PATH: "/usr/bin:/opt/bin" }).some(item => item.endsWith("soffice")));
});
