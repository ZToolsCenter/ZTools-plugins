import test from "node:test";
import assert from "node:assert/strict";
import {
  FOUNDATION_CASE_IDS,
  describeStorageProbeReport,
  parseStorageProbeReport,
  validateStorageProbeReport,
} from "./lib/windows-storage-report.mjs";

function passingReport(directoryFlushCall = "api-rejected") {
  return {
    schemaVersion: 1,
    probe: "windows-storage-foundation",
    execution: "PASS",
    isolation: "owned-temporary-directory",
    namespaceDurability: "NOT-VERIFIED",
    productionStorageEnabled: false,
    gateComplete: false,
    directoryFlushCall,
    cases: FOUNDATION_CASE_IDS.map(id => ({
      id,
      status: "PASS",
      reason: id === "directory-flush-call-observed"
        ? "api-observed"
        : [
            "private-root-created", "root-owner-dacl-verified", "private-file-created",
            "file-owner-dacl-verified", "file-identity-stable", "file-flush-write-handle",
            "owned-fixture-cleanup",
          ].includes(id) ? "ok" : "expected-rejection",
    })),
  };
}

function notRunReport() {
  return describeStorageProbeReport();
}

function wire(report) {
  return JSON.stringify(report) + "\n";
}

function rejectsObject(report) {
  assert.throws(() => validateStorageProbeReport(report), {
    name: "TypeError",
    message: "Invalid Windows storage probe report",
  });
}

function rejectsWire(input) {
  assert.throws(() => parseStorageProbeReport(input), {
    name: "TypeError",
    message: "Invalid Windows storage probe report",
  });
}

test("synthetic complete protocol report round-trips with API rejection and keeps durability unverified", () => {
  for (const observation of ["api-success", "api-rejected"]) {
    const source = passingReport(observation);
    const decoded = parseStorageProbeReport(wire(source));
    assert.equal(decoded.execution, "PASS");
    assert.equal(decoded.directoryFlushCall, observation);
    assert.equal(decoded.namespaceDurability, "NOT-VERIFIED");
    assert.equal(decoded.productionStorageEnabled, false);
    assert.equal(decoded.gateComplete, false);
    assert.notStrictEqual(decoded, source);
    assert.notStrictEqual(decoded.cases, source.cases);
    assert.notStrictEqual(decoded.cases[0], source.cases[0]);
  }
});

test("the local descriptor identifies all native cases as NOT-RUN", () => {
  const report = describeStorageProbeReport();
  assert.equal(report.execution, "NOT-RUN");
  assert.deepEqual(report.cases.map(item => item.id), FOUNDATION_CASE_IDS);
  assert.ok(report.cases.every(item =>
    item.status === "NOT-RUN" && item.reason === "prerequisite-unavailable"));
  assert.deepEqual(parseStorageProbeReport(wire(report)), report);
});

test("a false PASS, missing case, reordered ID, duplicate ID, or unknown field is rejected", () => {
  const falsePass = passingReport();
  falsePass.cases[0].reason = "expected-rejection";
  rejectsObject(falsePass);

  const missing = passingReport();
  missing.cases.pop();
  rejectsObject(missing);

  const reordered = passingReport();
  [reordered.cases[0], reordered.cases[1]] = [reordered.cases[1], reordered.cases[0]];
  rejectsObject(reordered);

  const duplicate = passingReport();
  duplicate.cases[1].id = duplicate.cases[0].id;
  rejectsObject(duplicate);

  const unknownTop = passingReport();
  unknownTop.sourcePath = "/private/path";
  rejectsObject(unknownTop);

  const unknownCase = passingReport();
  unknownCase.cases[0].rawError = "untrusted";
  rejectsObject(unknownCase);
});

test("fixed flags and execution summary cannot claim more than the individual cases", () => {
  for (const [key, value] of [
    ["namespaceDurability", "VERIFIED"],
    ["productionStorageEnabled", true],
    ["gateComplete", true],
  ]) {
    const changed = passingReport();
    changed[key] = value;
    rejectsObject(changed);
  }

  const inconsistent = passingReport();
  inconsistent.cases[4].status = "FAIL";
  inconsistent.cases[4].reason = "identity-mismatch";
  rejectsObject(inconsistent);

  const mixed = passingReport();
  mixed.cases[4].status = "NOT-RUN";
  mixed.cases[4].reason = "prerequisite-unavailable";
  mixed.execution = "FAIL";
  assert.equal(validateStorageProbeReport(mixed).execution, "FAIL");

  const allNotRunWrongSummary = notRunReport();
  allNotRunWrongSummary.execution = "FAIL";
  rejectsObject(allNotRunWrongSummary);
});

test("reason codes and directory-flush observations must match their case", () => {
  const arbitraryReason = passingReport();
  arbitraryReason.cases[0].reason = "raw Win32 error: 5";
  rejectsObject(arbitraryReason);

  const directoryMismatch = passingReport("not-run");
  rejectsObject(directoryMismatch);

  const failedDirectoryCall = passingReport();
  failedDirectoryCall.cases[13] = {
    id: "directory-flush-call-observed",
    status: "FAIL",
    reason: "inspection-failed",
  };
  failedDirectoryCall.execution = "FAIL";
  failedDirectoryCall.directoryFlushCall = "api-success";
  rejectsObject(failedDirectoryCall);

  const failedCleanup = passingReport();
  failedCleanup.cases[14] = {
    id: "owned-fixture-cleanup",
    status: "FAIL",
    reason: "cleanup-incomplete",
  };
  failedCleanup.execution = "FAIL";
  assert.equal(validateStorageProbeReport(failedCleanup).cases[14].reason, "cleanup-incomplete");
});

test("object validation reads only plain own data fields and returns a normalized copy", () => {
  const getterReport = passingReport();
  Object.defineProperty(getterReport, "execution", {
    enumerable: true,
    configurable: true,
    get() { throw new Error("must not execute"); },
  });
  rejectsObject(getterReport);

  const getterCase = passingReport();
  Object.defineProperty(getterCase.cases[0], "reason", {
    enumerable: true,
    configurable: true,
    get() { throw new Error("must not execute"); },
  });
  rejectsObject(getterCase);

  const trapped = new Proxy(passingReport(), {
    ownKeys() { throw new Error("proxy trap"); },
  });
  rejectsObject(trapped);
  let transparentProxyTraps = 0;
  const transparent = new Proxy(passingReport(), {
    ownKeys(target) { transparentProxyTraps += 1; return Reflect.ownKeys(target); },
    getPrototypeOf(target) { transparentProxyTraps += 1; return Reflect.getPrototypeOf(target); },
  });
  rejectsObject(transparent);
  assert.equal(transparentProxyTraps, 0);
  const proxiedCases = passingReport();
  proxiedCases.cases = new Proxy(proxiedCases.cases, {});
  rejectsObject(proxiedCases);
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  rejectsObject(revoked.proxy);

  const nullPrototype = Object.assign(Object.create(null), passingReport());
  assert.equal(validateStorageProbeReport(nullPrototype).execution, "PASS");
});

test("wire parser rejects duplicate keys, noncanonical JSON, invalid UTF-8, and oversized data", () => {
  const canonical = wire(passingReport());
  rejectsWire(canonical.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'));
  rejectsWire(canonical.replace("{", "{ "));
  rejectsWire(new Uint8Array([0x7b, 0xff, 0x7d]));
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(canonical)]);
  rejectsWire(bom);
  let inputProxyTraps = 0;
  const proxiedBytes = new Proxy(new Uint8Array(Buffer.from(canonical)), {
    getPrototypeOf(target) { inputProxyTraps += 1; return Reflect.getPrototypeOf(target); },
  });
  rejectsWire(proxiedBytes);
  assert.equal(inputProxyTraps, 0);
  rejectsWire(new Proxy(new Uint8Array([0x7b]), {}));
  rejectsWire(new Uint8Array(16 * 1024 + 1));
  rejectsWire(canonical.slice(0, -1));
  rejectsWire(canonical + "\n");
  assert.equal(parseStorageProbeReport(Buffer.from(canonical, "utf8")).execution, "PASS");
});
