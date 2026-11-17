"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { getAvailableMemory, parseLinuxMemAvailable, parseMacVmStat } = require("../../preload/local-ai/memory-info.cjs");

test("Linux uses MemAvailable instead of only free pages", () => {
  const contents = "MemTotal:       32768000 kB\nMemFree:          512000 kB\nMemAvailable:   12500000 kB\n";
  assert.equal(parseLinuxMemAvailable(contents), 12_800_000_000);
  assert.equal(parseLinuxMemAvailable("MemFree: 100 kB"), null);
  const available = getAvailableMemory({
    platform: "linux",
    readFileSync: () => contents,
    os: { freemem: () => 512_000_000, totalmem: () => 32_000_000_000 }
  });
  assert.equal(available, 12_800_000_000);
});

test("macOS counts free, inactive, and speculative pages without double counting purgeable", () => {
  const vmstat = [
    "Mach Virtual Memory Statistics: (page size of 4096 bytes)",
    "Pages free: 100.",
    "Pages inactive: 200.",
    "Pages speculative: 50.",
    "Pages purgeable: 900."
  ].join("\n");
  assert.equal(parseMacVmStat(vmstat), (100 + 200 + 50) * 4096);
  assert.equal(getAvailableMemory({
    platform: "darwin",
    execFileSync: (binary, args, options) => {
      assert.equal(binary, "/usr/bin/vm_stat");
      assert.deepEqual(args, []);
      assert.equal(options.timeout, 1200);
      return vmstat;
    },
    os: { freemem: () => 123, totalmem: () => 32 * 1024 * 1024 * 1024 }
  }), (100 + 200 + 50) * 4096);
});

test("failed system probes fall back to os.freemem and are capped by total memory", () => {
  assert.equal(getAvailableMemory({
    platform: "darwin",
    execFileSync: () => { throw new Error("probe unavailable"); },
    os: { freemem: () => 9_000, totalmem: () => 8_000 }
  }), 8_000);
});
