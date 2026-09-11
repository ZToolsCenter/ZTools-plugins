import { describe, expect, it } from "vitest";

import { parseCodesignDetails } from "../scripts/attest-vision-helper.mjs";

describe("Vision helper attestation", () => {
  it("parses Developer ID and hardened-runtime evidence", () => {
    expect(
      parseCodesignDetails(`Executable=/tmp/pasteboard-vision
Identifier=pasteboard-vision
CodeDirectory v=20500 size=123 flags=0x10000(runtime) hashes=3+7 location=embedded
Signature size=9050
Authority=Developer ID Application: Example Corp (ABCDE12345)
Authority=Developer ID Certification Authority
TeamIdentifier=ABCDE12345`),
    ).toEqual({
      identifier: "pasteboard-vision",
      signature: null,
      authorities: [
        "Developer ID Application: Example Corp (ABCDE12345)",
        "Developer ID Certification Authority",
      ],
      teamIdentifier: "ABCDE12345",
      hardenedRuntime: true,
    });
  });

  it("parses an ad-hoc signature without inventing an authority", () => {
    expect(
      parseCodesignDetails(`Executable=/tmp/pasteboard-vision
Identifier=pasteboard-vision
Signature=adhoc
TeamIdentifier=not set`),
    ).toMatchObject({
      signature: "adhoc",
      authorities: [],
      hardenedRuntime: false,
    });
  });
});
