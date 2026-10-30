import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { compileScript, parse } from "vue/compiler-sfc";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  CURRENT_APP_VERSION,
  WHATS_NEW_STORAGE_KEY,
  markWhatsNewSeen,
  shouldShowWhatsNew,
} from "../src/whats-new";

describe("whats-new version checker", () => {
  it("shows whats new when no version has been recorded", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, val: string) => memory.set(key, val),
    };

    expect(shouldShowWhatsNew(storage)).toBe(true);
  });

  it("shows whats new when older version was recorded", () => {
    const memory = new Map<string, string>([[WHATS_NEW_STORAGE_KEY, "1.2.0"]]);
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, val: string) => memory.set(key, val),
    };

    expect(shouldShowWhatsNew(storage)).toBe(true);
  });

  it("suppresses whats new when current version is already recorded", () => {
    const memory = new Map<string, string>([[WHATS_NEW_STORAGE_KEY, CURRENT_APP_VERSION]]);
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, val: string) => memory.set(key, val),
    };

    expect(shouldShowWhatsNew(storage)).toBe(false);
  });

  it("marks current version as seen in storage", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, val: string) => memory.set(key, val),
    };

    markWhatsNewSeen(storage);
    expect(memory.get(WHATS_NEW_STORAGE_KEY)).toBe(CURRENT_APP_VERSION);
    expect(shouldShowWhatsNew(storage)).toBe(false);
  });
});


describe("release announcement consistency", () => {
  it("matches the runtime version to both manifests and the application package", async () => {
    const versions = await Promise.all([
      new URL("../../../plugin.json", import.meta.url),
      new URL("../public/plugin.json", import.meta.url),
      new URL("../package.json", import.meta.url),
    ].map(async path => JSON.parse(await readFile(path, "utf8")).version as string));
    expect(versions).toEqual([CURRENT_APP_VERSION, CURRENT_APP_VERSION, CURRENT_APP_VERSION]);
  });

  it("uses the shared runtime version as the compiled dialog prop default", async () => {
    const source = await readFile(new URL("../src/components/WhatsNewModal.vue", import.meta.url), "utf8");
    const { descriptor } = parse(source);
    const compiled = compileScript(descriptor, { id: "release-announcement-consistency" });
    const emitted = ts.transpileModule(compiled.content, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports: { default?: { props: { version: { default: string } } } } = {};
    runInNewContext(emitted, {
      exports,
      require(specifier: string) {
        if (specifier === "vue") return { defineComponent: (value: unknown) => value };
        if (specifier === "../whats-new") return { CURRENT_APP_VERSION };
        throw new Error("Unexpected release announcement dependency");
      },
    }, { timeout: 1000 });
    expect(exports.default?.props.version.default).toBe(CURRENT_APP_VERSION);
  });

  it("shows the new release once without overwriting the older release record", () => {
    const oldKey = "pasteboard_pro_whats_new_release_1_3_0";
    const memory = new Map([[oldKey, "1.3.0"]]);
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value); },
    };
    expect(shouldShowWhatsNew(storage)).toBe(true);
    markWhatsNewSeen(storage);
    expect(shouldShowWhatsNew(storage)).toBe(false);
    expect(memory.get(oldKey)).toBe("1.3.0");
  });
});
