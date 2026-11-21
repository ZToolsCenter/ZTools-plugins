import { describe, expect, it } from "vitest";
import { documentIdentity } from "../../src/core/documentIdentity";

describe("document editor identity", () => {
  it("keeps path-backed identity stable and separates untitled documents", () => {
    expect(documentIdentity("/notes/a.md")).toBe(documentIdentity("/notes/a.md"));
    expect(documentIdentity(null)).not.toBe(documentIdentity(null));
  });

  it("gives named samples stable identities without conflating drafts", () => {
    expect(documentIdentity(null, "sample:quickstart")).toBe(documentIdentity(null, "sample:quickstart"));
    expect(documentIdentity(null, "sample:quickstart")).not.toBe(documentIdentity(null, "sample:reference"));
  });
});
