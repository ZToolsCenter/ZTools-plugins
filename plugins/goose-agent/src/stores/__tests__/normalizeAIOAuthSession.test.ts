import { describe, expect, it } from "vitest";
import { normalizeAIOAuthSession } from "../settings/types";

describe("normalizeAIOAuthSession", () => {
  it("保留可选 source 字段", () => {
    const session = normalizeAIOAuthSession({
      accessToken: " tok ",
      providerId: "xai",
      source: " grok_cli ",
      accountLabel: " user@x.ai ",
    });
    expect(session).toEqual({
      accessToken: "tok",
      providerId: "xai",
      source: "grok_cli",
      accountLabel: "user@x.ai",
    });
  });

  it("无 source / 空 source 不写入", () => {
    expect(
      normalizeAIOAuthSession({ accessToken: "a", source: "   " })?.source,
    ).toBeUndefined();
    expect(
      normalizeAIOAuthSession({ accessToken: "a" })?.source,
    ).toBeUndefined();
  });

  it("无 accessToken → null", () => {
    expect(normalizeAIOAuthSession({ source: "grok_cli" })).toBeNull();
    expect(normalizeAIOAuthSession(null)).toBeNull();
  });
});
