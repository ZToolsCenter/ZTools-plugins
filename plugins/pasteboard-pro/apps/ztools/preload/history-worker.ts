import { parentPort } from "node:worker_threads";
import { HistorySearchIndex } from "./history-search-index";
import type { HistoryRequest } from "./history-page";

const index = new HistorySearchIndex();
parentPort?.on("message", (message: {
  id: number;
  type: "replace" | "update" | "page" | "order";
  documents?: unknown[];
  removed?: string[];
  request?: HistoryRequest;
}) => {
  try {
    let value: unknown;
    if (message.type === "replace") index.replace(message.documents ?? []);
    else if (message.type === "update") index.update(message.documents ?? [], message.removed ?? []);
    else value = message.type === "order" ? index.order(message.request ?? {}) : index.page(message.request ?? {});
    parentPort?.postMessage({ id: message.id, value });
  } catch (error) {
    parentPort?.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) });
  }
});
