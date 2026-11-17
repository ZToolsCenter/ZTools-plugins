"use strict";

const assert = require("node:assert/strict");

const THIN_PROSE_MARKER = "正文文本槽：";

function readThinProseSlots(prompt) {
  const markerAt = prompt.lastIndexOf(THIN_PROSE_MARKER);
  assert.notEqual(markerAt, -1, "thin prose prompts include a JSON text-slot payload");
  let payload;
  try {
    payload = JSON.parse(prompt.slice(markerAt + THIN_PROSE_MARKER.length).trim());
  } catch (cause) {
    throw new Error("The thin prose slot payload must be valid JSON", { cause });
  }
  assert.ok(payload && typeof payload === "object" && Array.isArray(payload.slots), "the slot payload includes slots");
  const ids = new Set();
  for (const slot of payload.slots) {
    assert.ok(slot && typeof slot.id === "string" && slot.id.length > 0, "each prose slot has an ID");
    assert.ok(typeof slot.text === "string" && slot.text.length > 0, "each prose slot has source text");
    assert.ok(!ids.has(slot.id), `slot ID ${slot.id} is unique within its request`);
    ids.add(slot.id);
  }
  return payload.slots;
}

function assertOnlyAuthorizedProse(prompt, source) {
  const slots = readThinProseSlots(prompt);
  let sourceCursor = 0;
  for (const slot of slots) {
    const slotStart = source.indexOf(slot.text, sourceCursor);
    assert.notEqual(slotStart, -1, `editable text ${JSON.stringify(slot.text)} comes from the authorized source in order`);
    sourceCursor = slotStart + slot.text.length;
    for (const [key, value] of [["contextBefore", slot.contextBefore], ["contextAfter", slot.contextAfter]]) {
      if (value === undefined) continue;
      assert.ok(typeof value === "string", `${key} is text when present`);
      assert.ok(source.includes(value), `${key} ${JSON.stringify(value)} comes from the authorized source`);
    }
  }
  return slots;
}

function thinProseResponse(prompt, from, to) {
  assert.ok(typeof from === "string" && from.length > 0, "the response fixture needs a non-empty exact match");
  const slots = readThinProseSlots(prompt);
  let replaced = false;
  const edits = slots.map(({ id, text }) => {
    if (!replaced && text.includes(from)) {
      replaced = true;
      return { id, text: text.replace(from, to) };
    }
    return { id, text };
  });
  if (replaced) return JSON.stringify({ edits });

  const segments = [];
  let cursor = 0;
  for (const { id, text } of slots) {
    const start = from.indexOf(text, cursor);
    if (start < 0) break;
    segments.push({ id, start, end: start + text.length });
    cursor = start + text.length;
  }
  if (segments.length !== slots.length) {
    assert.fail(`the authorized prose slots should contain ${JSON.stringify(from)}`);
  }
  const prefix = from.slice(0, segments[0].start);
  const suffix = from.slice(segments.at(-1).end);
  if (!to.startsWith(prefix) || (suffix && !to.endsWith(suffix))) {
    assert.fail("a cross-slot response must preserve text outside all owned slots");
  }
  const gaps = segments.slice(0, -1).map((segment, index) => from.slice(segment.end, segments[index + 1].start));
  let replacementCursor = prefix.length;
  const replacementTexts = [];
  for (const gap of gaps) {
    const gapStart = to.indexOf(gap, replacementCursor);
    if (gapStart < 0) assert.fail("a cross-slot response must preserve protected source bytes between slots");
    replacementTexts.push(to.slice(replacementCursor, gapStart));
    replacementCursor = gapStart + gap.length;
  }
  const editableEnd = to.length - suffix.length;
  if (editableEnd < replacementCursor) assert.fail("the cross-slot response does not preserve source slot order");
  replacementTexts.push(to.slice(replacementCursor, editableEnd));
  return JSON.stringify({ edits: segments.map(({ id }, index) => ({ id, text: replacementTexts[index] })) });
}

module.exports = { readThinProseSlots, thinProseResponse, assertOnlyAuthorizedProse };
