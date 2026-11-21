"use strict";

const NATURAL_MARKDOWN_MARKER = "【待编辑 Markdown】\n";
const LEGACY_PROSE_MARKER = "【待编辑文本槽】\n";

function proseResponse(prompt, transform) {
  const naturalAt = prompt.indexOf(NATURAL_MARKDOWN_MARKER);
  if (naturalAt >= 0) {
    const sourceMarkdown = prompt.slice(naturalAt + NATURAL_MARKDOWN_MARKER.length);
    if (!sourceMarkdown) throw new Error("Expected a source-owned Markdown fragment");
    return transform(sourceMarkdown);
  }

  const legacyAt = prompt.indexOf(LEGACY_PROSE_MARKER);
  if (legacyAt < 0) throw new Error("Expected a source-owned prose request");
  const batch = JSON.parse(prompt.slice(legacyAt + LEGACY_PROSE_MARKER.length));
  return JSON.stringify({
    protocol: batch.protocol,
    batchId: batch.batchId,
    edits: batch.slots.map(({ id, text }) => {
      const replacement = transform(text);
      return replacement === text ? { id, status: "unchanged" } : { id, status: "replace", text: replacement };
    })
  });
}

module.exports = { NATURAL_MARKDOWN_MARKER, proseResponse };
