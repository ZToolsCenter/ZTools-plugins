import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const files = await Promise.all([
  "src/App.svelte",
  "src/adapter.ts",
  "src/components/Shelf.svelte",
  "src/components/Timeline.svelte",
  "src/components/PasteCard.svelte",
  "src/components/PinboardStrip.svelte",
  "src/components/Preview.svelte",
  "src/components/PasteStack.svelte",
  "src/components/Preferences.svelte",
  "src/components/TextEditor.svelte",
  "public/plugin.json",
].map((path) => readFile(new URL(path, root), "utf8")));

const [app, adapter, shelf, timeline, card, pinboards, preview, stack, preferences, editor, manifest] = files;
for (const command of ["listItems", "listPinboards", "createPinboard", "renamePinboard", "assignItems", "captureStatus", "setCapturePaused", "windowState", "hideShelf", "pasteItem", "syncNow"]) {
  assert.match(adapter, new RegExp(`\\b${command}\\b`));
}
for (const shortcut of ["metaKey", "ArrowLeft", "ArrowRight", "Enter", "Escape"]) {
  assert.match(app, new RegExp(shortcut));
}
assert.match(app, /reducePasteStack/);
assert.match(app, /reduceSelection/);
assert.match(app, /setInterval\(\(\) => void load\(true\), 1_000\)/);
assert.match(shelf, /backdrop-filter: blur\(28px\)/);
assert.match(shelf, /shelf--bottom/);
assert.match(shelf, /border-bottom-right-radius: 0/);
assert.match(timeline, /ResizeObserver/);
assert.match(timeline, /items\.slice\(start, end\)/);
assert.match(card, /application\/x-pasteboard-pro-item/);
assert.match(pinboards, /ondrop/);
assert.match(preview, /纯文本/);
assert.match(stack, /粘贴队列/);
assert.match(preferences, /历史保留天数/);
assert.match(preferences, /屏幕共享时隐藏浮窗/);
assert.match(editor, /新建文本/);
assert.match(editor, /编辑文本/);
assert.match(editor, /正在保存/);
const parsedManifest = JSON.parse(manifest);
assert.deepEqual(parsedManifest.permissions, ["pasteboard.read", "pasteboard.write", "pasteboard.sync", "pasteboard.paste", "clipboard.write"]);

console.log("ATools PasteboardPro Svelte source verified");
