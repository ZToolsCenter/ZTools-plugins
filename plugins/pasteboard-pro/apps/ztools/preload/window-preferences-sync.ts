import type { HybridClock } from "@pasteboard-pro/core";
import { compareClock } from "@pasteboard-pro/sync-protocol";

import type { ZToolsDocumentDatabase } from "./clipboard-store";
import type { WindowPreferences } from "./window-preferences";

export type SyncedWindowPreferences = Readonly<{
  id: "window";
  entityType: "window_preferences";
  settings: WindowPreferences;
  updatedAt: string;
  sourceDeviceId: string;
  clock: HybridClock;
}>;

export type WindowPreferencesStoreOptions = Readonly<{
  deviceId?: string;
  now?: () => number;
}>;

type WindowPreferencesParser = (value: unknown) => WindowPreferences | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDatabaseStatus(error: unknown, status: number): boolean {
  return (
    isRecord(error) &&
    (error.status === status || error.statusCode === status)
  );
}

export function parseSyncedWindowPreferencesValue(
  value: unknown,
  parseSettings: WindowPreferencesParser,
): SyncedWindowPreferences {
  if (
    !isRecord(value) ||
    value.id !== "window" ||
    value.entityType !== "window_preferences" ||
    typeof value.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    typeof value.sourceDeviceId !== "string" ||
    value.sourceDeviceId.length === 0 ||
    !isRecord(value.clock) ||
    !Number.isSafeInteger(value.clock.wallMs) ||
    !Number.isSafeInteger(value.clock.counter) ||
    Number(value.clock.counter) < 0 ||
    typeof value.clock.deviceId !== "string" ||
    value.clock.deviceId.length === 0
  ) {
    throw new TypeError("Invalid synced window preferences");
  }
  const settings = parseSettings({ settings: value.settings });
  if (settings === undefined) {
    throw new TypeError("Invalid synced window preference settings");
  }
  return {
    id: "window",
    entityType: "window_preferences",
    settings,
    updatedAt: value.updatedAt,
    sourceDeviceId: value.sourceDeviceId,
    clock: {
      wallMs: Number(value.clock.wallMs),
      counter: Number(value.clock.counter),
      deviceId: value.clock.deviceId,
    },
  };
}

export class WindowPreferencesSyncStore {
  private readonly deviceId: string;
  private readonly now: () => number;

  constructor(
    private readonly database: ZToolsDocumentDatabase,
    private readonly documentId: string,
    private readonly parseSettings: WindowPreferencesParser,
    options: WindowPreferencesStoreOptions = {},
  ) {
    this.deviceId = options.deviceId?.trim() || "ztools-local";
    this.now = options.now ?? Date.now;
  }

  createEntity(current: unknown, settings: WindowPreferences): SyncedWindowPreferences {
    const currentSync = isRecord(current) && isRecord(current.sync)
      ? this.parse(current.sync)
      : undefined;
    const wallMs = Math.max(
      Math.trunc(this.now()),
      (currentSync?.clock.wallMs ?? 0) + 1,
    );
    return {
      id: "window",
      entityType: "window_preferences",
      settings: structuredClone(settings),
      updatedAt: new Date(wallMs).toISOString(),
      sourceDeviceId: this.deviceId,
      clock: { wallMs, counter: 0, deviceId: this.deviceId },
    };
  }

  async get(): Promise<SyncedWindowPreferences | undefined> {
    let document: unknown;
    try {
      document = await this.database.get(this.documentId);
    } catch (error) {
      if (isDatabaseStatus(error, 404)) return undefined;
      throw error;
    }
    if (!isRecord(document) || !isRecord(document.sync)) return undefined;
    return this.parse(document.sync);
  }

  async put(entity: SyncedWindowPreferences): Promise<void> {
    const incoming = this.parse(entity);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let current: unknown;
      try {
        current = await this.database.get(this.documentId);
      } catch (error) {
        if (!isDatabaseStatus(error, 404)) throw error;
      }
      const currentSync = isRecord(current) && isRecord(current.sync)
        ? this.parse(current.sync)
        : undefined;
      if (
        currentSync !== undefined &&
        compareClock(currentSync.clock, incoming.clock) >= 0
      ) {
        return;
      }
      const revision =
        isRecord(current) && typeof current._rev === "string"
          ? current._rev
          : undefined;
      try {
        await this.database.put({
          _id: this.documentId,
          ...(revision === undefined ? {} : { _rev: revision }),
          type: "pasteboard-pro-window-preferences",
          settings: structuredClone(incoming.settings),
          sync: structuredClone(incoming),
        });
        return;
      } catch (error) {
        if (!isDatabaseStatus(error, 409) || attempt === 2) throw error;
      }
    }
  }

  parse(value: unknown): SyncedWindowPreferences {
    return parseSyncedWindowPreferencesValue(value, this.parseSettings);
  }
}
