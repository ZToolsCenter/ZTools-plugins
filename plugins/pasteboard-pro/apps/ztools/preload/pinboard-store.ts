import {
  compareStableOrder,
  orderKeyBetween,
  PinboardSchema,
  type HybridClock,
  type Pinboard,
} from "@pasteboard-pro/core";
import type { Tombstone } from "@pasteboard-pro/sync-protocol";

import {
  documentsFromAllDocs,
  type ZToolsDocumentDatabase,
} from "./clipboard-store";

export type PinboardStoreOptions = Readonly<{
  deviceId: string;
  now?: () => number;
  idFactory?: () => string;
}>;

const PINBOARD_PREFIX = "pasteboard-pro:pinboard:";
const TOMBSTONE_PREFIX = "pasteboard-pro:tombstone:";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function databaseStatus(error: unknown, status: number): boolean {
  return (
    isRecord(error) &&
    (error.status === status || error.statusCode === status)
  );
}

function normalizedName(value: string): string {
  const name = value.trim();
  if (name.length === 0 || name.length > 80) {
    throw new RangeError("Pinboard name must contain 1 to 80 characters");
  }
  return name;
}

function normalizedColor(value: string): string {
  const color = value.trim();
  if (!/^#[0-9a-f]{6}$/iu.test(color)) {
    throw new TypeError("Pinboard color must be a six-digit hex color");
  }
  return color.toUpperCase();
}

function revision(value: unknown): string | undefined {
  return isRecord(value) && typeof value._rev === "string"
    ? value._rev
    : undefined;
}

function pinboardFromDocument(value: unknown): Pinboard | undefined {
  if (!isRecord(value) || value.type !== "pasteboard-pro-pinboard") {
    return undefined;
  }
  const parsed = PinboardSchema.safeParse(value.pinboard);
  return parsed.success ? parsed.data : undefined;
}

export class ZToolsPinboardStore {
  private readonly deviceId: string;
  private readonly now: () => number;
  private readonly idFactory: () => string;

  constructor(
    private readonly database: ZToolsDocumentDatabase,
    options: PinboardStoreOptions,
  ) {
    this.deviceId = options.deviceId.trim();
    if (this.deviceId.length === 0) {
      throw new TypeError("Pinboard store requires a device id");
    }
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
  }

  async list(): Promise<Pinboard[]> {
    if (this.database.allDocs === undefined) {
      throw new TypeError("ZTools database does not expose allDocs");
    }
    const result = await this.database.allDocs({
      include_docs: true,
      startkey: PINBOARD_PREFIX,
      endkey: `${PINBOARD_PREFIX}\uffff`,
    });
    return documentsFromAllDocs(
      result,
      "ZTools database returned invalid Pinboard rows",
    )
      .flatMap((document) => {
        const pinboard = pinboardFromDocument(document);
        return pinboard === undefined ? [] : [pinboard];
      })
      .sort((left, right) => compareStableOrder(left, right));
  }

  async create(name: string, color: string): Promise<Pinboard> {
    const boards = await this.list();
    const timestamp = this.timestamp();
    const clock = (counter: number): HybridClock => ({
      wallMs: timestamp,
      counter,
      deviceId: this.deviceId,
    });
    const last = boards.at(-1);
    const pinboard = PinboardSchema.parse({
      id: this.idFactory(),
      name: normalizedName(name),
      color: normalizedColor(color),
      orderKey: orderKeyBetween(last?.orderKey, undefined),
      createdAt: new Date(timestamp).toISOString(),
      updatedAt: new Date(timestamp).toISOString(),
      fieldClocks: {
        name: clock(0),
        color: clock(1),
        orderKey: clock(2),
      },
    });
    await this.put(pinboard);
    return pinboard;
  }

  async rename(id: string, name: string): Promise<Pinboard> {
    const pinboard = await this.required(id);
    const timestamp = this.timestamp();
    const updated = PinboardSchema.parse({
      ...pinboard,
      name: normalizedName(name),
      updatedAt: new Date(timestamp).toISOString(),
      fieldClocks: {
        ...pinboard.fieldClocks,
        name: { wallMs: timestamp, counter: 0, deviceId: this.deviceId },
      },
    });
    await this.put(updated);
    return updated;
  }

  async updateColor(id: string, color: string): Promise<Pinboard> {
    const pinboard = await this.required(id);
    const timestamp = this.timestamp();
    const updated = PinboardSchema.parse({
      ...pinboard,
      color: normalizedColor(color),
      updatedAt: new Date(timestamp).toISOString(),
      fieldClocks: {
        ...pinboard.fieldClocks,
        color: { wallMs: timestamp, counter: 0, deviceId: this.deviceId },
      },
    });
    await this.put(updated);
    return updated;
  }

  async moveBetween(
    id: string,
    beforeId?: string,
    afterId?: string,
  ): Promise<Pinboard> {
    const boards = await this.list();
    const moving = boards.find((board) => board.id === id);
    if (moving === undefined) {
      throw new RangeError("Pinboard does not exist");
    }
    const remaining = boards.filter((board) => board.id !== id);
    const before =
      beforeId === undefined
        ? undefined
        : remaining.find((board) => board.id === beforeId);
    const after =
      afterId === undefined
        ? undefined
        : remaining.find((board) => board.id === afterId);
    if (
      (beforeId !== undefined && before === undefined) ||
      (afterId !== undefined && after === undefined)
    ) {
      throw new RangeError("Pinboard reorder anchor does not exist");
    }

    const lowerKey =
      beforeId === undefined && afterId === undefined
        ? remaining.at(-1)?.orderKey
        : before?.orderKey;
    const upperKey = after?.orderKey;
    const timestamp = this.timestamp();
    const updated = PinboardSchema.parse({
      ...moving,
      orderKey: orderKeyBetween(lowerKey, upperKey),
      updatedAt: new Date(timestamp).toISOString(),
      fieldClocks: {
        ...moving.fieldClocks,
        orderKey: { wallMs: timestamp, counter: 0, deviceId: this.deviceId },
      },
    });
    await this.put(updated);
    return updated;
  }

  async putSynced(pinboard: Pinboard): Promise<void> {
    await this.put(PinboardSchema.parse(pinboard));
  }

  async removeSynced(id: string): Promise<void> {
    if (this.database.remove === undefined) {
      throw new TypeError("ZTools database does not expose remove");
    }
    try {
      await this.database.remove(await this.database.get(this.documentId(id)));
    } catch (error) {
      if (!databaseStatus(error, 404)) throw error;
    }
  }

  async delete(id: string): Promise<Tombstone> {
    await this.required(id);
    const timestamp = this.timestamp();
    const tombstone: Tombstone = {
      id,
      entityType: "pinboard",
      deleted: true,
      deletedAt: new Date(timestamp).toISOString(),
      sourceDeviceId: this.deviceId,
      clock: { wallMs: timestamp, counter: 0, deviceId: this.deviceId },
    };
    const tombstoneId = `${TOMBSTONE_PREFIX}pinboard:${id}`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let current: unknown;
      try {
        current = await this.database.get(tombstoneId);
      } catch (error) {
        if (!databaseStatus(error, 404)) throw error;
      }
      try {
        await this.database.put({
          _id: tombstoneId,
          ...(revision(current) === undefined ? {} : { _rev: revision(current) }),
          type: "pasteboard-pro-tombstone",
          tombstone: structuredClone(tombstone),
        });
        break;
      } catch (error) {
        if (!databaseStatus(error, 409) || attempt === 2) throw error;
      }
    }
    if (this.database.remove === undefined) {
      throw new TypeError("ZTools database does not expose remove");
    }
    await this.database.remove(await this.database.get(this.documentId(id)));
    return tombstone;
  }

  private timestamp(): number {
    const value = this.now();
    if (!Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime())) {
      throw new RangeError("Pinboard clock must return a valid millisecond timestamp");
    }
    return value;
  }

  private documentId(id: string): string {
    return `${PINBOARD_PREFIX}${id}`;
  }

  private async required(id: string): Promise<Pinboard> {
    try {
      const document = await this.database.get(this.documentId(id));
      const pinboard = pinboardFromDocument(document);
      if (pinboard === undefined) {
        throw new TypeError("Stored Pinboard document is invalid");
      }
      return pinboard;
    } catch (error) {
      if (databaseStatus(error, 404)) {
        throw new RangeError("Pinboard does not exist");
      }
      throw error;
    }
  }

  private async put(pinboard: Pinboard): Promise<void> {
    const id = this.documentId(pinboard.id);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let current: unknown;
      try {
        current = await this.database.get(id);
      } catch (error) {
        if (!databaseStatus(error, 404)) throw error;
      }
      try {
        await this.database.put({
          _id: id,
          ...(revision(current) === undefined ? {} : { _rev: revision(current) }),
          type: "pasteboard-pro-pinboard",
          pinboard: structuredClone(pinboard),
        });
        return;
      } catch (error) {
        if (!databaseStatus(error, 409) || attempt === 2) throw error;
      }
    }
  }
}
