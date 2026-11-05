import { describe, expect, it, vi } from "vitest";
import {
  createCheckedZToolsDocumentDatabase,
  documentRevision,
  documentsFromAllDocs,
  getOptionalDocument,
  isDatabaseStatus,
  putWithConflictRetry,
  removeDocument,
  type RawZToolsDocumentDatabase,
} from "../preload/clipboard-document-database";
import type { ZToolsDocumentDatabase } from "../preload/clipboard-store-types";

function makeRaw(
  overrides: Partial<RawZToolsDocumentDatabase> = {},
): RawZToolsDocumentDatabase {
  return {
    get: async () => null,
    put: async (document) => ({ ok: true, id: document._id, rev: "1-a" }),
    allDocs: async () => [],
    remove: async (document) => ({
      ok: true,
      id: (document as Record<string, unknown>)._id,
    }),
    ...overrides,
  };
}

function makePort(
  overrides: Partial<ZToolsDocumentDatabase> = {},
): ZToolsDocumentDatabase {
  return {
    get: async () => null,
    put: async (document) => ({ ok: true, id: document._id, rev: "1-a" }),
    allDocs: async () => [],
    remove: async (document) => ({
      ok: true,
      id: (document as Record<string, unknown>)._id,
    }),
    ...overrides,
  };
}

describe("checked ZTools clipboard database adapter", () => {
  it("caches one checked port per native database", () => {
    const raw = makeRaw();
    expect(createCheckedZToolsDocumentDatabase(raw)).toBe(
      createCheckedZToolsDocumentDatabase(raw),
    );
    expect(createCheckedZToolsDocumentDatabase(makeRaw())).not.toBe(
      createCheckedZToolsDocumentDatabase(raw),
    );
  });

  it("keeps the native receiver and translates prefix and keys allDocs calls", async () => {
    const nativeCalls: Array<string | string[] | undefined> = [];
    const raw: RawZToolsDocumentDatabase = {
      get: async function (this: RawZToolsDocumentDatabase) {
        expect(this).toBe(raw);
        return null;
      },
      put: async function (this: RawZToolsDocumentDatabase, document) {
        expect(this).toBe(raw);
        return { ok: true, id: document._id, rev: "1-a" };
      },
      allDocs: async function (
        this: RawZToolsDocumentDatabase,
        key?: string | string[],
      ) {
        expect(this).toBe(raw);
        nativeCalls.push(key);
        return typeof key === "string"
          ? [
              { _id: `${key}a`, value: 1 },
              { _id: "outside:document", value: 2 },
            ]
          : (key ?? []).map((_id) => ({ _id: _id === "missing" ? "other" : _id }));
      },
      remove: async function (this: RawZToolsDocumentDatabase, document) {
        expect(this).toBe(raw);
        return { ok: true, id: (document as Record<string, unknown>)._id };
      },
    };
    const database = createCheckedZToolsDocumentDatabase(raw);

    await expect(database.allDocs!({
      include_docs: true,
      startkey: "pasteboard-pro:record:",
      endkey: "pasteboard-pro:record:\uffff",
    })).resolves.toEqual([{ _id: "pasteboard-pro:record:a", value: 1 }]);
    await expect(database.allDocs!({
      include_docs: true,
      keys: ["pasteboard-pro:record:one", "pasteboard-pro:record:two"],
    })).resolves.toEqual([
      { _id: "pasteboard-pro:record:one" },
      { _id: "pasteboard-pro:record:two" },
    ]);
    expect(nativeCalls).toEqual([
      "pasteboard-pro:record:",
      ["pasteboard-pro:record:one", "pasteboard-pro:record:two"],
    ]);

    await database.get("id");
    await database.put({ _id: "id" });
    await database.remove!({ _id: "id", _rev: "1-a" });
  });

  it("rejects unsupported allDocs options and malformed native rows", async () => {
    const database = createCheckedZToolsDocumentDatabase(makeRaw({
      allDocs: async () => [{ value: "missing id" }],
    }));
    await expect(database.allDocs!({ include_docs: true })).rejects.toMatchObject({
      status: 500,
    });
    await expect(database.allDocs!({
      include_docs: true,
      startkey: "pasteboard-pro:record:",
      endkey: "wrong-range",
    })).rejects.toMatchObject({ status: 500 });
    await expect(database.allDocs!({
      include_docs: true,
      startkey: "pasteboard-pro:record:",
      endkey: "pasteboard-pro:record:\uffff",
    })).rejects.toMatchObject({ status: 500 });
  });

  it("re-reads and retries a resolved conflict before reporting write success", async () => {
    const revisions = ["1-a", "2-b"];
    const builtRevisions: Array<string | undefined> = [];
    let putCount = 0;
    const raw = makeRaw({
      get: async () => ({ _id: "pasteboard-pro:item", _rev: revisions.shift() }),
      put: async (document) => {
        putCount += 1;
        if (putCount === 1) {
          return {
            id: document._id,
            error: true,
            name: "conflict",
            message: "sensitive host detail",
          };
        }
        return { ok: true, id: document._id, rev: "3-c" };
      },
    });
    const database = createCheckedZToolsDocumentDatabase(raw);

    await expect(putWithConflictRetry(database, "pasteboard-pro:item", (rev) => {
      builtRevisions.push(rev);
      return { _id: "pasteboard-pro:item", _rev: rev, value: "safe" };
    })).resolves.toBeUndefined();
    expect(putCount).toBe(2);
    expect(builtRevisions).toEqual(["1-a", "2-b"]);
  });

  it("retries a rejected conflict but stops after three conflicts", async () => {
    let getCount = 0;
    let putCount = 0;
    const raw = makeRaw({
      get: async () => ({ _id: "item", _rev: `rev-${++getCount}` }),
      put: async () => {
        putCount += 1;
        throw Object.assign(new Error("secret rejection"), { status: 409 });
      },
    });
    const database = createCheckedZToolsDocumentDatabase(raw);

    await expect(putWithConflictRetry(database, "item", (rev) => ({ _id: "item", _rev: rev })))
      .rejects.toMatchObject({ status: 409, message: "Database conflict" });
    expect(getCount).toBe(3);
    expect(putCount).toBe(3);
  });

  it("rejects other resolved write errors immediately without exposing host text", async () => {
    const put = vi.fn(async () => ({
      id: "item",
      error: true,
      name: "exception",
      message: "private payload and path",
    }));
    const database = createCheckedZToolsDocumentDatabase(makeRaw({ put }));

    await expect(putWithConflictRetry(database, "item", () => ({ _id: "item" })))
      .rejects.toMatchObject({ status: 500, message: "Storage operation failed" });
    expect(put).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ack: undefined, label: "missing result" },
    { ack: null, label: "null result" },
    { ack: { id: "item", rev: "1-a" }, label: "missing ok" },
    { ack: { ok: true, id: "other", rev: "1-a" }, label: "wrong id" },
    { ack: { ok: true, id: "item", rev: " " }, label: "empty rev" },
    { ack: { ok: true, id: "item", rev: "1-a", error: true }, label: "contradictory result" },
    { ack: [{ ok: true, id: "item", rev: "1-a" }], label: "array result" },
  ])("rejects an unconfirmed put ($label)", async ({ ack }) => {
    const database = createCheckedZToolsDocumentDatabase(makeRaw({
      put: async () => ack,
    }));
    await expect(database.put({ _id: "item" })).rejects.toMatchObject({ status: 500 });
  });

  it("maps a resolved native get not_found result to an optional absence", async () => {
    const database = createCheckedZToolsDocumentDatabase(makeRaw({
      get: async () => ({ id: "missing", error: true, name: "not_found", message: "private" }),
    }));
    await expect(getOptionalDocument(database, "missing")).resolves.toBeUndefined();
    expect(isDatabaseStatus(Object.assign(new Error("x"), { name: "not_found" }), 404)).toBe(true);
    expect(documentRevision({ _rev: "" })).toBeUndefined();
  });

  it("accepts only null or an ID-matching native document with a valid revision", async () => {
    const missing = createCheckedZToolsDocumentDatabase(makeRaw({ get: async () => null }));
    await expect(missing.get("item")).resolves.toBeUndefined();

    for (const value of [
      undefined,
      [],
      { _id: "other", _rev: "1-a" },
      { _id: "item" },
      { _id: "item", _rev: " " },
    ]) {
      const database = createCheckedZToolsDocumentDatabase(makeRaw({ get: async () => value }));
      await expect(database.get("item")).rejects.toMatchObject({
        status: 500,
        message: "Storage operation failed",
      });
    }
  });

  it("sanitizes rejected raw-port errors while retaining conflict status", async () => {
    const privateError = () => new Error("private document body and filesystem path");
    const readFailure = makePort({ get: async () => { throw privateError(); } });
    await expect(getOptionalDocument(readFailure, "item")).rejects.toMatchObject({
      status: 500,
      message: "Storage operation failed",
    });

    const putFailure = makePort({
      get: async () => ({ _id: "item", _rev: "1-a" }),
      put: async () => { throw privateError(); },
    });
    await expect(putWithConflictRetry(putFailure, "item", (rev) => ({ _id: "item", _rev: rev })))
      .rejects.toMatchObject({ status: 500, message: "Storage operation failed" });

    const removeFailure = makePort({
      remove: async () => { throw privateError(); },
    });
    await expect(removeDocument(removeFailure, { _id: "item", _rev: "1-a" }))
      .rejects.toMatchObject({ status: 500, message: "Storage operation failed" });
  });

  it("sanitizes the final raw-port conflict after three attempts", async () => {
    let getCount = 0;
    const database = makePort({
      get: async () => ({ _id: "item", _rev: `rev-${++getCount}` }),
      put: async () => {
        throw Object.assign(new Error("private conflict detail"), { status: 409 });
      },
    });

    await expect(putWithConflictRetry(database, "item", (rev) => ({ _id: "item", _rev: rev })))
      .rejects.toMatchObject({ status: 409, message: "Database conflict" });
    expect(getCount).toBe(3);
  });

  it("accepts the host's no-revision remove ack and handles confirmed not_found idempotently", async () => {
    const id = "pasteboard-pro:item";
    const raw = makeRaw({
      remove: async (document) => ({
        ok: true,
        id: (document as Record<string, unknown>)._id,
      }),
    });
    const database = createCheckedZToolsDocumentDatabase(raw);
    await expect(removeDocument(database, { _id: id, _rev: "1-a" }, id)).resolves.toBeUndefined();

    const missing = createCheckedZToolsDocumentDatabase(makeRaw({
      remove: async (document) => ({
        id: (document as Record<string, unknown>)._id,
        error: true,
        name: "not_found",
        message: "private",
      }),
    }));
    await expect(removeDocument(missing, { _id: id, _rev: "1-a" }, id)).resolves.toBeUndefined();

    const conflict = createCheckedZToolsDocumentDatabase(makeRaw({
      remove: async (document) => ({
        id: (document as Record<string, unknown>)._id,
        error: true,
        name: "conflict",
        message: "private",
      }),
    }));
    await expect(removeDocument(conflict, { _id: id, _rev: "1-a" }, id))
      .rejects.toMatchObject({ status: 409, message: "Database conflict" });
  });

  it("passes only the minimal remove envelope and preserves native string removal", async () => {
    const id = "pasteboard-pro:item";
    const source = {
      _id: id,
      _rev: "2-b",
      type: "pasteboard-pro-record",
      record: {
        origin: { imagePath: "/private/payload.png" },
        payload: "synthetic sensitive clipboard text",
      },
    };
    const original = structuredClone(source);
    let rawArgument: unknown;
    const raw: RawZToolsDocumentDatabase = {
      get: async () => null,
      put: async (document) => ({ ok: true, id: document._id, rev: "1-a" }),
      allDocs: async () => [],
      remove: async function (this: RawZToolsDocumentDatabase, document) {
        expect(this).toBe(raw);
        rawArgument = document;
        return { ok: true, id };
      },
    };
    const checked = createCheckedZToolsDocumentDatabase(raw);

    await checked.remove!(source);
    expect(rawArgument).toEqual({ _id: id, _rev: "2-b" });
    expect(source).toEqual(original);

    let portArgument: unknown;
    const port = makePort({
      remove: async (document) => {
        portArgument = document;
        return { ok: true, id };
      },
    });
    await removeDocument(port, source, id);
    expect(portArgument).toEqual({ _id: id, _rev: "2-b" });
    expect(source).toEqual(original);

    let stringArgument: unknown;
    const stringRemoval = createCheckedZToolsDocumentDatabase(makeRaw({
      remove: async (document) => {
        stringArgument = document;
        return { ok: true, id: "legacy-id" };
      },
    }));
    await stringRemoval.remove!("legacy-id");
    expect(stringArgument).toBe("legacy-id");
  });

  it("rejects missing or invalid revisions instead of dropping them from remove envelopes", async () => {
    const rawRemove = vi.fn(async (document: unknown) => ({
      ok: true,
      id: (document as Record<string, unknown>)._id,
    }));
    const native = createCheckedZToolsDocumentDatabase(makeRaw({ remove: rawRemove }));
    for (const revision of [null, "", "  ", 7]) {
      await expect(native.remove!({ _id: "item", _rev: revision })).rejects.toMatchObject({ status: 500 });
    }
    expect(rawRemove).not.toHaveBeenCalled();

    const missingRevision = {
      _id: "item",
      type: "pasteboard-pro-record",
      record: { payload: "synthetic private content" },
    };
    const original = structuredClone(missingRevision);
    await expect(native.remove!(missingRevision)).rejects.toMatchObject({ status: 500 });
    expect(missingRevision).toEqual(original);
    expect(rawRemove).not.toHaveBeenCalled();

    const portRemove = vi.fn(async () => ({ ok: true, id: "item" }));
    await expect(removeDocument(
      makePort({ remove: portRemove }),
      { _id: "item", _rev: null },
    )).rejects.toMatchObject({ status: 500 });
    await expect(removeDocument(
      makePort({ remove: portRemove }),
      missingRevision,
    )).rejects.toMatchObject({ status: 500 });
    expect(portRemove).not.toHaveBeenCalled();
  });

  it("rejects a remove ack that is missing confirmation or has a mismatched ID", async () => {
    for (const ack of [
      undefined,
      { id: "item" },
      { ok: true, id: "other" },
      { ok: true, id: "item", rev: " " },
      { ok: true, id: "item", error: true },
    ]) {
      const database = createCheckedZToolsDocumentDatabase(makeRaw({ remove: async () => ack }));
      await expect(database.remove!({ _id: "item", _rev: "1-a" }))
        .rejects.toMatchObject({ status: 500 });
    }
  });

  it("supports both generic allDocs result ports without truncating arrays", () => {
    const rows = [{ doc: { _id: "one" } }, { doc: { _id: "two" } }];
    expect(documentsFromAllDocs([{ _id: "one" }, { _id: "two" }], "invalid")).toHaveLength(2);
    expect(documentsFromAllDocs({ rows }, "invalid")).toEqual([
      { _id: "one" },
      { _id: "two" },
    ]);
    expect(() => documentsFromAllDocs({ error: true }, "invalid")).toThrow("invalid");
  });
});
