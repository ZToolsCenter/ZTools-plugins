import { describe, expect, it } from "vitest";

import { syncStatusPresentation } from "../src/sync-view";

describe("sync status presentation", () => {
  it("maps recovery states to explicit actions", () => {
    expect(syncStatusPresentation({ state: "wrong_password", pendingObjects: 0 })).toMatchObject({ tone: "error", action: "unlock" });
    expect(syncStatusPresentation({ state: "offline", pendingObjects: 4 })).toMatchObject({ tone: "warning", action: "retry" });
    expect(syncStatusPresentation({ state: "schema_too_new", pendingObjects: 0 })).toMatchObject({ tone: "error", action: "upgrade" });
  });
});
