import { describe, expect, it } from "vitest";
import { mergeModelOptionsPreservingMeta } from "../modelCatalog";
import type { AIModelOption } from "../types";

describe("mergeModelOptionsPreservingMeta", () => {
  it("returns fetched as-is when previous is empty", () => {
    const fetched: AIModelOption[] = [
      { id: "a", label: "A", description: "desc" },
    ];
    expect(mergeModelOptionsPreservingMeta(fetched, [])).toEqual(fetched);
  });

  it("preserves previous supportsVision when fetched has no boolean", () => {
    const fetched: AIModelOption[] = [
      { id: "gpt-4o", label: "GPT-4o (remote)", description: "new", contextWindow: 128000 },
      { id: "new-model", label: "New" },
    ];
    const previous: AIModelOption[] = [
      { id: "gpt-4o", label: "GPT-4o", supportsVision: true },
      { id: "gone", label: "Gone", supportsVision: false },
    ];

    const merged = mergeModelOptionsPreservingMeta(fetched, previous);

    expect(merged).toEqual([
      {
        id: "gpt-4o",
        label: "GPT-4o (remote)",
        description: "new",
        contextWindow: 128000,
        supportsVision: true,
      },
      { id: "new-model", label: "New" },
    ]);
  });

  it("preserves supportsVision false from previous", () => {
    const fetched: AIModelOption[] = [{ id: "m", label: "M-remote" }];
    const previous: AIModelOption[] = [
      { id: "m", label: "M", supportsVision: false },
    ];

    expect(mergeModelOptionsPreservingMeta(fetched, previous)).toEqual([
      { id: "m", label: "M-remote", supportsVision: false },
    ]);
  });

  it("uses fetched supportsVision when fetched provides boolean", () => {
    const fetched: AIModelOption[] = [
      { id: "m", label: "M-remote", supportsVision: false },
    ];
    const previous: AIModelOption[] = [
      { id: "m", label: "M", supportsVision: true },
    ];

    expect(mergeModelOptionsPreservingMeta(fetched, previous)).toEqual([
      { id: "m", label: "M-remote", supportsVision: false },
    ]);
  });

  it("does not invent supportsVision when neither side has boolean", () => {
    const fetched: AIModelOption[] = [{ id: "m", label: "M-remote" }];
    const previous: AIModelOption[] = [{ id: "m", label: "M" }];

    expect(mergeModelOptionsPreservingMeta(fetched, previous)).toEqual([
      { id: "m", label: "M-remote" },
    ]);
  });

  it("uses fetched id/label/description/contextWindow as source of truth", () => {
    const fetched: AIModelOption[] = [
      {
        id: "x",
        label: "X-new",
        description: "d2",
        contextWindow: 200,
      },
    ];
    const previous: AIModelOption[] = [
      {
        id: "x",
        label: "X-old",
        description: "d1",
        contextWindow: 100,
        supportsVision: true,
      },
    ];

    expect(mergeModelOptionsPreservingMeta(fetched, previous)[0]).toMatchObject({
      id: "x",
      label: "X-new",
      description: "d2",
      contextWindow: 200,
      supportsVision: true,
    });
  });
});
