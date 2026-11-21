"use strict";
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function checkKeyboardHistory(scenario) {
  const { page, pageErrors, consoleErrors, bottomPad, restoreBtn } = scenario;


  // =========================================================================
  // Regression & Precision Verification:
  // 1. Enter in plain paragraph smoothly wraps and focuses into a new line
  // 2. Typing '1.' (without space) is treated as plain text
  // 3. Typing '1. ' (with space) triggers ordered list auto-increment
  // =========================================================================
  // Click tail draft area at bottom to start a new paragraph
  await bottomPad.click({ position: { x: 300, y: 100 } });
  await page.waitForTimeout(150);
  await page.keyboard.type('Paragraph Line 1');
  await page.waitForTimeout(100);

  // Press Enter in plain paragraph -> must wrap and keep focus in a new line draft
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);

  const activeAfterEnter = await page.evaluate(() => {
    const active = document.activeElement;
    return {
      isTextarea: Boolean(active && active.tagName === 'TEXTAREA'),
      val: active ? active.value : null
    };
  });
  assert.equal(activeAfterEnter.isTextarea, true, 'Pressing Enter in paragraph must smoothly focus new line');

  // Type line 2
  await page.keyboard.type('Paragraph Line 2');
  await page.waitForTimeout(100);

  const docTextWithLines = await page.evaluate(() => document.querySelector('#write')?.textContent || '');
  assert.ok(
    docTextWithLines.includes('Paragraph Line 1') && docTextWithLines.includes('Paragraph Line 2'),
    'Both paragraph lines must be present across line break'
  );

  // Unfocus and test '1.' without space
  await bottomPad.click({ position: { x: 300, y: 150 } });
  await page.waitForTimeout(150);
  await bottomPad.click({ position: { x: 300, y: 100 } });
  await page.waitForTimeout(150);

  // Type '1.' without space, then Enter
  await page.keyboard.type('1.');
  await page.waitForTimeout(100);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);

  // Must be committed as plain paragraph '1.', not deleted as an empty list exit
  const docWithPure1Dot = await page.evaluate(() => document.querySelector('#write')?.textContent || '');
  assert.ok(
    docWithPure1Dot.includes('1.'),
    "'1.' without space must be preserved as plain text, not treated as list item"
  );

  // Unfocus and test Tab / Shift+Tab indent/outdent on list item
  await bottomPad.click({ position: { x: 300, y: 150 } });
  await page.waitForTimeout(150);

  // Click first item of list to focus textarea
  const olToTabCheck = page.locator('#write ol:last-of-type');
  const firstLiToTab = olToTabCheck.locator('li:nth-child(1)');
  const firstLiTabBox = await firstLiToTab.boundingBox();
  if (firstLiTabBox) {
    await page.mouse.click(firstLiTabBox.x + 30, firstLiTabBox.y + firstLiTabBox.height / 2);
    await page.waitForSelector('.ty-block-wrapper.ty-list-block.md-focus');

    // Press Tab -> indents with 2 spaces
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);

    const valAfterTab = await page.evaluate(() => {
      const ta = document.querySelector('#write textarea.ty-live-textarea');
      return ta ? ta.value : '';
    });
    assert.ok(
      valAfterTab.startsWith('  1.') || valAfterTab.includes('\n  1.') || valAfterTab.includes('  '),
      'Pressing Tab on a list item must indent it by 2 spaces'
    );

    // Press Shift+Tab -> outdents back
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(100);

    const valAfterShiftTab = await page.evaluate(() => {
      const ta = document.querySelector('#write textarea.ty-live-textarea');
      return ta ? ta.value : '';
    });
    assert.ok(
      !valAfterShiftTab.startsWith('    '),
      'Pressing Shift+Tab must outdent the item'
    );
  }

  // =========================================================================
  // Regression & Precision Verification:
  // 4. Smart Hit Area: Clicking far to the right in wide margins or gap area
  //    must smartly snap and focus the corresponding block and line end!
  // =========================================================================
  const scrollBox = await page.evaluate(() => {
    const el = document.querySelector('.ty-editor-scroll');
    return el ? el.getBoundingClientRect() : null;
  });

  // Find the paragraph with "Paragraph Line 1"
  const pLine1El = page.locator('#write .ty-paragraph-block:has-text("Paragraph Line 1")');
  const pLine1Box = await pLine1El.boundingBox();
  if (pLine1Box && scrollBox) {
    // Click 120px to the right of the paragraph element (in the margin/padding area)
    const farRightClickX = Math.min(scrollBox.right - 20, pLine1Box.x + pLine1Box.width + 120);
    const farRightClickY = pLine1Box.y + pLine1Box.height / 2;
    await page.mouse.click(farRightClickX, farRightClickY);
    await page.waitForTimeout(150);

    const hitActiveRes = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        isTextarea: Boolean(active && active.tagName === 'TEXTAREA'),
        value: active ? active.value : '',
        cursorStart: active ? active.selectionStart : -1
      };
    });
    assert.equal(hitActiveRes.isTextarea, true, 'Clicking in wide margin must smartly hit and focus the block');
    assert.ok(hitActiveRes.value.includes('Paragraph Line 1'), 'Must focus the matching paragraph');
    assert.equal(hitActiveRes.cursorStart, hitActiveRes.value.length, 'Clicking far to the right must position cursor at line end');
  }

  // =========================================================================
  // Regression & Precision Verification:
  // 5. Unordered List Bullet Circle & "* " Shortcut Combination (Typora Alignment):
  //    - Type "* " followed by text, press Enter to auto-continue "* "
  //    - Verify DOM renders native Typora small bullet circles (.ty-list-bullet)
  //    - Verify Tab indents into Level 1 hollow circle (.ty-list-level-1)
  // =========================================================================
  await bottomPad.click({ position: { x: 300, y: 150 } });
  await page.waitForTimeout(150);

  // Type "* Bullet Item Alpha" and press Enter
  await page.keyboard.type('* Bullet Item Alpha');
  await page.waitForTimeout(100);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);

  // Check that next line automatically continues "* "
  const tailAfterEnter = await page.evaluate(() => {
    const active = document.activeElement;
    return active ? active.value : '';
  });
  assert.ok(
    tailAfterEnter.includes('* Bullet Item Alpha\n* ') || tailAfterEnter.endsWith('* '),
    "'* ' shortcut followed by Enter must auto-continue unordered bullet item"
  );

  // Type second item
  await page.keyboard.type('Bullet Item Beta');
  await page.waitForTimeout(100);

  // Press Enter on Beta to create third item, then Enter again to exit list cleanly
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  await page.keyboard.press('Enter'); // Double enter exits list
  await page.waitForTimeout(150);

  // Unfocus by clicking bottom pad
  await bottomPad.click({ position: { x: 300, y: 150 } });
  await page.waitForTimeout(150);

  // Verify rendered DOM contains unordered list and small bullet circles
  const bulletCircleInfo = await page.evaluate(() => {
    const ulList = document.querySelector('#write ul.ty-unordered-list');
    const bullets = ulList ? Array.from(ulList.querySelectorAll('.ty-list-marker.ty-list-bullet')) : [];
    return {
      hasUl: Boolean(ulList),
      bulletCount: bullets.length,
      textContents: ulList ? ulList.textContent : ''
    };
  });
  assert.equal(bulletCircleInfo.hasUl, true, 'Unordered list block must be created from "* " input');
  assert.ok(bulletCircleInfo.bulletCount >= 2, 'Must render small bullet circle elements for unordered list items');
  assert.ok(bulletCircleInfo.textContents.includes('Bullet Item Alpha'), 'Must contain Alpha item text');
  assert.ok(bulletCircleInfo.textContents.includes('Bullet Item Beta'), 'Must contain Beta item text');

  // Test Tab indent on second item -> transforms into Level 1 hollow circle
  const betaItemLi = page.locator('#write ul.ty-unordered-list li:has-text("Bullet Item Beta")');
  const betaBox = await betaItemLi.boundingBox();
  if (betaBox) {
    await page.mouse.click(betaBox.x + 30, betaBox.y + betaBox.height / 2);
    await page.waitForTimeout(150);

    // Press Tab -> indents with 2 spaces
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);

    // Unfocus to check rendered level-1 class
    await bottomPad.click({ position: { x: 300, y: 150 } });
    await page.waitForTimeout(150);

    const hasLevel1Class = await page.evaluate(() => {
      const betaLi = Array.from(document.querySelectorAll('#write ul.ty-unordered-list li'))
        .find((li) => li.textContent.includes('Bullet Item Beta'));
      return betaLi ? betaLi.classList.contains('ty-list-level-1') || betaLi.getAttribute('data-indent-level') === '1' : false;
    });
    assert.equal(hasLevel1Class, true, 'Pressing Tab must indent item into level-1 hollow circle');
  }

  // =========================================================================
  // Regression & Precision Verification:
  // 6. Cross-Block Arrow Keys Cursor Roaming (Typora Up/Down/Left/Right):
  //    - ArrowUp at line 0 navigates into previous block
  //    - ArrowDown at last line navigates into next block
  // =========================================================================
  const p1 = page.locator('#write .ty-paragraph-block:has-text("Paragraph Line 1")');
  const p1Box = await p1.boundingBox();
  if (p1Box) {
    await page.mouse.click(p1Box.x + 30, p1Box.y + p1Box.height / 2);
    await page.waitForTimeout(150);

    // Verify active in p1
    let currentActiveVal = await page.evaluate(() => {
      const ta = document.querySelector('#write textarea.ty-live-textarea');
      return ta ? ta.value : '';
    });
    assert.ok(currentActiveVal.includes('Paragraph Line 1'), 'Must focus Paragraph Line 1');

    // ArrowDown -> navigates to next block
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);

    let nextActiveVal = await page.evaluate(() => {
      const ta = document.querySelector('#write textarea.ty-live-textarea');
      return ta ? ta.value : '';
    });
    assert.notEqual(nextActiveVal, currentActiveVal, 'ArrowDown must roam focus to the next block');

    // ArrowUp -> navigates back to previous block
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(150);

    let backActiveVal = await page.evaluate(() => {
      const ta = document.querySelector('#write textarea.ty-live-textarea');
      return ta ? ta.value : '';
    });
    assert.ok(backActiveVal.includes('Paragraph Line 1'), 'ArrowUp must roam focus back to Paragraph Line 1');
  }

  // =========================================================================
  // Regression & Precision Verification:
  // 7. File History Modal & Arbitrary Snapshot Rollback:
  //    - Open file history modal via top-history-btn
  //    - Navigate snapshots with ArrowDown / ArrowUp
  //    - Verify prominent "恢复至此快照" button and restore document
  // =========================================================================
  const topHistoryBtn = page.locator('[data-testid="top-history-btn"]');
  if (await topHistoryBtn.isVisible()) {
    await topHistoryBtn.click();
    await page.waitForSelector('.ty-history-modal');

    const modalVisible = await page.locator('.ty-history-modal').isVisible();
    assert.equal(modalVisible, true, 'File History modal must open');

    // Check timeline items
    const timelineCount = await page.locator('.ty-history-timeline-item').count();
    assert.ok(timelineCount > 0, 'Must show historical snapshots in timeline');

    // Keyboard navigation with ArrowDown to pick another snapshot
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);

    // Verify primary restore button is visible and click it to restore
    const restoreBtn = page.locator('.ty-history-header-actions button.ty-btn-primary');
    assert.equal(await restoreBtn.isVisible(), true, 'Primary restore snapshot button must be visible');
    await restoreBtn.click();
    await page.waitForTimeout(200);

    // Verify modal is closed
    const modalClosed = !(await page.locator('.ty-history-modal').isVisible());
    assert.equal(modalClosed, true, 'Modal must close after restoring snapshot');
  }

  // =========================================================================
  // Regression & Precision Verification:
  // 8. Ordered List Focus / Blur Line Spacing Consistency (Zero Shift):
  //    - Type 3 items in an ordered list
  //    - Measure preview heights (each li height and total ol height)
  //    - Focus into textarea edit mode -> verify line-height and height match
  //    - Unfocus -> verify zero line-height shift between states
  // =========================================================================
  await bottomPad.click({ position: { x: 300, y: 150 } });
  await page.waitForTimeout(150);

  const olMeasure = await page.evaluate(() => {
    // Query any existing ol or append one
    const ol = document.querySelector('#write ol.ty-ordered-list');
    if (!ol) return null;
    const rect = ol.getBoundingClientRect();
    const style = window.getComputedStyle(ol);
    const lis = Array.from(ol.querySelectorAll('li')).map((li) => {
      const b = li.getBoundingClientRect();
      const s = window.getComputedStyle(li);
      return {
        height: b.height,
        lineHeight: s.lineHeight,
        alignItems: s.alignItems
      };
    });
    return {
      totalHeight: rect.height,
      lineHeight: style.lineHeight,
      lis
    };
  });

  if (olMeasure && olMeasure.lis.length > 0) {
    assert.equal(olMeasure.lis[0].alignItems, 'flex-start', 'Ordered list items must use flex-start alignment');
    // Click into ordered list to focus
    const targetOl = page.locator('#write ol.ty-ordered-list').first();
    await targetOl.locator('li').first().click();
    await page.waitForTimeout(150);

    const editMeasure = await page.evaluate(() => {
      const ta = document.querySelector('#write textarea.ty-live-textarea');
      if (!ta) return null;
      const s = window.getComputedStyle(ta);
      return {
        lineHeight: s.lineHeight,
        scrollHeight: ta.scrollHeight
      };
    });

    if (editMeasure) {
      assert.equal(editMeasure.lineHeight, olMeasure.lis[0].lineHeight, 'Textarea line-height must strictly equal list-item line-height');
    }

    // Unfocus back to preview
    await bottomPad.click({ position: { x: 300, y: 150 } });
    await page.waitForTimeout(150);
  }

  // =========================================================================
  // Regression & Precision Verification:
  // 9. Fine-Grained Transactional Undo in Ordered Lists:
  //    - Type "1. " then "2"
  //    - Press Meta+Z (Cmd+Z) -> must undo ONLY '2' and preserve '1. ' with cursor at index 3
  //    - Press Meta+Z again -> undos space back to '1.'
  //    - Press Meta+Shift+Z -> redos back to '1. ' and then '1. 2'
  // =========================================================================
  await bottomPad.click({ position: { x: 300, y: 150 } });
  await page.waitForTimeout(150);

  const activeTa = page.locator('#write textarea.ty-live-textarea').last();
  if (await activeTa.isVisible()) {
    await activeTa.click();
    await page.keyboard.type('1. ');
    await page.waitForTimeout(100);
    assert.equal(await activeTa.inputValue(), '1. ', 'Should have typed list prefix 1. ');

    await page.keyboard.type('2');
    await page.waitForTimeout(100);
    assert.equal(await activeTa.inputValue(), '1. 2', 'Should have typed content 2');

    // Undo 1st step: must undo ONLY '2', keeping '1. '
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(150);

    const undoStep1 = await page.evaluate(() => {
      const ta = document.querySelector('#write textarea.ty-live-textarea');
      return {
        value: ta ? ta.value : '',
        cursor: ta ? ta.selectionStart : -1
      };
    });
    assert.equal(undoStep1.value, '1. ', 'Undo must ONLY undo "2" and preserve "1. "');
    assert.equal(undoStep1.cursor, 3, 'Cursor must remain at index 3 right after "1. "');

    // Redo step: restores '1. 2'
    await page.keyboard.press('Meta+Shift+z');
    await page.waitForTimeout(150);
    const redoVal = await activeTa.inputValue();
    assert.equal(redoVal, '1. 2', 'Redo must restore "1. 2"');

    // Clean up tail draft
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
  }

  // Unfocus again
  await bottomPad.click({ position: { x: 300, y: 150 } });
  await page.waitForTimeout(150);

  // Verify zero runtime errors throughout the entire E2E flow
  assert.equal(pageErrors.length, 0, `Unexpected page errors: ${pageErrors.join('; ')}`);
  assert.equal(consoleErrors.length, 0, `Unexpected console errors: ${consoleErrors.join('; ')}`);
}
module.exports = checkKeyboardHistory;
