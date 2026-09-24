import { afterEach, describe, expect, it, vi } from "vitest";
import {
  base64ToUint8Array,
  downloadBase64,
  downloadSvgMarkup,
  downloadText,
  triggerBlobDownload,
} from "../artifacts/download";

describe("base64ToUint8Array", () => {
  it("decodes plain base64", () => {
    // "hi" → aGk=
    const bytes = base64ToUint8Array("aGk=");
    expect(Array.from(bytes)).toEqual([104, 105]);
  });

  it("strips data URL prefix and whitespace", () => {
    const bytes = base64ToUint8Array("data:image/png;base64, aGk=");
    expect(Array.from(bytes)).toEqual([104, 105]);
  });
});

describe("triggerBlobDownload / download helpers", () => {
  const clicks: string[] = [];
  let created: HTMLAnchorElement | null = null;

  afterEach(() => {
    clicks.length = 0;
    created = null;
    vi.restoreAllMocks();
  });

  it("triggerBlobDownload sets download attr and clicks", () => {
    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });

    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === "a") {
        created = el as HTMLAnchorElement;
        vi.spyOn(el, "click").mockImplementation(() => {
          clicks.push((el as HTMLAnchorElement).download);
        });
      }
      return el;
    });

    triggerBlobDownload(new Blob(["x"], { type: "text/plain" }), "a.txt");
    expect(createObjectURL).toHaveBeenCalled();
    expect(clicks).toEqual(["a.txt"]);
    expect(created?.rel).toBe("noopener");
  });

  it("downloadText and downloadSvgMarkup produce downloads", () => {
    const createObjectURL = vi.fn(() => "blob:t");
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL: vi.fn(),
    });
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === "a") {
        vi.spyOn(el, "click").mockImplementation(() => {
          clicks.push((el as HTMLAnchorElement).download);
        });
      }
      return el;
    });

    downloadText("hello", "text/plain", "n.txt");
    expect(clicks[clicks.length - 1]).toBe("n.txt");

    downloadSvgMarkup("<svg></svg>", "d.svg");
    expect(clicks[clicks.length - 1]).toBe("d.svg");

    downloadSvgMarkup("circle", "wrap.svg");
    expect(clicks[clicks.length - 1]).toBe("wrap.svg");
  });

  it("downloadBase64 decodes then downloads", () => {
    const createObjectURL = vi.fn(() => "blob:b");
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL: vi.fn(),
    });
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === "a") {
        vi.spyOn(el, "click").mockImplementation(() => {
          clicks.push((el as HTMLAnchorElement).download);
        });
      }
      return el;
    });

    downloadBase64("aGk=", "text/plain", "hi.txt");
    expect(clicks).toEqual(["hi.txt"]);
    expect(createObjectURL).toHaveBeenCalled();
  });
});
