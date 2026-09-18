import { HistorySearchIndex } from "../../preload/history-search-index";
import type { HistoryRequest } from "../../preload/history-page";
import type { PasteItem } from "@pasteboard-pro/core";

function item(i: number): PasteItem {
  return {
    id: `item-${i}`, kind: "text", title: `Record ${i}`,
    sourceDeviceId: "test", copiedAt: new Date(1_800_000_000_000 - i).toISOString(),
    updatedAt: new Date(1_800_000_000_000 - i).toISOString(),
    contentFingerprint: `sha256:${i}`, payload: {
      revision: String(i), text: i === 99_999 ? "x".repeat(8_192) + " 中文尾部命中" : `Clipboard ${i}`,
    }, pinned: false, fieldClocks: {},
  };
}
const index = new HistorySearchIndex();
function document(i: number) {
  return { _id: `pasteboard-pro:record:sha256:${i}`, type: "pasteboard-pro-record",
    record: { item: item(i), origin: { host: "sync", remoteAvailable: true } } };
}
index.replace(Array.from({ length: 100_000 }, (_, i) => document(i)));
globalThis.onmessage = (event: MessageEvent<{ id: number; request: HistoryRequest; prepend?: boolean }>) => {
  if (event.data.prepend) index.update([document(-1)], []);
  globalThis.postMessage({ id: event.data.id, page: index.page(event.data.request) });
};
