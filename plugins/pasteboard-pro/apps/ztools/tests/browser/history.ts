import type { HistoryPage, HistoryRequest } from "../../preload/history-page";

const worker = new Worker(new URL("./history-worker.ts", import.meta.url), { type: "module" });
let sequence = 0;
const pending = new Map<number, (page: HistoryPage) => void>();
const metrics = { requests: [] as HistoryRequest[], sizes: [] as number[], prepend: false };
worker.onmessage = (event: MessageEvent<{ id: number; page: HistoryPage }>) => {
  metrics.sizes.push(event.data.page.items.length);
  pending.get(event.data.id)?.(event.data.page);
  pending.delete(event.data.id);
};
(window as Window & { historyTest?: typeof metrics }).historyTest = metrics;
window.pasteboardPro = {
  getHostCompatibility: () => ({ supported: true }),
  getPlatformCapabilities: () => ({ platform: "darwin" }),
  getWindowPreferences: async () => undefined,
  getPrivacySettings: async () => ({ pause: { paused: false } }),
  getListOrders: async () => ({}),
  getPasteStack: async () => undefined,
  getItemThumbnails: async () => [],
  prepareNativeFileDrag: async () => false,
  listPinboards: async () => [],
  searchHistoryPage: (request: HistoryRequest) => new Promise<HistoryPage>(resolve => {
    metrics.requests.push(request);
    const id = ++sequence;
    pending.set(id, resolve);
    worker.postMessage({ id, request, prepend: metrics.prepend });
    metrics.prepend = false;
  }),
} as unknown as NonNullable<Window["pasteboardPro"]>;
await import("../../src/main");
