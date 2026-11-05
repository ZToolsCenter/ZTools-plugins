import { describe, expect, it, vi } from "vitest";
import { historyFixture } from "@pasteboard-pro/contract-fixtures";
import { createSelectionPasteController, type SelectionPasteDependencies } from "../src/selection-paste-controller";

function setup(overrides: Partial<SelectionPasteDependencies> = {}) {
  const dependencies: SelectionPasteDependencies = {
    resolveItem: async id => historyFixture.find(item => item.id === id),
    pasteSingle: vi.fn(async () => undefined),
    pasteContent: vi.fn(async () => ({ status: "pasted" })),
    reportStatus: vi.fn(), showNotice: vi.fn(), closeShelf: vi.fn(),
    ...overrides,
  };
  return { dependencies, controller: createSelectionPasteController(dependencies) };
}
const text = historyFixture.find(item => item.kind === "text")!;
const image = historyFixture.find(item => item.kind === "image")!;

describe("selection paste orchestration", () => {
  it("requires a queue for mixed records before any clipboard write", async () => {
    const { dependencies: d, controller } = setup();
    await controller.paste([text.id, image.id]);
    expect(d.showNotice).toHaveBeenCalledWith({ kind: "mixed", itemIds: [text.id, image.id] });
    expect(d.pasteSingle).not.toHaveBeenCalled();
    expect(d.pasteContent).not.toHaveBeenCalled();
    expect(d.closeShelf).not.toHaveBeenCalled();
  });

  it("retains an unavailable selection instead of partially pasting remaining records", async () => {
    const { dependencies: d, controller } = setup();
    await controller.paste([text.id, "expired-record"]);
    expect(d.showNotice).toHaveBeenCalledWith(expect.objectContaining({ kind: "error", message: expect.stringContaining("1 项") }));
    expect(d.pasteSingle).not.toHaveBeenCalled();
    expect(d.pasteContent).not.toHaveBeenCalled();
    expect(d.closeShelf).not.toHaveBeenCalled();
  });

  it("rejects a lookup result for a different record", async () => {
    const { dependencies: d, controller } = setup({ resolveItem: async () => image });
    await controller.paste([text.id]);
    expect(d.showNotice).toHaveBeenCalledWith(expect.objectContaining({ kind: "error" }));
    expect(d.pasteSingle).not.toHaveBeenCalled();
  });

  it("coalesces repeated Enter while resolving a selection", async () => {
    let resolve!: (value: unknown) => void;
    const { dependencies: d, controller } = setup({ resolveItem: () => new Promise(done => { resolve = done; }) });
    const first = controller.paste([text.id]);
    await controller.paste([text.id]);
    resolve(text);
    await first;
    expect(d.pasteSingle).toHaveBeenCalledExactlyOnceWith(text.id, false);
  });

  it("keeps the shelf open and exposes an error if combined paste is unavailable", async () => {
    const other = { ...text, id: "second-text" };
    const { dependencies: d, controller } = setup({
      resolveItem: async id => id === text.id ? text : other,
      pasteContent: vi.fn(async () => undefined),
    });
    await controller.paste([text.id, other.id]);
    expect(d.showNotice).toHaveBeenCalledWith(expect.objectContaining({ kind: "error" }));
    expect(d.closeShelf).not.toHaveBeenCalled();
  });

  it("keeps plain-text mode from looping over binary mixed selections", async () => {
    const { dependencies: d, controller } = setup();
    await controller.paste([text.id, image.id], true);
    expect(d.showNotice).toHaveBeenCalledWith(expect.objectContaining({ kind: "mixed" }));
    expect(d.pasteSingle).not.toHaveBeenCalled();
  });
});
