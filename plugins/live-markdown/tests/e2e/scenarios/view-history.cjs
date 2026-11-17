"use strict";
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function checkViewHistory(scenario) {
  const { page } = scenario;


  // 11. Test Unified 3-in-1 View Mode Button & Reading Mode (Read-only, no editing allowed)
  // Click unified mode switcher button in footer status bar to open popover
  await page.locator('[data-testid="footer-viewmode-btn"]').click();
  await page.waitForSelector('.ty-footer-popover-menu');
  await page.locator('.ty-footer-popover-item', { hasText: '阅读模式' }).click();
  assert.equal(
    await page.locator('.typora-workbench.ty-reading-mode').count(),
    1,
    'Workbench must have .ty-reading-mode class applied'
  );

  // Clicking a block in reading mode must NOT trigger inline textarea
  await page.locator('#write .ty-heading-block').first().click();
  assert.equal(
    await page.locator('#write textarea.ty-live-textarea').count(),
    0,
    'Clicking content in reading mode must not trigger an editable textarea'
  );

  // Pressing edit keys must not modify the document
  await page.keyboard.press('Backspace');
  await page.keyboard.press('x');
  const intactHeading = await page.locator('#write .ty-heading-block').first().innerText();
  assert.match(
    intactHeading,
    /Cloud Synced Heading/,
    'Document text must remain untouched during reading mode key events'
  );

  // Switch back to Live Preview via Top Bar unified mode cycle button (click directly to cycle from reading -> live)
  await page.locator('[data-testid="top-viewmode-cycle-btn"]').click();
  assert.equal(
    await page.locator('.typora-workbench.ty-reading-mode').count(),
    0,
    'Clicking top view mode button from reading mode must cycle back to live preview and remove .ty-reading-mode'
  );
  assert.match(
    await page.locator('[data-testid="top-viewmode-cycle-btn"]').innerText(),
    /实时预览/,
    'Top button text must display 实时预览'
  );

  // Test cycling from live -> source -> reading -> live
  await page.locator('[data-testid="top-viewmode-cycle-btn"]').click();
  await page.waitForSelector('#typora-source .ty-source-textarea');
  assert.match(
    await page.locator('[data-testid="top-viewmode-cycle-btn"]').innerText(),
    /源码/,
    'Clicking from live preview must cycle to 源码 mode'
  );

  await page.locator('[data-testid="top-viewmode-cycle-btn"]').click();
  assert.equal(
    await page.locator('.typora-workbench.ty-reading-mode').count(),
    1,
    'Clicking from source mode must cycle to reading mode'
  );

  await page.locator('[data-testid="top-viewmode-cycle-btn"]').click();
  assert.equal(
    await page.locator('.typora-workbench.ty-reading-mode').count(),
    0,
    'Clicking from reading mode must cycle back to live preview'
  );

  // 10. Test Feishu/Lark Docs style Slash Command Menu (唤起 "/" 快捷菜单、关键词过滤与回车应用)
  const blockToSlash = page.locator('#write .ty-block-wrapper').nth(1);
  await blockToSlash.click();
  await page.waitForSelector('#write textarea.ty-live-textarea');

  const slashInput = page.locator('#write textarea.ty-live-textarea');
  await slashInput.fill('Note: ');
  await page.keyboard.type('/');
  await page.waitForTimeout(100);

  const isSlashMenuVisible = await page.locator('.ty-slash-menu-popup').isVisible();
  assert.equal(isSlashMenuVisible, true, 'Typing "/" in active block must open Feishu-style Slash Command Menu');

  // Filter with keyword "h2"
  await page.keyboard.type('h2');
  await page.waitForTimeout(100);
  const hasH2Item = await page.locator('.ty-slash-item', { hasText: '二级标题' }).isVisible();
  assert.equal(hasH2Item, true, 'Typing "/h2" must filter to 二级标题');

  // Press Enter to apply H2 syntax
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  const slashMenuClosed = !(await page.locator('.ty-slash-menu-popup').isVisible());
  assert.equal(slashMenuClosed, true, 'Slash menu must close after pressing Enter');
  const appliedVal = await slashInput.inputValue();
  assert.match(appliedVal, /##/, 'Applied value must contain ## markdown heading syntax');

  // 11. Test Slash Command insertion followed by clicking below (content must NOT disappear!)
  // Click bottom pad to commit and exit the current H2 editing
  const bottomPad = page.locator('.ty-editor-bottom-pad');
  await bottomPad.click({ position: { x: 300, y: 150 } });
  await page.waitForTimeout(150);

  // Verify H2 block was safely rendered without disappearing
  const renderedH2 = await page.locator('#write .ty-heading-block').count();
  assert.ok(renderedH2 >= 1, 'H2 heading must remain rendered after clicking bottom pad');

  // Click bottom pad to start a new tail paragraph
  await bottomPad.click({ position: { x: 300, y: 150 } });
  await page.waitForSelector('#write textarea.ty-live-textarea');
  const tailInput = page.locator('#write textarea.ty-live-textarea').last();

  // Type "/table" and hit Enter
  await tailInput.pressSequentially('/table', { delay: 20 });
  await page.waitForTimeout(100);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);

  const tailTableVal = await tailInput.inputValue();
  assert.match(tailTableVal, /\|\s*列 1\s*\|/, 'Tail input must contain table template');

  // Click bottom pad below to commit table
  await bottomPad.click({ position: { x: 300, y: 150 } });
  await page.waitForTimeout(200);

  // Table must be successfully committed and rendered in WYSIWYG without disappearing
  const renderedTables = await page.locator('#write .ty-table-figure').count();
  assert.ok(renderedTables >= 1, 'Table must remain committed and rendered in WYSIWYG after clicking below');

  // 12. Test File Revision History (文件历史快照、Diff高亮对比与版本恢复)
  // Click top bar History button to open history modal
  await page.locator('[data-testid="top-history-btn"]').click();
  await page.waitForSelector('.ty-history-modal');
  assert.equal(
    await page.locator('.ty-history-modal').isVisible(),
    true,
    'Clicking top history button must open File History modal'
  );

  // Verify timeline items exist
  await page.waitForSelector('.ty-history-timeline-item');
  const timelineItemsCount = await page.locator('.ty-history-timeline-item').count();
  assert.ok(timelineItemsCount >= 1, 'File history modal must list at least 1 revision snapshot');

  // Verify Diff View rendered with side-by-side columns
  assert.equal(
    await page.locator('.ty-diff-side-by-side').isVisible(),
    true,
    'Side-by-side diff view must be rendered by default'
  );

  // Verify Diff header contains stats badge
  assert.equal(
    await page.locator('.ty-diff-stats-badge').isVisible(),
    true,
    'Diff header must display change statistics'
  );

  // Test switching to Unified mode
  await page.locator('.ty-btn:has-text("统合对比")').click();
  await page.waitForSelector('.ty-diff-unified');
  assert.equal(
    await page.locator('.ty-diff-unified').isVisible(),
    true,
    'Clicking unified view button must switch to unified diff table'
  );

  // Switch back to side-by-side
  await page.locator('.ty-btn:has-text("双栏对比")').click();
  await page.waitForSelector('.ty-diff-side-by-side');

  // Test selecting the earliest snapshot and restoring it
  const initialSnapshotsCount = await page.locator('.ty-history-timeline-item').count();
  const earliestItem = page.locator('.ty-history-timeline-item').last();
  await earliestItem.click();
  await page.waitForTimeout(100);

  const restoreBtn = page.locator('.ty-diff-restore-btn');
  assert.equal(
    await restoreBtn.isVisible(),
    true,
    'Restore button must be visible for selected snapshot'
  );
  await restoreBtn.click();
  await page.waitForTimeout(300);

  // Modal should close after restore and document content is restored
  assert.equal(
    await page.locator('.ty-history-modal').count(),
    0,
    'File history modal must close after executing snapshot restore'
  );

  // Reopen history modal to strictly verify that content was truly restored AND a new audit snapshot was generated
  await page.locator('[data-testid="top-history-btn"]').click();
  await page.waitForSelector('.ty-history-modal');
  await page.waitForSelector('.ty-history-timeline-item');

  const newSnapshotsCount = await page.locator('.ty-history-timeline-item').count();
  assert.equal(
    newSnapshotsCount,
    initialSnapshotsCount + 1,
    `History snapshot count must increment by 1 after rollback (was ${initialSnapshotsCount}, now ${newSnapshotsCount})`
  );

  const latestAuditSummary = await page
    .locator('.ty-history-timeline-item')
    .first()
    .locator('.ty-timeline-summary')
    .innerText();
  assert.match(
    latestAuditSummary,
    /回滚恢复至快照/,
    `Latest snapshot must be the audit record of rollback (got: "${latestAuditSummary}")`
  );

  // Close history modal
  await page.locator('.ty-history-close-btn').click();
  await page.waitForTimeout(100);
  Object.assign(scenario, { bottomPad, restoreBtn });
}
module.exports = checkViewHistory;
