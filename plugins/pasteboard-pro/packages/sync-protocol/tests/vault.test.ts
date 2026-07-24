import { describe, expect, it } from "vitest";

import {
  canonicalVaultIndex,
  canonicalVaultMetadata,
  createVaultMetadata,
  parseVaultIndex,
  parseVaultMetadata,
} from "../src";

describe("PasteboardPro vault manifests", () => {
  it("freezes exact v1 KDF/cipher metadata around one public salt", () => {
    const metadata = createVaultMetadata(new Uint8Array(16).fill(7));
    expect(canonicalVaultMetadata(metadata)).toBe(
      '{"cipher":{"name":"AES-256-GCM","nonceLength":12,"tagLength":16},"kdf":{"N":32768,"keyLength":32,"name":"scrypt","p":1,"r":8,"salt":"BwcHBwcHBwcHBwcHBwcHBw=="},"version":1}',
    );
    expect(parseVaultMetadata(metadata)).toEqual(metadata);
    expect(() => parseVaultMetadata({ ...metadata, version: 2 })).toThrow(/version/i);
  });

  it("sorts index entries and rejects path substitution or duplicate identities", () => {
    const index = parseVaultIndex({
      version: 1,
      objects: [
        {
          objectType: "pinboard",
          objectId: "board-1",
          revision: "rev-2",
          path: "objects/pinboard/board-1/rev-2.enc",
        },
        {
          objectType: "item",
          objectId: "item-1",
          revision: "rev-1",
          path: "objects/item/item-1/rev-1.enc",
        },
      ],
    });
    expect(index.objects.map((entry) => entry.objectType)).toEqual(["item", "pinboard"]);
    expect(canonicalVaultIndex(index)).not.toContain(" ");
    expect(() =>
      parseVaultIndex({
        version: 1,
        objects: [{ ...index.objects[0], path: "objects/item/other/rev-1.enc" }],
      }),
    ).toThrow(/path/i);
    expect(() =>
      parseVaultIndex({ version: 1, objects: [index.objects[0], index.objects[0]] }),
    ).toThrow(/duplicate/i);
  });
});
