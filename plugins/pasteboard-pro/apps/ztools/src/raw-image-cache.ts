import type { ImageEditState } from "./theme-image-edit";

export type CachedThemeImage = Readonly<{
  rawImageDataUrl: string;
  editState?: ImageEditState | undefined;
}>;

const DB_NAME = "pasteboard-pro-local-cache";
const STORE_NAME = "theme-assets";
const RAW_KEY = "raw-background-image";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveRawBackgroundImage(
  rawImageDataUrl: string,
  editState?: ImageEditState | undefined,
): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const record: CachedThemeImage = { rawImageDataUrl, editState };
    tx.objectStore(STORE_NAME).put(record, RAW_KEY);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = reject;
    });
  } catch (err) {
    console.warn("Could not cache raw background image", err);
  }
}

export async function getRawBackgroundImage(): Promise<CachedThemeImage | undefined> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(RAW_KEY);
    return await new Promise((resolve, reject) => {
      req.onsuccess = () => {
        const val = req.result;
        if (!val) {
          resolve(undefined);
          return;
        }
        if (typeof val === "string") {
          resolve({ rawImageDataUrl: val });
        } else {
          resolve(val as CachedThemeImage);
        }
      };
      req.onerror = reject;
    });
  } catch {
    return undefined;
  }
}

export async function clearRawBackgroundImage(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(RAW_KEY);
  } catch {}
}
