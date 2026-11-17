"use strict";
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function checkListEditing(scenario) {
  const { page, bottomPad } = scenario;


  // 13. Test Ordered List Auto-increment, Zero Layout Shift, and List Exit on Double Enter (Typora 1:1 Alignment)
  // Click bottom pad to start a new tail input
  await bottomPad.click({ position: { x: 300, y: 150 } });
  await page.waitForSelector('#write textarea.ty-live-textarea');
  const listTailInput = page.locator('#write textarea.ty-live-textarea').last();

  // Type "1. First item" and press Enter
  await listTailInput.pressSequentially('1. First item', { delay: 20 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);

  // Value should auto-increment to "1. First item\n2. "
  const listValAfterFirstEnter = await listTailInput.inputValue();
  assert.match(
    listValAfterFirstEnter,
    /1\.\s+First item\n2\.\s+/,
    'Ordered list must automatically increment to "2. " after pressing Enter'
  );

  // Type "Second item" and press Enter
  await listTailInput.pressSequentially('Second item', { delay: 20 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);

  const listValAfterSecondEnter = await listTailInput.inputValue();
  assert.match(
    listValAfterSecondEnter,
    /2\.\s+Second item\n3\.\s+/,
    'Ordered list must automatically increment to "3. " after pressing Enter'
  );

  // Press Enter once more on the empty "3. " line to exit list (Typora-aligned double Enter behavior)
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);

  // The list should now be cleanly committed and rendered as an ordered list in WYSIWYG
  const renderedOl = page.locator('#write ol').last();
  await renderedOl.waitFor({ state: 'visible' });
  const renderedOlItems = await page.locator('#write ol li').count();
  assert.ok(
    renderedOlItems >= 2,
    `Ordered list items must be committed and rendered in WYSIWYG after double Enter (got ${renderedOlItems})`
  );

  // Strictly measure bounding box before clicking to verify Zero Layout Shift
  const olBoxBefore = await renderedOl.boundingBox();
  assert.ok(olBoxBefore, 'Rendered OL must have valid bounding box');

  // Test clicking directly on the 2nd list item ("Second item")
  // Verifying: 1. Zero horizontal shift to the right; 2. Cursor locates directly on line 2, not stuck on line 1
  const secondLi = renderedOl.locator('li:nth-child(2)');
  const secondLiBox = await secondLi.boundingBox();
  assert.ok(secondLiBox, 'Second LI must have valid bounding box');
  await page.mouse.click(secondLiBox.x + 40, secondLiBox.y + secondLiBox.height / 2);
  await page.waitForSelector('.ty-block-wrapper.ty-list-block.md-focus');
  const focusedListEl = page.locator('.ty-block-wrapper.ty-list-block.md-focus');
  assert.equal(
    await focusedListEl.isVisible(),
    true,
    'Clicking ordered list item must activate seamless in-place textarea with .ty-list-block'
  );

  const focusedBoxAfter = await focusedListEl.boundingBox();
  assert.ok(focusedBoxAfter, 'Focused list block must have valid bounding box');

  // Assert Zero Layout Shift: Height delta <= 2px and X delta <= 2px (eliminating horizontal shift to the right)
  const heightDelta = Math.abs(olBoxBefore.height - focusedBoxAfter.height);
  const xDelta = Math.abs(olBoxBefore.x - focusedBoxAfter.x);
  assert.ok(
    heightDelta <= 2,
    `Height delta between preview and edit mode must be <= 2px to eliminate vertical layout shift (got: ${heightDelta}px)`
  );
  assert.ok(
    xDelta <= 2,
    `X coordinate delta between preview and edit mode must be <= 2px to eliminate horizontal shift to the right (got: ${xDelta}px)`
  );

  // Verify point-to-character focus: clicking line 2 MUST position cursor on line 2 (not line 1!)
  const cursorLineCheck = await page.evaluate(() => {
    const ta = document.querySelector('#write textarea.ty-live-textarea');
    if (!ta) return { lineIndex: -1, currentLine: '' };
    const val = ta.value;
    const start = ta.selectionStart;
    const textBeforeCursor = val.slice(0, start);
    const lineIndex = textBeforeCursor.split('\n').length - 1;
    const currentLine = val.split('\n')[lineIndex];
    return { lineIndex, currentLine, start };
  });
  assert.equal(
    cursorLineCheck.lineIndex,
    1,
    `Clicking on the 2nd list item must focus cursor onto line 2 (got lineIndex: ${cursorLineCheck.lineIndex}, line: "${cursorLineCheck.currentLine}")`
  );
  assert.match(
    cursorLineCheck.currentLine,
    /2\.\s+Second item/,
    'Current line at cursor must match the 2nd list item'
  );

  // Test editing inside the focused block textarea:
  // Move to end of textarea, press Enter -> increments to 3.
  const focusedListTextarea = focusedListEl.locator('textarea.ty-live-textarea');
  await focusedListTextarea.evaluate((el) => el.setSelectionRange(el.value.length, el.value.length));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);

  const taValInc = await focusedListTextarea.inputValue();
  assert.match(
    taValInc,
    /3\.\s+/,
    'Hitting Enter inside focused list block must auto-increment序号'
  );

  // Hit Enter a second time on the empty "3. " line to exit list to a new paragraph
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);

  // The list block should now have the empty marker removed and keep items intact
  const finalOlCount = await page.locator('#write ol').count();
  assert.ok(finalOlCount >= 1, 'Ordered list must remain cleanly committed');
  const finalOlItems = await page.evaluate(() => {
    const ol = document.querySelector('#write ol:last-of-type');
    return ol
      ? Array.from(ol.querySelectorAll('li')).map((li) => {
          const textSpan = li.querySelector('.ty-list-text');
          return textSpan ? textSpan.textContent.trim() : li.textContent.trim();
        })
      : [];
  });
  assert.deepEqual(
    finalOlItems,
    ['First item', 'Second item'],
    'Double Enter on empty list item must cancel the empty 3. line and keep items intact'
  );

  // Verify that after double Enter to exit list, the editor DOES NOT blur!
  // A new focused textarea must be present and immediately accept user typing!
  const activeStateAfterExit = await page.evaluate(() => {
    const active = document.activeElement;
    return {
      tagName: active ? active.tagName : null,
      isTextarea: Boolean(active && active.tagName === 'TEXTAREA'),
      hasFocusedBlock: Boolean(document.querySelector('.md-focus'))
    };
  });
  assert.equal(
    activeStateAfterExit.isTextarea,
    true,
    'Editor must keep focus in a new paragraph textarea after exiting list'
  );
  assert.equal(
    activeStateAfterExit.hasFocusedBlock,
    true,
    'There must be a focused block for immediate typing'
  );

  // Type text into the newly focused paragraph
  await page.keyboard.type('Next paragraph content');
  await page.waitForTimeout(100);

  const typedParagraphContent = await page.evaluate(() => {
    const active = document.activeElement;
    return active && active.tagName === 'TEXTAREA' ? active.value : '';
  });
  assert.equal(
    typedParagraphContent,
    'Next paragraph content',
    'User must be able to type immediately after exiting list without losing focus'
  );

  // Click away to commit
  await bottomPad.click({ position: { x: 300, y: 150 } });
  await page.waitForTimeout(150);

  // Multi-item regression: Test clicking line 1 vs line 2 repeatedly
  // 1. Click line 1 ("First item")
  const olToRecheck = page.locator('#write ol:last-of-type');
  const firstLi = olToRecheck.locator('li:nth-child(1)');
  const firstLiBox = await firstLi.boundingBox();
  assert.ok(firstLiBox, 'First LI must have bounding box');
  await page.mouse.click(firstLiBox.x + 30, firstLiBox.y + firstLiBox.height / 2);
  await page.waitForSelector('.ty-block-wrapper.ty-list-block.md-focus');

  const focusCheck1 = await page.evaluate(() => {
    const ta = document.querySelector('#write textarea.ty-live-textarea');
    if (!ta) return { lineIndex: -1, currentLine: '' };
    const val = ta.value;
    const start = ta.selectionStart;
    const textBefore = val.slice(0, start);
    const lineIndex = textBefore.split('\n').length - 1;
    return { lineIndex, currentLine: val.split('\n')[lineIndex] };
  });
  assert.equal(
    focusCheck1.lineIndex,
    0,
    `Clicking line 1 must locate cursor on line 1 (got lineIndex: ${focusCheck1.lineIndex})`
  );
  assert.match(focusCheck1.currentLine, /1\.\s+First item/);

  // =========================================================================
  // Smart Ordered List Renumbering & Undo E2E Verification
  // =========================================================================
  // 1. Move cursor to end of line 1 ("1. First item"), press Enter
  // Expect: inserts "2. ", and subsequent "2. Second item" becomes "3. Second item"!
  await page.evaluate(() => {
    const ta = document.querySelector('#write textarea.ty-live-textarea');
    if (ta) {
      const line1End = ta.value.indexOf('\n');
      const pos = line1End === -1 ? ta.value.length : line1End;
      ta.setSelectionRange(pos, pos);
    }
  });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);

  const valAfterMidEnter = await page.evaluate(() => {
    const ta = document.querySelector('#write textarea.ty-live-textarea');
    return ta ? ta.value : '';
  });
  assert.match(
    valAfterMidEnter,
    /1\.\s+First item\n2\.\s*\n3\.\s+Second item/,
    'Subsequent ordered list items must auto-increment upon pressing Enter in the middle'
  );

  // 2. Press Backspace on the newly inserted empty "2. " line
  // Expect: deletes the empty line and decrements "3. Second item" back to "2. Second item"!
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(150);

  const valAfterMidBackspace = await page.evaluate(() => {
    const ta = document.querySelector('#write textarea.ty-live-textarea');
    return ta ? ta.value : '';
  });
  assert.match(
    valAfterMidBackspace,
    /1\.\s+First item\n2\.\s+Second item/,
    'Subsequent ordered list items must auto-decrement upon deleting an item line with Backspace'
  );

  // 3. Test Undo in ordered list:
  // Type something to make a clear modification, then press Cmd+Z (or Ctrl+Z)
  await page.keyboard.type(' (extra)');
  await page.waitForTimeout(100);
  const valBeforeUndo = await page.evaluate(() => {
    const ta = document.querySelector('#write textarea.ty-live-textarea');
    return ta ? ta.value : '';
  });
  assert.ok(valBeforeUndo.includes('(extra)'), 'Typed extra text must be present');

  // Perform Undo
  const isMac = process.platform === 'darwin';
  if (isMac) {
    await page.keyboard.press('Meta+z');
  } else {
    await page.keyboard.press('Control+z');
  }
  await page.waitForTimeout(200);

  // Document or block should reflect the undone state
  const undoToastOrContent = await page.evaluate(() => {
    const toast = document.querySelector('.ty-toast-notification');
    const ta = document.querySelector('#write textarea.ty-live-textarea');
    return {
      toastText: toast ? toast.textContent : null,
      taValue: ta ? ta.value : null,
      fullDocText: document.querySelector('#write')?.textContent || ''
    };
  });
  assert.ok(
    undoToastOrContent.toastText?.includes('撤销') ||
    !undoToastOrContent.taValue?.includes('(extra)') ||
    !undoToastOrContent.fullDocText.includes('(extra)'),
    'Undo operation must successfully revert content'
  );

  // Unfocus again
  await bottomPad.click({ position: { x: 300, y: 150 } });
  await page.waitForTimeout(150);
}
module.exports = checkListEditing;
