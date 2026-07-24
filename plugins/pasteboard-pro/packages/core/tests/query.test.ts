import { describe, expect, it } from "vitest";

import {
  parsePasteQuery,
  searchPasteItems,
  type PasteItem,
} from "../src/index";

const NOW = new Date("2026-07-16T12:00:00.000Z");

function makeItem(
  id: string,
  overrides: Partial<PasteItem> = {},
): PasteItem {
  return {
    id,
    kind: "text",
    sourceDeviceId: "mac-default",
    copiedAt: "2026-07-16T10:00:00.000Z",
    updatedAt: "2026-07-16T10:00:00.000Z",
    contentFingerprint: `fingerprint-${id}`,
    payload: { revision: `revision-${id}` },
    pinned: false,
    fieldClocks: {},
    ...overrides,
  };
}

describe("parsePasteQuery", () => {
  it("parses text and filters with every array field present", () => {
    expect(
      parsePasteQuery('roadmap type:image app:"Preview" date:week'),
    ).toEqual({
      text: ["roadmap"],
      types: ["image"],
      apps: ["Preview"],
      devices: [],
      dates: ["week"],
      pinboards: [],
    });
  });

  it("supports aliases, quoted values, case-insensitive keys, and unknown text", () => {
    expect(
      parsePasteQuery(
        'FROM:"Visual Studio Code" device:mac-a BOARD:"board 1" foo:bar misc:"Keep Together" TyPe:image',
      ),
    ).toEqual({
      text: ["foo:bar", "misc:keep together"],
      types: ["image"],
      apps: ["Visual Studio Code"],
      devices: ["mac-a"],
      dates: [],
      pinboards: ["board 1"],
    });
  });

  it("keeps bare quoted phrases as one term and empty filters as text", () => {
    expect(parsePasteQuery('"Quarterly Roadmap" APP: type:')).toEqual({
      text: ["quarterly roadmap", "app:", "type:"],
      types: [],
      apps: [],
      devices: [],
      dates: [],
      pinboards: [],
    });
  });

  it("keeps a quoted URL phrase containing a colon as text", () => {
    expect(parsePasteQuery('"https://example.com/a b"')).toEqual({
      text: ["https://example.com/a b"],
      types: [],
      apps: [],
      devices: [],
      dates: [],
      pinboards: [],
    });
  });
});

describe("searchPasteItems", () => {
  it("scores text matches and uses copiedAt to break equal-score ties", () => {
    const items = [
      makeItem("title-old", {
        title: "Invoice archive",
        copiedAt: "2026-07-14T10:00:00.000Z",
      }),
      makeItem("payload-newest", {
        copiedAt: "2026-07-16T11:00:00.000Z",
        payload: { revision: "r-payload", text: "Invoice body" },
      }),
      makeItem("title-new", {
        title: "Latest invoice",
        copiedAt: "2026-07-15T10:00:00.000Z",
      }),
      makeItem("ocr", {
        copiedAt: "2026-07-16T12:00:00.000Z",
        ocrText: "scanned invoice",
      }),
    ];

    expect(searchPasteItems(items, "invoice").map(({ id }) => id)).toEqual([
      "title-new",
      "title-old",
      "payload-newest",
      "ocr",
    ]);
  });

  it("returns an empty query newest-first and remains stable for exact ties", () => {
    const items = [
      makeItem("same-time-first", {
        copiedAt: "2026-07-15T10:00:00.000Z",
      }),
      makeItem("newest", { copiedAt: "2026-07-16T10:00:00.000Z" }),
      makeItem("same-time-second", {
        copiedAt: "2026-07-15T10:00:00.000Z",
      }),
    ];
    const original = structuredClone(items);

    expect(searchPasteItems(items, "").map(({ id }) => id)).toEqual([
      "newest",
      "same-time-first",
      "same-time-second",
    ]);
    expect(items).toEqual(original);
  });

  it("ORs values within a filter category and ANDs different categories", () => {
    const items = [
      makeItem("image-preview", {
        kind: "image",
        sourceApp: { name: "Preview", bundleId: "com.apple.Preview" },
        sourceDeviceId: "mac-a",
        pinboardId: "board-1",
      }),
      makeItem("pdf-chrome", {
        kind: "pdf",
        sourceApp: { name: "Google Chrome", bundleId: "com.google.Chrome" },
        sourceDeviceId: "mac-b",
        pinboardId: "board-1",
      }),
      makeItem("wrong-type", {
        kind: "text",
        sourceApp: { name: "Preview" },
        sourceDeviceId: "mac-a",
        pinboardId: "board-1",
      }),
      makeItem("wrong-app", {
        kind: "image",
        sourceApp: { name: "Photos" },
        sourceDeviceId: "mac-a",
        pinboardId: "board-1",
      }),
      makeItem("wrong-device", {
        kind: "image",
        sourceApp: { name: "Preview" },
        sourceDeviceId: "iphone-a",
        pinboardId: "board-1",
      }),
      makeItem("wrong-board", {
        kind: "image",
        sourceApp: { name: "Preview" },
        sourceDeviceId: "mac-a",
        pinboardId: "board-2",
      }),
    ];

    expect(
      searchPasteItems(
        items,
        "type:IMAGE type:pdf app:preview app:chrome device:mac-a device:mac-b board:BOARD-1",
      ).map(({ id }) => id),
    ).toEqual(["image-preview", "pdf-chrome"]);
  });

  it("supports UTC relative and exact date filters with an injected clock", () => {
    const items = [
      makeItem("today", { copiedAt: "2026-07-16T00:00:00.000Z" }),
      makeItem("week", { copiedAt: "2026-07-10T12:00:00.000Z" }),
      makeItem("too-old-for-week", {
        copiedAt: "2026-07-09T11:59:59.999Z",
      }),
      makeItem("month", { copiedAt: "2026-06-20T12:00:00.000Z" }),
      makeItem("too-old-for-month", {
        copiedAt: "2026-06-16T11:59:59.999Z",
      }),
      makeItem("exact-date", { copiedAt: "2026-07-01T23:59:59.999Z" }),
      makeItem("future", { copiedAt: "2026-07-17T12:00:00.000Z" }),
    ];

    const weekResults = searchPasteItems(items, "date:week", {
      now: NOW,
    }).map(({ id }) => id);
    const monthResults = searchPasteItems(items, "date:month", {
      now: NOW,
    }).map(({ id }) => id);

    expect(
      searchPasteItems(items, "date:today", { now: NOW }).map(({ id }) => id),
    ).toEqual(["today"]);
    expect(weekResults).not.toContain("future");
    expect(weekResults).toEqual(["today", "week"]);
    expect(monthResults).not.toContain("future");
    expect(monthResults).toEqual([
      "today",
      "week",
      "too-old-for-week",
      "exact-date",
      "month",
    ]);
    expect(
      searchPasteItems(items, "date:2026-07-01", { now: NOW }).map(
        ({ id }) => id,
      ),
    ).toEqual(["exact-date"]);
    expect(searchPasteItems(items, "date:someday", { now: NOW })).toEqual([]);
  });

  it.each([
    ["title", { title: "needle" }],
    [
      "URL payload text",
      { kind: "url", payload: { revision: "r-url-text", text: "https://needle.test" } },
    ],
    [
      "URL payload html",
      { kind: "url", payload: { revision: "r-url-html", html: '<a href="https://needle.test">link</a>' } },
    ],
    ["source app name", { sourceApp: { name: "Needle App" } }],
    ["source app bundle id", { sourceApp: { bundleId: "com.needle.app" } }],
    ["source device", { sourceDeviceId: "needle-mac" }],
    [
      "file path including filename and extension",
      { payload: { revision: "r-file", filePaths: ["/tmp/needle.pdf"] } },
    ],
    ["OCR text", { ocrText: "needle scan" }],
    [
      "media type",
      { payload: { revision: "r-media", mediaType: "image/needle" } },
    ],
  ] satisfies Array<[string, Partial<PasteItem>]>) (
    "searches %s",
    (_label, overrides) => {
      const matching = makeItem("matching", overrides);
      const unrelated = makeItem("unrelated");

      expect(
        searchPasteItems([unrelated, matching], "NeEdLe").map(({ id }) => id),
      ).toEqual(["matching"]);
    },
  );

  it("ANDs ordinary terms even when each term matches a different field", () => {
    const items = [
      makeItem("all-terms", {
        title: "Roadmap",
        sourceApp: { name: "Preview" },
        payload: { revision: "r-all", text: "Quarterly Plan" },
      }),
      makeItem("missing-phrase", {
        title: "Roadmap",
        sourceApp: { name: "Preview" },
      }),
    ];

    expect(
      searchPasteItems(items, 'roadmap preview "quarterly plan"').map(
        ({ id }) => id,
      ),
    ).toEqual(["all-terms"]);
  });

  it("searches a quoted URL phrase containing a colon", () => {
    const items = [
      makeItem("matching", {
        payload: {
          revision: "r-matching",
          text: "Open https://example.com/a b for details",
        },
      }),
      makeItem("unrelated", {
        payload: { revision: "r-unrelated", text: "No matching URL here" },
      }),
    ];

    expect(
      searchPasteItems(items, '"https://example.com/a b"').map(({ id }) => id),
    ).toEqual(["matching"]);
  });
});
