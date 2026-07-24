import { describe, expect, it, vi } from "vitest";

import { ensureZToolsAutoStart } from "../preload/auto-start";

describe("ZTools auto-start registration", () => {
  it("adds Paste剪切板 to the host auto-start list", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(["other-plugin", "other-plugin", null])
      .mockResolvedValueOnce(true);

    await expect(ensureZToolsAutoStart({ invoke })).resolves.toBe(true);
    expect(invoke).toHaveBeenNthCalledWith(1, "ztools:db-get", "auto-start-plugin");
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      "ztools:db-put",
      "auto-start-plugin",
      ["other-plugin", "pasteboard-pro"],
    );
  });

  it("does not rewrite an existing registration", async () => {
    const invoke = vi.fn().mockResolvedValue(["pasteboard-pro"]);

    await expect(ensureZToolsAutoStart({ invoke })).resolves.toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
