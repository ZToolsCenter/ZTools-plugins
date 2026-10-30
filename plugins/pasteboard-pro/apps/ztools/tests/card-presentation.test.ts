import { describe, expect, it } from "vitest";
import { copiedTimeLabel, fileNames, itemLink, itemSummary } from "../src/card-presentation";
import type { PasteItem } from "@pasteboard-pro/core";
const item = {kind:"text",payload:{text:"你好🌈",revision:"1"}} as PasteItem;
describe("clipboard card presentation",()=>{
  it("counts Unicode characters rather than UTF-16 units",()=>{expect(itemSummary(item)).toBe("文本 · 3 字符");});
  it("does not expose non-web URL schemes as link previews",()=>{expect(itemLink({...item,kind:"url",payload:{text:"javascript:alert(1)",revision:"1"}})).toBeUndefined();});
  it("extracts names from both supported path separators",()=>{expect(fileNames({...item,payload:{revision:"1",filePaths:["/a/b.pdf","C:\\a\\b.txt"]}})).toEqual(["b.pdf","b.txt"]);});
  it("does not invent dimensions for an unloaded image",()=>{expect(itemSummary({...item,kind:"image"})).toBe("图片");expect(itemSummary({...item,kind:"image"},"640×480")).toBe("图片 · 640×480");});
  it("handles future and invalid times without negative ages",()=>{expect(copiedTimeLabel("invalid",0)).toBe("时间未知");expect(copiedTimeLabel("2026-10-23T13:00:00Z",Date.parse("2026-10-23T12:00:00Z"))).toBe("刚刚");});
});
