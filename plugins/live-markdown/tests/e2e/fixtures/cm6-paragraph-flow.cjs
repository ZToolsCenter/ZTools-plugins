"use strict";

/** Measure text in CM6 even when decorations split one visible token across DOM nodes. */
async function characterRect(page, text, from = "#write .cm-content", occurrence = "first", within = null) {
  return page.locator(from).evaluate((root, options) => {
    const lines = root.matches(".cm-line") ? [root] : [...root.querySelectorAll(".cm-line")];
    let result = null;
    for (const line of lines) {
      if (options.within && !line.textContent.includes(options.within)) continue;
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      const nodes = [];
      let visibleText = "";
      while (walker.nextNode()) {
        const node = walker.currentNode;
        nodes.push({ node, from: visibleText.length, to: visibleText.length + node.textContent.length });
        visibleText += node.textContent;
      }
      const index = options.occurrence === "last"
        ? visibleText.lastIndexOf(options.text)
        : visibleText.indexOf(options.text);
      if (index < 0) continue;
      const locate = (offset) => nodes.find((entry) => offset >= entry.from && offset < entry.to);
      const start = locate(index);
      const end = locate(index + options.text.length - 1);
      if (!start || !end) continue;
      const range = document.createRange();
      range.setStart(start.node, index - start.from);
      range.setEnd(end.node, index + options.text.length - end.from);
      const rect = range.getBoundingClientRect();
      result = { x: rect.x, y: rect.y, right: rect.right, width: rect.width, height: rect.height };
      if (options.occurrence !== "last") break;
    }
    return result;
  }, { text, occurrence, within });
}

module.exports = { characterRect };
