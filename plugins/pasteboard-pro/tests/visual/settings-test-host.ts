import { expect, type Page } from "playwright/test";

import type { ZToolsDocumentDatabase } from "../../apps/ztools/preload/clipboard-store";
import type { ApplicationCatalogResult } from "../../apps/ztools/preload/application-catalog";
import type { SourceAppIdentity } from "../../apps/ztools/preload/source-app-icons";
import {
  ZToolsPrivacySettingsStore,
  type PrivacySettings,
} from "../../apps/ztools/preload/privacy";
import { ZToolsWindowPreferencesStore } from "../../apps/ztools/preload/window-preferences";

export const settingsTestBaseUrl = "http://127.0.0.1:5179";

export type SettingsTabId = "general" | "appearance" | "privacy" | "sync";

const tabLabels: Record<SettingsTabId, string> = {
  general: "通用",
  appearance: "外观",
  privacy: "隐私",
  sync: "同步",
};

type PendingDatabaseWrite = {
  id: string;
  message: string;
  started: Promise<void>;
  signalStarted(): void;
  waiting: Promise<void>;
  release(): void;
};

export class MemoryZToolsDatabase implements ZToolsDocumentDatabase {
  private readonly documents = new Map<string, Record<string, unknown>>();
  private readonly revisions = new Map<string, number>();
  private nextFailure: Readonly<{ id: string; message: string }> | undefined;
  private nextWriteGate: PendingDatabaseWrite | undefined;

  failNextPutFor(id: string, message: string): void {
    this.nextFailure = { id, message };
  }

  gateNextPutFor(id: string, message: string): Readonly<{
    started: Promise<void>;
    release(): void;
  }> {
    let signalStarted!: () => void;
    let release!: () => void;
    let startedResolve!: () => void;
    let waitingResolve!: () => void;
    const started = new Promise<void>((resolve) => { startedResolve = resolve; });
    const waiting = new Promise<void>((resolve) => { waitingResolve = resolve; });
    signalStarted = startedResolve;
    release = waitingResolve;
    this.nextWriteGate = { id, message, started, signalStarted, waiting, release };
    return { started, release };
  }

  async get(id: string): Promise<unknown> {
    const document = this.documents.get(id);
    if (document === undefined) throw { status: 404 };
    return structuredClone(document);
  }

  async put(document: Record<string, unknown>): Promise<unknown> {
    const id = document._id;
    if (typeof id !== "string") throw new TypeError("Database document requires _id");
    if (this.nextWriteGate?.id === id) {
      const gate = this.nextWriteGate;
      this.nextWriteGate = undefined;
      gate.signalStarted();
      await gate.waiting;
      return { rejected: true, status: 500, message: gate.message };
    }
    if (this.nextFailure?.id === id) {
      const failure = this.nextFailure;
      this.nextFailure = undefined;
      return { rejected: true, status: 500, message: failure.message };
    }

    const current = this.documents.get(id);
    const expectedRevision = current?._rev;
    if (document._rev !== expectedRevision) throw { status: 409 };

    const revision = (this.revisions.get(id) ?? 0) + 1;
    this.revisions.set(id, revision);
    this.documents.set(id, {
      ...structuredClone(document),
      _rev: `${revision}-settings-save-test`,
    });
    return { ok: true, id, rev: `${revision}-settings-save-test` };
  }
}

type BrowserPrivacyStore = {
  get(): Promise<PrivacySettings>;
  put(settings: PrivacySettings): Promise<void>;
};

export type SettingsTestWindow = Window & {
  __readTestDatabase(id: string): Promise<{
    found: boolean;
    document?: Record<string, unknown>;
  }>;
  __writeTestDatabase(document: Record<string, unknown>): Promise<unknown>;
  __getWindowPreferences(): Promise<unknown>;
  __saveWindowPreferences(settings: unknown): Promise<unknown>;
  __privacyStorePromise?: Promise<BrowserPrivacyStore>;
  __getBrowserPrivacyStore(): Promise<BrowserPrivacyStore>;
  __privacySaveCalls: number;
  __privacySaveValues: boolean[];
  __closeCalls: number;
  __applicationListCalls: boolean[];
  __sourceAppIconCalls: SourceAppIdentity[];
  __listTestApplications?(refresh?: boolean): Promise<ApplicationCatalogResult>;
  __getTestSourceAppIcon?(sourceApp: SourceAppIdentity): Promise<string | undefined>;
};

export type SettingsTestHostOptions = Readonly<{
  listApplications?: (refresh?: boolean) => Promise<ApplicationCatalogResult>;
  getSourceAppIcon?: (sourceApp: SourceAppIdentity) => Promise<string | undefined>;
}>;

export async function attachSettingsHost(
  page: Page,
  database: MemoryZToolsDatabase,
  windowPreferencesStore: ZToolsWindowPreferencesStore,
  options: SettingsTestHostOptions = {},
): Promise<void> {
  await page.exposeFunction("__readTestDatabase", async (id: string) => {
    try {
      return {
        found: true,
        document: (await database.get(id)) as Record<string, unknown>,
      };
    } catch (error) {
      if (
        error !== null &&
        typeof error === "object" &&
        "status" in error &&
        error.status === 404
      ) {
        return { found: false };
      }
      throw error;
    }
  });
  await page.exposeFunction(
    "__writeTestDatabase",
    (document: Record<string, unknown>) => database.put(document),
  );
  await page.exposeFunction("__getWindowPreferences", () =>
    windowPreferencesStore.get(),
  );
  await page.exposeFunction(
    "__saveWindowPreferences",
    async (settings: Parameters<ZToolsWindowPreferencesStore["put"]>[0]) => {
      await windowPreferencesStore.put(settings);
      return windowPreferencesStore.get();
    },
  );
  if (options.listApplications !== undefined) {
    await page.exposeFunction(
      "__listTestApplications",
      options.listApplications,
    );
  }
  if (options.getSourceAppIcon !== undefined) {
    await page.exposeFunction(
      "__getTestSourceAppIcon",
      options.getSourceAppIcon,
    );
  }

  await page.addInitScript(({ hasApplicationCatalog, hasSourceAppIcons }) => {
    const testWindow = window as unknown as SettingsTestWindow;
    testWindow.__privacySaveCalls = 0;
    testWindow.__privacySaveValues = [];
    testWindow.__closeCalls = 0;
    testWindow.__applicationListCalls = [];
    testWindow.__sourceAppIconCalls = [];
    testWindow.__getBrowserPrivacyStore = () => {
      testWindow.__privacyStorePromise ??= (async () => {
        const moduleUrl = new URL(
          "preload/privacy.ts",
          window.location.origin,
        ).toString();
        const { ZToolsPrivacySettingsStore } = await import(moduleUrl);
        const databaseAdapter = {
          get: async (id: string): Promise<unknown> => {
            const result = await testWindow.__readTestDatabase(id);
            if (!result.found) throw { status: 404 };
            return result.document;
          },
          put: async (document: Record<string, unknown>) => {
            const result = await testWindow.__writeTestDatabase(document);
            if (
              result !== null &&
              typeof result === "object" &&
              "rejected" in result &&
              result.rejected === true
            ) {
              const error = new Error(
                "message" in result && typeof result.message === "string"
                  ? result.message
                  : "Database write failed",
              ) as Error & { status?: number };
              error.status =
                "status" in result && typeof result.status === "number"
                  ? result.status
                  : 500;
              throw error;
            }
            return result;
          },
        };
        return new ZToolsPrivacySettingsStore(databaseAdapter);
      })();
      return testWindow.__privacyStorePromise;
    };

    window.close = () => { testWindow.__closeCalls += 1; };
    Object.defineProperty(window, "pasteboardPro", {
      configurable: true,
      value: {
        getHostCompatibility: () => ({ supported: true }),
        getPlatformCapabilities: () => ({
          platform: "darwin",
          supportsGlobalPasteQueue: true,
          supportsScreenCapture: false,
        }),
        getPrivacySettings: async () =>
          (await testWindow.__getBrowserPrivacyStore()).get(),
        savePrivacySettings: async (settings: PrivacySettings) => {
          testWindow.__privacySaveCalls += 1;
          testWindow.__privacySaveValues.push(settings.screenShareProtection);
          const store = await testWindow.__getBrowserPrivacyStore();
          await store.put(settings);
          return store.get();
        },
        getWindowPreferences: () => testWindow.__getWindowPreferences(),
        saveWindowPreferences: (settings: unknown) =>
          testWindow.__saveWindowPreferences(settings),
        getSyncSettings: async () => ({
          enabled: false,
          baseUrl: "",
          username: "",
          intervalMinutes: 60,
          webdavCredentialAccount: "webdav",
          vaultKeyAccount: "vault-key",
          status: { state: "disabled", pendingObjects: 0 },
        }),
        getListOrders: async () => ({}),
        getPasteStack: async () => ({ direction: "forward", itemIds: [] }),
        listPinboards: async () => [],
        searchHistory: async () => ({ items: [], total: 0 }),
        openPanel: () => undefined,
        ...(hasApplicationCatalog
          ? {
              listApplications: async (refresh?: boolean) => {
                testWindow.__applicationListCalls.push(refresh === true);
                if (testWindow.__listTestApplications === undefined) {
                  throw new Error("Application catalog test provider is missing");
                }
                return testWindow.__listTestApplications(refresh);
              },
            }
          : {}),
        ...(hasSourceAppIcons
          ? {
              getSourceAppIcon: async (sourceApp: SourceAppIdentity) => {
                testWindow.__sourceAppIconCalls.push(sourceApp);
                return testWindow.__getTestSourceAppIcon?.(sourceApp);
              },
            }
          : {}),
      },
    });
  }, {
    hasApplicationCatalog: options.listApplications !== undefined,
    hasSourceAppIcons: options.getSourceAppIcon !== undefined,
  });
}

export async function openSettingsTab(
  page: Page,
  tab: SettingsTabId,
): Promise<void> {
  await page.goto(`${settingsTestBaseUrl}/?visual=1&panel=privacy&tab=${tab}`, {
    waitUntil: "networkidle",
  });
  await expect(page.getByRole("tab", { name: tabLabels[tab] })).toHaveAttribute(
    "aria-selected",
    "true",
  );
}
