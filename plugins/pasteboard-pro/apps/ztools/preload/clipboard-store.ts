import { ClipboardRecordStore } from "./clipboard-record-store";
import {
  assignToPinboard as assignToPinboardCommand,
  deleteRecords as deleteRecordsCommand,
  restoreRecords as restoreRecordsCommand,
} from "./clipboard-record-groups";
import {
  createTextItem as createTextItemCommand,
  updateImagePayload as updateImagePayloadCommand,
  updateItemTitle as updateItemTitleCommand,
  updateOcrText as updateOcrTextCommand,
  updateTextItem as updateTextItemCommand,
} from "./clipboard-record-commands";
import type {
  CanonicalClipboardRecord,
  CanonicalClipboardStore,
  ClipboardCommandPort,
  ClipboardGroupPort,
  DeleteRecordsResult,
} from "./clipboard-store-types";

export type {
  CanonicalClipboardOrigin,
  CanonicalClipboardRecord,
  CanonicalClipboardStore,
  CanonicalStoreOptions,
  DeleteRecordsResult,
  HostClipboardApi,
  HostCursor,
  MirrorHostHistoryOptions,
  MirrorHostHistoryResult,
  ZToolsDocumentDatabase,
} from "./clipboard-store-types";
export { documentsFromAllDocs } from "./clipboard-document-database";
export { MAX_CLIPBOARD_TEXT_BYTES, storedRecord } from "./clipboard-record-codec";
export { normalizeHostClipboardItem } from "./clipboard-host-normalization";
export { mirrorHostHistory } from "./clipboard-history-mirror";

export class ZToolsCanonicalClipboardStore
  extends ClipboardRecordStore
  implements CanonicalClipboardStore
{
  private commandPort(): ClipboardCommandPort {
    return {
      deviceId: this.deviceId,
      validTimestamp: () => this.validTimestamp(),
      findRecordByItemId: (itemId) => this.findRecordByItemId(itemId),
      listRecords: () => this.listRecords(),
      put: (record) => this.put(record),
    };
  }

  private groupPort(): ClipboardGroupPort {
    return {
      ...this.commandPort(),
      database: this.database,
      recordDocumentId: (fingerprint) => this.recordDocumentId(fingerprint),
    };
  }

  async createTextItem(
    text: string,
    title?: string,
    pinboardId?: string,
  ): Promise<CanonicalClipboardRecord> {
    return createTextItemCommand(this.commandPort(), text, title, pinboardId);
  }

  async updateTextItem(
    itemId: string,
    text: string,
    title?: string,
  ): Promise<CanonicalClipboardRecord> {
    return updateTextItemCommand(this.commandPort(), itemId, text, title);
  }

  async updateItemTitle(
    itemId: string,
    title: string,
  ): Promise<CanonicalClipboardRecord> {
    return updateItemTitleCommand(this.commandPort(), itemId, title);
  }

  async deleteRecords(itemIds: readonly string[]): Promise<DeleteRecordsResult> {
    return deleteRecordsCommand(this.groupPort(), itemIds);
  }

  async assignToPinboard(
    itemIds: readonly string[],
    pinboardId: string | undefined,
  ): Promise<CanonicalClipboardRecord[]> {
    return assignToPinboardCommand(this.groupPort(), itemIds, pinboardId);
  }

  async restoreRecords(records: readonly CanonicalClipboardRecord[]): Promise<void> {
    await restoreRecordsCommand(this.groupPort(), records);
  }

  async updateOcrText(
    itemId: string,
    ocrText: string | undefined,
  ): Promise<CanonicalClipboardRecord> {
    return updateOcrTextCommand(this.commandPort(), itemId, ocrText);
  }

  async updateImagePayload(
    itemId: string,
    input: Readonly<{
      blobId: string;
      revision: string;
      imagePath: string;
      blobBytes: number;
      mediaType: "image/png";
    }>,
  ): Promise<CanonicalClipboardRecord> {
    return updateImagePayloadCommand(this.commandPort(), itemId, input);
  }
}
