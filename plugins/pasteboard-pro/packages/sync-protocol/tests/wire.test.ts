import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  objectAad,
  objectPath,
  parseVaultEnvelope,
} from "../src";

describe("PasteboardPro v1 wire format", () => {
  it("canonicalizes nested JSON with lexical keys and no whitespace", () => {
    expect(
      canonicalJson({ z: 1, a: { y: [3, { b: true, a: null }], x: "text" } }),
    ).toBe('{"a":{"x":"text","y":[3,{"a":null,"b":true}]},"z":1}');
  });

  it("rejects values that cannot cross the Rust/Node JSON boundary", () => {
    expect(() => canonicalJson({ value: undefined })).toThrow(/undefined/i);
    expect(() => canonicalJson({ value: Number.NaN })).toThrow(/finite/i);
    expect(() => canonicalJson({ value: 1n })).toThrow(/bigint/i);
    expect(() => canonicalJson(Array(1))).toThrow(/sparse/i);
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(/cyclic/i);
  });

  it("preserves prototype-looking keys as ordinary canonical JSON fields", () => {
    const value = Object.create(null) as Record<string, unknown>;
    value.__proto__ = { safe: true };
    value.a = 1;
    expect(canonicalJson(value)).toBe('{"__proto__":{"safe":true},"a":1}');
  });

  it("builds exact AAD and immutable object paths", () => {
    const descriptor = {
      version: 1 as const,
      objectType: "item" as const,
      objectId: "item-1",
      revision: "rev-1",
    };
    expect(new TextDecoder().decode(objectAad(descriptor))).toBe(
      "1\0item\0item-1\0rev-1",
    );
    expect(objectPath(descriptor)).toBe("objects/item/item-1/rev-1.enc");
  });

  it("parses a strict v1 envelope and rejects unknown versions", () => {
    expect(
      parseVaultEnvelope({
        version: 1,
        objectType: "index",
        objectId: "main",
        revision: "rev-1",
        nonce: "AAAAAAAAAAAAAAAA",
        ciphertext: "AA==",
      }),
    ).toMatchObject({ objectType: "index", objectId: "main" });
    expect(() =>
      parseVaultEnvelope({
        version: 2,
        objectType: "index",
        objectId: "main",
        revision: "rev-1",
        nonce: "AAAAAAAAAAAAAAAA",
        ciphertext: "AA==",
      }),
    ).toThrow(/version/i);
  });
});
