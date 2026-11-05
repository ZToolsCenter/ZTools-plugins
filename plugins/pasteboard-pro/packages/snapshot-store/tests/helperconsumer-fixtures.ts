import * as fs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect } from "vitest";

import { openJournalBackendV2 } from "../src/journal.js";
import type { ConsumerInboxOptionsV2 } from "../src/consumer-types.js";
import type { JournalBackendV2 } from "../src/types.js";

export const artifactRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../artifacts/pasteboardpro/clipboard-format-g0/v028-consumer-tests",
);

const activeStores = new Set<JournalBackendV2>();
const sandboxes = new Set<string>();

afterEach(async () => {
  for (const store of [...activeStores]) {
    activeStores.delete(store);
    await store.close().catch(() => undefined);
  }
  for (const sandbox of [...sandboxes]) {
    sandboxes.delete(sandbox);
    await fs.rm(sandbox, { recursive: true, force: true });
  }
});

export async function newStoreDirectory(prefix = "consumer-run-"): Promise<string> {
  await fs.mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const sandbox = await fs.mkdtemp(join(artifactRoot, prefix));
  sandboxes.add(sandbox);
  return sandbox;
}

export async function newJournalDirectory(prefix = "consumer-run-"): Promise<string> {
  return join(await newStoreDirectory(prefix), "journal");
}

export async function openConsumerJournal(
  directory: string,
  options: Readonly<{ consumer?: ConsumerInboxOptionsV2 }> = {},
): Promise<JournalBackendV2> {
  const store = await openJournalBackendV2(directory, options);
  activeStores.add(store);
  return store;
}

export async function closeConsumerJournal(store: JournalBackendV2): Promise<void> {
  activeStores.delete(store);
  await store.close();
}

/** Seed immutable source events through the real journal writer in one LMDB transaction. */
export async function seedOutcomeEvents(
  store: JournalBackendV2,
  count: number,
  prefix = "consumer-attempt",
): Promise<readonly ReturnType<JournalBackendV2["recordOutcome"]>[]> {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("invalid event count");
  const events: ReturnType<JournalBackendV2["recordOutcome"]>[] = [];
  await store.withExclusiveMutation(async () => {
    for (let index = 0; index < count; index += 1) {
      events.push(store.recordOutcome(`${prefix}-${index}`, "unsupported"));
    }
  });
  return Object.freeze(events);
}

export function expectStoreCode(action: () => unknown, code: string): void {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toMatchObject({ code });
}

export async function expectStoreCodeAsync(action: () => Promise<unknown>, code: string): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toMatchObject({ code });
}
