import { describe, expect, test } from "bun:test";
import { detectHostKind, usesEmbeddedSearch } from "./index";

describe("宿主检测", () => {
  test("同时存在 uTools 和 preload services 时使用正式插件宿主", () => {
    expect(detectHostKind({ utools: {}, gooseMonitor: {} })).toBe("utools");
  });

  test("uTools 存在但 preload services 缺失时禁止降级 mock", () => {
    expect(detectHostKind({ utools: {} }, true)).toBe("unavailable");
  });

  test("普通浏览器只在明确允许开发 mock 时启用", () => {
    expect(detectHostKind(null)).toBe("unavailable");
    expect(detectHostKind(null, true)).toBe("browser");
    expect(detectHostKind({ gooseMonitor: {} }, true)).toBe("browser");
  });
});

describe("搜索入口", () => {
  test("正式 uTools 使用 subInput，不渲染内部搜索", () => {
    expect(usesEmbeddedSearch("utools")).toBe(false);
  });

  test("浏览器开发 mock 在工具栏显示紧凑搜索", () => {
    expect(usesEmbeddedSearch("browser")).toBe(true);
  });

  test("宿主不可用时也不渲染开发搜索", () => {
    expect(usesEmbeddedSearch("unavailable")).toBe(false);
  });
});
