import path from "node:path";

import type { CanonicalClipboardRecord } from "./clipboard-store";

type NativeFileDragHost = Readonly<{
  startDrag(file: string | string[]): void;
}>;

type NativeFileDragStore = Readonly<{
  findRecordByItemId(itemId: string): Promise<CanonicalClipboardRecord | undefined>;
}>;

export class NativeFileDragService {
  private readonly paths = new Map<string, string[]>();

  constructor(
    private readonly store: NativeFileDragStore,
    private readonly host: NativeFileDragHost,
  ) {}

  refresh(records: readonly CanonicalClipboardRecord[]): void {
    this.paths.clear();
    for (const record of records) {
      this.cache(record);
    }
  }

  async prepare(itemId: string): Promise<boolean> {
    const record = await this.store.findRecordByItemId(itemId);
    return record === undefined ? false : this.cache(record);
  }

  start(itemId: string): boolean {
    const filePaths = this.paths.get(itemId);
    if (filePaths === undefined) return false;
    try {
      this.host.startDrag(filePaths.length === 1 ? filePaths[0]! : [...filePaths]);
      return true;
    } catch {
      this.paths.delete(itemId);
      return false;
    }
  }

  private cache(record: CanonicalClipboardRecord): boolean {
    const candidates =
      record.item.kind === "image" && record.origin.imagePath !== undefined
        ? [record.origin.imagePath]
        : record.item.payload.filePaths;
    const filePaths = [...new Set(candidates ?? [])];
    if (filePaths.length === 0 || filePaths.some((filePath) => !path.isAbsolute(filePath))) {
      this.paths.delete(record.item.id);
      return false;
    }
    this.paths.set(record.item.id, filePaths);
    return true;
  }
}
