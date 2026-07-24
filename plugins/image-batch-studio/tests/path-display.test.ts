import { describe, expect, it } from "vitest";
import { basename, shortPath } from "../src/ui/path-display";

describe("path display helpers", () => {
  it("handles POSIX and Windows path separators", () => {
    expect(basename("/Users/harris/Desktop/image.png")).toBe("image.png");
    expect(basename("C:\\Users\\harris\\Desktop\\image.png")).toBe("image.png");
    expect(shortPath("/Users/harris/Desktop/output")).toBe(".../Desktop/output");
    expect(shortPath("C:\\Users\\harris\\Desktop\\output")).toBe("...\\Desktop\\output");
  });
});
