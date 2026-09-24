import { describe, expect, it } from "vitest";
import { bytesLabel, formatDefinition, FORMAT_DEFINITIONS, PROFILE_COPY, TARGET_GROUPS } from "../../src/lib/formats";

describe("renderer format metadata", () => {
  it("keeps target groups unique and backed by definitions", () => {
    const ids = TARGET_GROUPS.flatMap(group => group.ids);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach(id => expect(formatDefinition(id).id).toBe(id));
    expect(FORMAT_DEFINITIONS.some(item => item.id === "bmp")).toBe(true);
  });

  it("explains every quality profile", () => {
    expect(Object.keys(PROFILE_COPY)).toEqual(["visual", "editable", "extract"]);
    Object.values(PROFILE_COPY).forEach(item => expect(item.description.length).toBeGreaterThan(10));
  });

  it("formats byte counts for batch summaries", () => {
    expect(bytesLabel(512)).toBe("512 B");
    expect(bytesLabel(1536)).toBe("1.5 KB");
    expect(bytesLabel(2 * 1024 ** 2)).toBe("2.0 MB");
  });
});
