import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { openJournalBackendV2 } from "../src/journal.js";
import type { SnapshotCommitV2 } from "../src/types.js";
import { waitForControlFile, writeAtomicMarkerSync } from "./journal-process-controls.js";

// Transparent test probe: keep native LMDB open and its returned database unchanged;
// mark only the exact call boundary immediately before forwarding to the real export.
vi.mock("lmdb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lmdb")>();
  return {
    ...actual,
    open: (...args: Parameters<typeof actual.open>) => {
      if (process.env["JOURNAL_PROCESS_ROLE"] === "waiter") {
        const markerPath = process.env["JOURNAL_PROCESS_NATIVE_OPEN_BOUNDARY"];
        if (!markerPath) throw new Error("Missing native LMDB open boundary marker path");
        writeAtomicMarkerSync(markerPath, "waiter-native-open-boundary");
      }
      return actual.open(...args);
    },
  };
});

type Role = "holder" | "waiter";
const role = process.env["JOURNAL_PROCESS_ROLE"];
const runFixture = role === "holder" || role === "waiter";

describe.skipIf(!runFixture)("journal cross-process fixture", () => {
  it("opens only after GO, then enters the real LMDB writer transaction", async () => {
    const directory = process.env["JOURNAL_PROCESS_DB"];
    const commandJson = process.env["JOURNAL_PROCESS_COMMAND"];
    const loadedPath = process.env["JOURNAL_PROCESS_LOADED"];
    const goPath = process.env["JOURNAL_PROCESS_GO"];
    const openedPath = process.env["JOURNAL_PROCESS_OPENED"];
    const enteredPath = process.env["JOURNAL_PROCESS_ENTERED"];
    const releasePath = process.env["JOURNAL_PROCESS_RELEASE"];
    const deadlineAtMs = Number(process.env["JOURNAL_PROCESS_DEADLINE_AT_MS"]);
    if (!isRole(role) || !directory || !commandJson || !loadedPath || !goPath || !openedPath ||
        !enteredPath || !releasePath || !Number.isSafeInteger(deadlineAtMs)) {
      throw new Error("Missing bounded journal process fixture environment");
    }

    const command = JSON.parse(commandJson) as SnapshotCommitV2;
    let store: Awaited<ReturnType<typeof openJournalBackendV2>> | undefined;
    try {
      writeAtomicMarkerSync(loadedPath, `${role}-loaded`);
      await waitForControlFile(goPath, deadlineAtMs, `${role} GO marker`);

      if (role === "holder") {
        const openedStore = await openJournalBackendV2(directory);
        store = openedStore;
        writeAtomicMarkerSync(openedPath, "holder-opened-journal");
        await openedStore.withExclusiveMutation(async () => {
          writeAtomicMarkerSync(enteredPath, "holder-entered-writer");
          await waitForControlFile(releasePath, deadlineAtMs, "holder release marker");
          openedStore.commitCapture(command, () => undefined);
        });
      } else {
        // The Vitest LMDB wrapper marks the native open boundary after journal path preparation.
        const openedStore = await openJournalBackendV2(directory);
        store = openedStore;
        writeAtomicMarkerSync(openedPath, "waiter-opened-journal");
        await openedStore.withExclusiveMutation(async () => {
          if (!existsSync(releasePath)) {
            throw new Error("waiter entered the writer callback before parent release");
          }
          writeAtomicMarkerSync(enteredPath, "waiter-entered-writer-after-release");
          openedStore.commitCapture(command, () => undefined);
        });
      }
    } finally {
      await store?.close();
    }
  }, 28_000);
});

function isRole(value: string | undefined): value is Role {
  return value === "holder" || value === "waiter";
}
