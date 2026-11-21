"use strict";

const assert = require("node:assert/strict");

async function setPublicSourceCaret(page, token, offset = 0, options = {}) {
  const targetOptions = { exactLine: false, last: false, ...options };
  const result = await page.evaluate((target) => {
    let view = null;
    for (let element = document.querySelector("#write .cm-editor")?.parentElement; element && !view; element = element.parentElement) {
      const fiberKey = Object.keys(element).find((key) => key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$"));
      let fiber = fiberKey ? element[fiberKey] : null;
      while (fiber && !view) {
        for (let hook = fiber.memoizedState; hook; hook = hook.next) {
          const candidate = hook.memoizedState?.current;
          if (candidate?.state?.doc && typeof candidate.dispatch === "function" && typeof candidate.focus === "function") {
            view = candidate;
            break;
          }
        }
        fiber = fiber.return;
      }
    }
    if (!view) return { found: false, reason: "EditorView unavailable" };
    const doc = view.state.doc;
    let start = -1;
    if (target.exactLine) {
      for (let number = 1; number <= doc.lines; number++) {
        const line = doc.line(number);
        if (line.text === target.token && start < 0) start = line.from;
      }
    } else {
      start = target.last ? doc.toString().lastIndexOf(target.token) : doc.toString().indexOf(target.token);
    }
    if (start < 0 || target.offset < 0 || target.offset > target.token.length) {
      return { found: false, reason: "source token not found", start, length: doc.length };
    }
    const position = start + target.offset;
    view.focus();
    view.dispatch({ selection: { anchor: position }, scrollIntoView: true });
    return { found: true, position, head: view.state.selection.main.head, sourceLength: doc.length };
  }, { token, offset, ...targetOptions });
  assert.equal(result.found, true, `could not place source caret in ${JSON.stringify(token)}: ${JSON.stringify(result)}`);
  assert.equal(result.head, result.position, `source caret must match the requested offset: ${JSON.stringify(result)}`);
  return result;
}

module.exports = { setPublicSourceCaret };
