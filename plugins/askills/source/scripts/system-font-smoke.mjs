import assert from "node:assert/strict";

// Run in both actual native hosts, with their own isolated data directory.
export async function checkSystemFonts(page, invoke) {
  const names = await invoke("list_system_fonts");
  assert(names.includes("Microsoft YaHei"));
  assert(names.includes("Arial"));
  assert.equal(
    new Set(names.map((name) => name.toLowerCase())).size,
    names.length,
  );
  const snapshot = await invoke("get_snapshot");
  assert.equal(snapshot.appearance.fontFamily, "Microsoft YaHei");
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("DOM.enable");
    await session.send("CSS.enable");
    const { root } = await session.send("DOM.getDocument");
    const { nodeId } = await session.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: ".page-head h1",
    });
    const actual = await session.send("CSS.getPlatformFontsForNode", {
      nodeId,
    });
    assert(
      actual.fonts.some(
        (font) =>
          /Microsoft YaHei|微软雅黑/.test(font.familyName) &&
          !font.isCustomFont &&
          font.glyphCount > 0,
      ),
    );
    const resources = await page.evaluate(() =>
      performance.getEntriesByType("resource").map((entry) => entry.name),
    );
    assert(!resources.some((name) => /\.(ttf|otf|woff2?)(\?|$)/i.test(name)));
    return { installedFamilies: names.length, rendered: actual.fonts };
  } finally {
    await session.detach();
  }
}
