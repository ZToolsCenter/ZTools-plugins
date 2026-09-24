const READY_EVENT = "pasteboard-pro:window-ready";
const READY_ATTRIBUTE = "data-pasteboard-ready";

// The host callback only guarantees DOM readiness. Wait for Vue's initial data
// and theme to be committed, including when they finish before this script runs.
export const waitForWindowReadyScript = `new Promise((resolve) => {
  if (document.documentElement.hasAttribute('${READY_ATTRIBUTE}')) resolve(true);
  else window.addEventListener('${READY_EVENT}', () => resolve(true), { once: true });
})`;

export function markWindowReady(): void {
  document.documentElement.setAttribute(READY_ATTRIBUTE, "true");
  window.dispatchEvent(new Event(READY_EVENT));
}
