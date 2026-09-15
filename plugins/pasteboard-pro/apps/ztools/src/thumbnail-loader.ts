type ThumbnailResult = Readonly<{
  itemId: string;
  mediaType: string;
  dataBase64: string;
}>;

type PendingThumbnail = Readonly<{
  itemId: string;
  resolve(value: string | undefined): void;
}>;

const urlCache = new Map<string, Promise<string | undefined>>();
const pending = new Map<string, PendingThumbnail>();
const visibilityCallbacks = new WeakMap<Element, () => void>();
const MAX_URL_CACHE_ENTRIES = 64;
const MAX_BATCH_SIZE = 24;
let flushScheduled = false;
let visibilityObserver: IntersectionObserver | undefined;

function remember(key: string, value: Promise<string | undefined>): void {
  urlCache.set(key, value);
  while (urlCache.size > MAX_URL_CACHE_ENTRIES) {
    const oldest = urlCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    urlCache.delete(oldest);
  }
}

async function flush(): Promise<void> {
  flushScheduled = false;
  const values = [...pending.entries()].slice(0, MAX_BATCH_SIZE);
  for (const [key] of values) pending.delete(key);
  if (pending.size > 0) scheduleFlush();

  let thumbnails: ThumbnailResult[];
  try {
    thumbnails =
      (await window.pasteboardPro?.getItemThumbnails(
        values.map(([, value]) => value.itemId),
      )) ?? [];
  } catch {
    for (const [, value] of values) value.resolve(undefined);
    return;
  }
  const byId = new Map(
    thumbnails.map((thumbnail: ThumbnailResult) => [thumbnail.itemId, thumbnail] as const),
  );
  for (const [, value] of values) {
    const thumbnail = byId.get(value.itemId);
    value.resolve(
      thumbnail === undefined
        ? undefined
        : `data:${thumbnail.mediaType};base64,${thumbnail.dataBase64}`,
    );
  }
}

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(() => {
    void flush().catch(() => {
      flushScheduled = false;
      for (const [, value] of pending) value.resolve(undefined);
      pending.clear();
    });
  });
}

export function loadItemThumbnail(
  itemId: string,
  revision: string,
): Promise<string | undefined> {
  const key = `${itemId}\u0000${revision}`;
  const cached = urlCache.get(key);
  if (cached !== undefined) {
    urlCache.delete(key);
    urlCache.set(key, cached);
    return cached;
  }

  const value = new Promise<string | undefined>((resolve) => {
    pending.set(key, { itemId, resolve });
    scheduleFlush();
  });
  remember(key, value);
  return value;
}

export function observeThumbnailVisibility(
  element: Element,
  callback: () => void,
): () => void {
  if (typeof IntersectionObserver === "undefined") {
    callback();
    return () => {};
  }
  visibilityObserver ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const visible = visibilityCallbacks.get(entry.target);
        visibilityCallbacks.delete(entry.target);
        visibilityObserver?.unobserve(entry.target);
        visible?.();
      }
    },
    { rootMargin: "160px" },
  );
  visibilityCallbacks.set(element, callback);
  visibilityObserver.observe(element);
  return () => {
    visibilityCallbacks.delete(element);
    visibilityObserver?.unobserve(element);
  };
}
