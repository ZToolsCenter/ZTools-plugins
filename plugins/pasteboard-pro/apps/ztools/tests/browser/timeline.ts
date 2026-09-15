import { createApp, h, nextTick, ref, shallowRef } from "vue";
import Timeline from "../../src/components/Timeline.vue";
import { reorderItemGroupIds, type ListReorderRequest } from "../../src/list-order";
import type { PasteItem } from "@pasteboard-pro/core";
import "../../src/styles/tokens.css";
import "../../src/styles/layout.css";

const params = new URLSearchParams(location.search);
const count = Number(params.get("count") ?? 10000);
const vertical = ref(params.get("vertical") === "1");
const compact = ref(params.get("compact") === "1");
const image = params.get("images") === "1";
const makeItem = (index: number): PasteItem => ({
  id: `item-${index}`, kind: image ? "image" : "text", title: `Record ${index}`,
  sourceDeviceId: "test", copiedAt: new Date(1800000000000 - index).toISOString(),
  updatedAt: new Date(1800000000000 - index).toISOString(),
  contentFingerprint: `sha256:${index}`, payload: {
    revision: String(index), ...(image ? { blobId: `blob-${index}`, mediaType: "image/png" } : { text: `Clipboard record ${index}` }),
  }, pinned: false, fieldClocks: {},
});
const items = shallowRef(Array.from({ length: count }, (_, index) => makeItem(index)));
const selected = ref<string[]>([]);
const focused = ref<string>();
const timeline = ref<{ focusItem(itemId: string): Promise<void> }>();
const thumbnailIds: string[] = [];
const latest: string[] = [];
(window as any).pasteboardPro = {
  getPlatformCapabilities: () => ({ platform: "darwin" }),
  prepareNativeFileDrag: async () => false,
  getItemThumbnails: async (ids: string[]) => { thumbnailIds.push(...ids); return []; },
};
const started = performance.now();
createApp({
  setup: () => () => h("div", {
    style: {
      "--pb-card-width": compact.value ? "180px" : "240px",
      width: vertical.value ? "360px" : "100%",
      height: vertical.value ? "650px" : "200px",
      display: "grid", minHeight: 0,
    },
  }, [h(Timeline, {
    ref: timeline, items: items.value, selectedIds: selected.value,
    focusedId: focused.value, vertical: vertical.value, compact: compact.value, pinboards: [],
    onSelect: (id: string, extend: boolean, toggle: boolean) => {
      if (extend && focused.value !== undefined) {
        const a = items.value.findIndex((item) => item.id === focused.value);
        const b = items.value.findIndex((item) => item.id === id);
        selected.value = items.value.slice(Math.min(a, b), Math.max(a, b) + 1).map((item) => item.id);
      } else if (toggle) {
        selected.value = selected.value.includes(id) ? selected.value.filter((value) => value !== id) : [...selected.value, id];
      } else selected.value = [id];
      focused.value = id;
    },
    onLatestVisible: (id: string) => latest.push(id),
    onReorder: ({ sourceIds, targetId, position }: ListReorderRequest) => {
      const byId = new Map(items.value.map((item) => [item.id, item]));
      items.value = reorderItemGroupIds(items.value.map((item) => item.id), sourceIds, targetId, position)
        .map((id) => byId.get(id)!);
    },
  })]),
}).mount("#app");
(window as any).timelineTest = {
  thumbnailIds, latest,
  ids: () => items.value.map((item) => item.id),
  selected: () => selected.value,
  replace: (count: number) => { items.value = Array.from({ length: count }, (_, i) => makeItem(i)); },
  prepend: () => { items.value = [makeItem(-1), ...items.value]; },
  remove: (id: string) => { items.value = items.value.filter((item) => item.id !== id); },
  select: (ids: string[]) => { selected.value = ids; },
  density: (value: boolean) => { compact.value = value; },
  focus: async (index: number) => {
    focused.value = items.value[index]!.id;
    selected.value = [focused.value];
    await nextTick();
    await timeline.value?.focusItem(focused.value);
  },
  ready: false, mountMs: 0,
};
await nextTick();
await new Promise(requestAnimationFrame);
(window as any).timelineTest.mountMs = performance.now() - started;
(window as any).timelineTest.ready = true;
