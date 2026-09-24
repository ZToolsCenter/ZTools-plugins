/** 整体界面缩放。干什么：clamp/步进/应用 zoom。怎么跑：import applyUiZoom。需要：DOM。 */
export const UI_ZOOM_MIN = 0.8;
export const UI_ZOOM_MAX = 1.4;
export const UI_ZOOM_STEP = 0.1;
export const UI_ZOOM_DEFAULT = 1;

export function clampUiZoom(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return UI_ZOOM_DEFAULT;
  const stepped = Math.round(value / UI_ZOOM_STEP) * UI_ZOOM_STEP;
  const clamped = Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, stepped));
  return Math.round(clamped * 100) / 100;
}

export function applyUiZoom(zoom: number): void {
  if (typeof document === "undefined") return;
  const z = clampUiZoom(zoom);
  const html = document.documentElement;
  html.style.setProperty("--ui-zoom", String(z));
  html.style.removeProperty("zoom");
  html.style.removeProperty("width");
  html.style.height = "100%";

  document.body.style.height = "100%";
  document.body.style.width = "100%";

  const appRoot = document.getElementById("root");
  if (!appRoot) return;

  const rootStyle = appRoot.style as CSSStyleDeclaration & { zoom?: string };
  if (z === 1) {
    rootStyle.removeProperty("zoom");
    appRoot.style.width = "100%";
    appRoot.style.height = "100%";
  } else {
    rootStyle.zoom = String(z);
    appRoot.style.width = `${100 / z}vw`;
    appRoot.style.height = `${100 / z}vh`;
  }
}
