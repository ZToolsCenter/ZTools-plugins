import { describe, expect, test } from "bun:test";
import { layoutForCat, metricHdrLabel } from "./category-layout";

describe("列表表头", () => {
  test("分组计数使用准确文案", () => {
    expect(metricHdrLabel("procs")).toBe("进程数");
  });

  test("常规视图无行内操作列，网络固定为下载/上传/CPU/内存", () => {
    expect(layoutForCat("all").gridTemplate.split(" ")).toHaveLength(5);
    expect(layoutForCat("all").gridTemplate).toBe("16px minmax(140px,1fr) 44px 56px 60px");
    expect(layoutForCat("gui").metrics).toEqual(["procs", "cpu", "mem"]);
    expect(layoutForCat("net").metrics).toEqual(["download", "upload", "cpu", "mem"]);
    expect(metricHdrLabel("download")).toBe("下载");
    expect(metricHdrLabel("upload")).toBe("上传");
  });

  test("宽屏剩余空间只分配给名称列", () => {
    for (const cat of ["all", "gui", "mem", "cpu", "net"] as const) {
      const tracks = layoutForCat(cat).gridTemplate.split(" ");
      expect(tracks[1]).toContain("1fr");
      expect(tracks.slice(2).every((track) => !track.includes("fr"))).toBe(true);
    }
  });

});
