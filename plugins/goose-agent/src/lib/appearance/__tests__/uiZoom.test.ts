import { afterEach, describe, expect, it } from "vitest";
import {
  applyUiZoom,
  clampUiZoom,
  UI_ZOOM_DEFAULT,
  UI_ZOOM_MAX,
  UI_ZOOM_MIN,
} from "../uiZoom";

describe("clampUiZoom", () => {
  it("defaults invalid values", () => {
    expect(clampUiZoom(undefined)).toBe(UI_ZOOM_DEFAULT);
    expect(clampUiZoom(null)).toBe(UI_ZOOM_DEFAULT);
    expect(clampUiZoom(Number.NaN)).toBe(UI_ZOOM_DEFAULT);
    expect(clampUiZoom("1" as unknown as number)).toBe(UI_ZOOM_DEFAULT);
  });

  it("clamps and steps to 0.1", () => {
    expect(clampUiZoom(0.5)).toBe(UI_ZOOM_MIN);
    expect(clampUiZoom(2)).toBe(UI_ZOOM_MAX);
    expect(clampUiZoom(1.04)).toBe(1);
    expect(clampUiZoom(1.06)).toBe(1.1);
    expect(clampUiZoom(0.85)).toBe(0.9);
  });
});

describe("applyUiZoom", () => {
  afterEach(() => {
    const html = document.documentElement;
    html.style.removeProperty("--ui-zoom");
    html.style.removeProperty("zoom");
    html.style.removeProperty("width");
    html.style.removeProperty("height");
    document.body.style.removeProperty("height");
    document.body.style.removeProperty("width");
    const appRoot = document.getElementById("root");
    if (appRoot) {
      (appRoot.style as CSSStyleDeclaration & { zoom?: string }).removeProperty(
        "zoom",
      );
      appRoot.style.removeProperty("width");
      appRoot.style.removeProperty("height");
      appRoot.remove();
    }
  });

  it("at zoom 1 keeps html clean and #root at 100%", () => {
    const appRoot = document.createElement("div");
    appRoot.id = "root";
    document.body.appendChild(appRoot);

    applyUiZoom(1);

    const html = document.documentElement;
    expect(html.style.getPropertyValue("--ui-zoom")).toBe("1");
    expect((html.style as CSSStyleDeclaration & { zoom?: string }).zoom).toBe(
      "",
    );
    expect(html.style.width).toBe("");
    expect(html.style.height).toBe("100%");
    expect(document.body.style.height).toBe("100%");
    expect(document.body.style.width).toBe("100%");
    expect(
      (appRoot.style as CSSStyleDeclaration & { zoom?: string }).zoom,
    ).toBe("");
    expect(appRoot.style.width).toBe("100%");
    expect(appRoot.style.height).toBe("100%");
  });

  it("at zoom 0.9 applies zoom and vw/vh compensation on #root only", () => {
    const appRoot = document.createElement("div");
    appRoot.id = "root";
    document.body.appendChild(appRoot);

    applyUiZoom(0.9);

    const html = document.documentElement;
    expect(html.style.getPropertyValue("--ui-zoom")).toBe("0.9");
    expect((html.style as CSSStyleDeclaration & { zoom?: string }).zoom).toBe(
      "",
    );
    expect(
      (appRoot.style as CSSStyleDeclaration & { zoom?: string }).zoom,
    ).toBe("0.9");
    expect(appRoot.style.width).toBe(`${100 / 0.9}vw`);
    expect(appRoot.style.height).toBe(`${100 / 0.9}vh`);
    expect(document.body.style.height).toBe("100%");
  });
});
