"use strict";
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function checkLayoutWebdav(scenario) {
  const { tmpWorkspace, tmpWorkspaceExtra, sampleFile, expendHeights, webdavFiles, webdavServerUrl, context, page, pageErrors, consoleErrors, distIndexHtml, screenshotRoot } = scenario;


  // Navigate to exact file:// URL resolved by ZTools
  const targetUrl = pathToFileURL(distIndexHtml).href;
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

  // 1. Verify initial Typora workbench shell and zero console/page errors
  await page.waitForSelector('.typora-workbench');
  assert.equal(pageErrors.length, 0, `Expected 0 page errors, got: ${pageErrors.join('; ')}`);
  assert.equal(consoleErrors.length, 0, `Expected 0 console errors, got: ${consoleErrors.join('; ')}`);
  assert.ok(expendHeights.includes(820), 'Should request ZTools window height expansion to 820');

  // 1a. Verify NO default workspace and NO workspace auto-loaded on startup (shows "打开文件夹..." button in #file-library instead)
  const fileLibraryText = await page.locator('#file-library').innerText();
  assert.equal(fileLibraryText.includes('默认工作区'), false, 'Default workspace ("默认工作区") must be eliminated from #file-library');
  assert.equal(fileLibraryText.includes('Welcome & Quick Start.md'), false, 'Built-in sample docs must not appear in #file-library');
  const openFolderBtnCount = await page.locator('#file-library').getByRole('button', { name: '打开文件夹...' }).count();
  assert.equal(openFolderBtnCount, 1, 'Should NOT auto-scan local workspace on startup; should show "打开文件夹..." button in #file-library');

  // 1b. Verify 2-column flex layout geometry & non-wrapping top menu bar
  const sidebarBox = await page.locator('#typora-sidebar').boundingBox();
  const editorColBox = await page.locator('.ty-editor-column').boundingBox();
  const writeBox = await page.locator('#write').boundingBox();
  const firstMenuBtnBox = await page.locator('.ty-menu-trigger').first().boundingBox();

  assert.ok(sidebarBox && editorColBox && writeBox && firstMenuBtnBox, 'Core layout bounding boxes should exist');
  assert.ok(
    editorColBox.x >= sidebarBox.x + sidebarBox.width - 6,
    `Editor column (x=${editorColBox.x}) must be placed horizontally to the right of sidebar (right=${sidebarBox.x + sidebarBox.width})`
  );
  assert.ok(
    Math.abs(editorColBox.y - sidebarBox.y) <= 2,
    `Editor column (y=${editorColBox.y}) and sidebar (y=${sidebarBox.y}) must share the same vertical top offset`
  );
  assert.ok(
    editorColBox.width >= 700 && editorColBox.height >= 650,
    `Editor column must occupy main viewport area, got ${editorColBox.width}x${editorColBox.height}`
  );
  assert.ok(
    firstMenuBtnBox.height <= 30,
    `Top menu trigger should stay on a single line (height <= 30px), got ${firstMenuBtnBox.height}px`
  );

  const titleDocBox = await page.locator('.ty-titlebar-doc').boundingBox();
  assert.ok(
    titleDocBox && titleDocBox.height <= 32,
    `Document title in top bar must stay on a single line (height <= 32px), got ${titleDocBox ? titleDocBox.height : 'null'}`
  );

  // 1c. Verify Top Menu Bar dropdown opens right below the trigger button (not clipped off-screen) and supports hover switching
  await page.locator('.ty-menu-trigger', { hasText: '文件' }).click();
  const fileDropdownBox = await page.locator('.ty-menu-dropdown').boundingBox();
  assert.ok(
    fileDropdownBox &&
      fileDropdownBox.y >= firstMenuBtnBox.y + firstMenuBtnBox.height - 2 &&
      fileDropdownBox.y <= 60 &&
      fileDropdownBox.width >= 180 &&
      fileDropdownBox.height >= 150,
    `File menu dropdown must appear directly below top menu bar within viewport, got ${JSON.stringify(fileDropdownBox)}`
  );

  // Hover over "段落" while "文件" menu is open -> should switch dropdown to Paragraph menu
  await page.locator('.ty-menu-trigger', { hasText: '段落' }).hover();
  const paragraphDropdownText = await page.locator('.ty-menu-dropdown').innerText();
  assert.match(paragraphDropdownText, /1 级标题/, 'Hovering another menu trigger while open should switch dropdown');

  // Close menu by clicking trigger again
  await page.locator('.ty-menu-trigger', { hasText: '段落' }).click();
  assert.equal(await page.locator('.ty-menu-dropdown').count(), 0, 'Clicking open menu trigger should close dropdown');

  // 2. Verify Live Preview blocks rendered on default welcome document (#write)
  const headingText = await page.locator('#write .ty-heading-block').first().innerText();
  assert.match(headingText, /Welcome to Live Markdown/);

  const mermaidSvgs = page.locator('#write .ty-diagram-block svg.ty-mermaid-svg');
  assert.equal(await mermaidSvgs.count(), 2, 'Should render both flowchart and sequenceDiagram Mermaid SVGs in Live Preview');
  const mermaidSvg = mermaidSvgs.first();
  const mermaidSvgBox = await mermaidSvg.boundingBox();
  assert.ok(
    mermaidSvgBox && mermaidSvgBox.width >= 400 && mermaidSvgBox.height >= 140,
    `Mermaid flowchart SVG must have 2D layout dimensions, got ${JSON.stringify(mermaidSvgBox)}`
  );

  // Verify 2D branching nodes ("内联源码编辑" and "所见即所得排版") are placed on separate vertical rows (not overlapping on 1D line)
  const branchRowYDelta = await mermaidSvg.evaluate((svgEl) => {
    const texts = Array.from(svgEl.querySelectorAll('text'));
    const rawNode = texts.find((t) => t.textContent?.includes('内联源码编辑'));
    const liveNode = texts.find((t) => t.textContent?.includes('所见即所得排版'));
    if (!rawNode || !liveNode) return 0;
    return Math.abs(rawNode.getBoundingClientRect().top - liveNode.getBoundingClientRect().top);
  });
  assert.ok(
    branchRowYDelta >= 45,
    `Branching flowchart nodes must be separated vertically in 2D layout, got deltaY=${branchRowYDelta}`
  );

  // Verify cubic Bezier edge curves exist
  const bezierPathCount = await mermaidSvg.locator('path[d*=" C "]').count();
  assert.equal(bezierPathCount, 5, 'Flowchart should render 5 smooth cubic Bezier edge paths');


  // 2b. Verify Heading Fold / Unfold in #write
  const secondHeading = page.locator('#write .ty-heading-block').nth(1);
  const foldBtn = secondHeading.locator('.ty-heading-fold-btn');
  await foldBtn.click();
  const collapsedPill = secondHeading.locator('.ty-heading-collapsed-pill');
  assert.equal(await collapsedPill.count(), 1, 'Clicking heading fold button should show collapsed section pill');
  const pillText = await collapsedPill.innerText();
  assert.match(pillText, /已折叠 \d+ 个段落块/, 'Collapsed pill should display count of folded blocks');

  // Unfold by clicking the collapsed pill
  await collapsedPill.click();
  assert.equal(await secondHeading.locator('.ty-heading-collapsed-pill').count(), 0, 'Clicking collapsed pill should unfold section');

  // Capture a screenshot with a folded heading + open top menu dropdown + Mermaid diagram in view
  await foldBtn.click();
  await mermaidSvg.scrollIntoViewIfNeeded();
  await page.locator('.ty-menu-trigger', { hasText: '段落' }).click();
  const menuAndFoldScreenshotPath = path.join(screenshotRoot, 'typora_menu_and_fold_verified.png');
  await page.screenshot({ path: menuAndFoldScreenshotPath });
  // Restore state before continuing
  await page.locator('.ty-menu-trigger', { hasText: '段落' }).click();
  await collapsedPill.click();

  const screenshotPath = path.join(screenshotRoot, 'typora_ui_verified.png');
  await page.screenshot({ path: screenshotPath });

  // 3. Test clicking a task list checkbox in Live Preview
  const firstCheckbox = page.locator('#write .ty-task-checkbox').first();
  const initialChecked = await firstCheckbox.isChecked();
  await firstCheckbox.click();
  const afterChecked = await firstCheckbox.isChecked();
  assert.equal(afterChecked, !initialChecked, 'Clicking task list checkbox should toggle its checked state');

  // 4. Test clicking a block to enter inline Live-Source editing and pressing Escape to return to Live Preview
  await page.locator('#write .ty-heading-block h1').first().click();
  await page.waitForSelector('#write .ty-live-textarea');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#write .ty-heading-block h1');

  // 5. Test switching to Source Code Mode and back to Live Preview via unified mode switcher
  await page.locator('[data-testid="footer-viewmode-btn"]').click();
  await page.waitForSelector('.ty-footer-popover-menu');
  await page.locator('.ty-footer-popover-item', { hasText: '源代码模式' }).click();
  await page.waitForSelector('#typora-source .ty-source-textarea');
  const rawValue = await page.locator('#typora-source .ty-source-textarea').inputValue();
  assert.match(rawValue, /Welcome to Live Markdown/);

  await page.locator('[data-testid="footer-viewmode-btn"]').click();
  await page.waitForSelector('.ty-footer-popover-menu');
  await page.locator('.ty-footer-popover-item', { hasText: '实时预览' }).click();
  await page.waitForSelector('#write .ty-heading-block');

  // 6. Test Focus Mode & Typewriter Mode toggles in footer
  await page.getByTitle('专注模式 (F8)').first().click();
  const workbenchClassAfterFocus = await page.locator('.typora-workbench').getAttribute('class');
  assert.match(workbenchClassAfterFocus, /ty-focus-mode/);

  await page.getByTitle('打字机滚动模式 (F9)').first().click();
  const workbenchClassAfterTypewriter = await page.locator('.typora-workbench').getAttribute('class');
  assert.match(workbenchClassAfterTypewriter, /ty-typewriter-mode/);

  // 7. Test ZTools onPluginEnter commands (`typora-new-note` & opening real file payload)
  await page.evaluate(() => {
    window.__dispatchPluginEnter({
      code: 'typora-new-note',
      type: 'text',
      payload: '速记'
    });
  });
  // The preceding interaction dirtied the welcome document. Confirm the intended
  // discard explicitly before exercising the new-note plugin entry.
  await page.getByRole('dialog', { name: '保存未完成的修改？' }).getByRole('button', { name: '不保存' }).click();
  await page.waitForFunction(
    () => document.querySelector('#write')?.textContent?.includes('Untitled')
  );

  // 8. Test ZTools onPluginEnter with real Markdown file from disk
  await page.evaluate((targetFilePath) => {
    window.__dispatchPluginEnter({
      code: 'typora-workbench',
      type: 'files',
      payload: [{ path: targetFilePath }]
    });
  }, sampleFile);
  // A new untitled note starts dirty, so opening a real file also requires an
  // explicit navigation decision. This scenario intentionally discards it.
  await page.getByRole('dialog', { name: '保存未完成的修改？' }).getByRole('button', { name: '不保存' }).click();

  await page.waitForFunction(
    () => document.querySelector('#write .ty-heading-block')?.textContent?.includes('E2E Live Heading')
  );
  const loadedHeading = await page.locator('#write .ty-heading-block').first().innerText();
  assert.match(loadedHeading, /E2E Live Heading/);

  // 8b. Verify full-title hover attributes on headings and top titlebar
  const headingFullTitle = await page.locator('#write .ty-heading-block').first().getAttribute('data-full-title');
  assert.equal(headingFullTitle, 'E2E Live Heading', 'Heading block should expose data-full-title for hover preview');
  const headingNativeTitle = await page.locator('#write .ty-heading-block h1').first().getAttribute('title');
  assert.equal(headingNativeTitle, 'E2E Live Heading', 'Heading tag should expose title attribute for hover preview');
  const titlebarDocTitle = await page.locator('.ty-titlebar-doc').first().getAttribute('data-full-title');
  assert.equal(titlebarDocTitle, 'e2e-guide.md', 'Top titlebar doc pill should expose data-full-title');

  // 8c. Test exporting standalone HTML with theme styles ("文件 -> 导出为 HTML (含主题样式)...")
  await page.locator('.ty-menu-trigger', { hasText: '文件' }).click();
  await page.locator('.ty-menu-option', { hasText: '导出为 HTML (含主题样式)...' }).click();

  const exportedPayload = await page.evaluate(() => window.__exportedHtml);
  assert.ok(exportedPayload, 'exportHtmlFile should have been invoked');
  assert.equal(exportedPayload.opts.includeStyles, true);
  assert.ok(
    exportedPayload.opts.themeCss.includes('--diagram-node-fill'),
    'Exported themeCss must include diagram CSS custom properties'
  );
  assert.ok(
    !exportedPayload.opts.htmlBody.includes('ty-heading-fold-btn'),
    'Exported HTML body must strip .ty-heading-fold-btn'
  );
  assert.ok(
    !exportedPayload.opts.htmlBody.includes('ty-heading-gutter-tag'),
    'Exported HTML body must strip .ty-heading-gutter-tag'
  );
  assert.ok(
    !exportedPayload.opts.htmlBody.includes('ty-table-toolbar'),
    'Exported HTML body must strip .ty-table-toolbar'
  );
  assert.ok(
    exportedPayload.opts.htmlBody.includes('ty-mermaid-svg'),
    'Exported HTML body must include rendered Mermaid SVG'
  );

  // Wait briefly for async __nodeCallService('exportHtmlFile') to finish writing exported.html, then verify in Chromium
  const exportedHtmlPath = path.join(tmpWorkspace, 'exported.html');
  await page.waitForFunction(() => Boolean(window.__exportedHtml));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(fs.existsSync(exportedHtmlPath), true, 'exported.html should be written to disk');

  const exportPage = await context.newPage();
  await exportPage.goto(pathToFileURL(exportedHtmlPath).href, { waitUntil: 'domcontentloaded' });
  assert.equal(
    await exportPage.locator('.ty-heading-fold-btn').count(),
    0,
    'Rendered exported.html must not contain fold buttons'
  );
  assert.equal(
    await exportPage.locator('#write h1').first().innerText(),
    'E2E Live Heading',
    'Rendered exported.html must display the H1 heading'
  );
  const exportedSvgRectFill = await exportPage
    .locator('svg.ty-mermaid-svg g rect')
    .first()
    .evaluate((el) => getComputedStyle(el).fill);
  assert.notEqual(
    exportedSvgRectFill,
    'rgb(0, 0, 0)',
    `Exported HTML Mermaid SVG node rect fill must not fall back to black (got ${exportedSvgRectFill})`
  );
  await exportPage.close();

  // 9. Test ZTools onPluginEnter with workspace folder payload (`typora-open-folder`) and lazy subdirectory expansion
  await page.evaluate((folderPath) => {
    window.__dispatchPluginEnter({
      code: 'typora-open-folder',
      type: 'files',
      payload: [{ path: folderPath, isDirectory: true }]
    });
  }, tmpWorkspace);

  // Before clicking `docs` directory, `nested.md` should NOT be rendered in the tree
  assert.equal(await page.getByText('nested.md').count(), 0, 'Subdirectory children should not be rendered before expanding');
  // Click `docs` directory row to lazy-load its children
  await page.locator('.ty-tree-dir-row', { hasText: 'docs' }).click();
  await page.waitForFunction(
    () => document.querySelector('#file-library')?.textContent?.includes('nested.md')
  );
  assert.equal(await page.getByText('nested.md').count(), 1, 'Clicking subdirectory should lazy-load and display nested.md');

  // 9b. Add a second folder via sidebar "+" button and verify multi-folder workspace behavior
  await page.evaluate((extraDir) => {
    window.__nextFoldersDialogResult = [extraDir];
  }, tmpWorkspaceExtra);
  await page.getByTestId('sidebar-add-folder-btn').click();
  await page.waitForFunction(
    () => document.querySelector('#file-library')?.textContent?.includes('extra-note.md')
  );
  const subbarText = await page.locator('.ty-sidebar-subbar').first().innerText();
  assert.match(subbarText, /工作区 \(2 个文件夹\)/, 'Sidebar subbar should indicate 2 added workspace folders');

  // Lazy-expand subdirectory inside the 2nd workspace folder
  assert.equal(await page.getByText('extra-nested.md').count(), 0, '2nd folder subdirectory should start collapsed');
  await page.locator('.ty-tree-dir-row', { hasText: 'extra-docs' }).click();
  await page.waitForFunction(
    () => document.querySelector('#file-library')?.textContent?.includes('extra-nested.md')
  );

  // Switch to List View and verify files from BOTH folders are listed
  await page.getByTitle('文章列表视图 (File List)').click();
  await page.waitForFunction(
    () => {
      const text = document.querySelector('#file-library')?.textContent || '';
      return text.includes('e2e-guide.md') && text.includes('extra-note.md');
    }
  );
  await page.getByTitle('树形视图 (File Tree)').click();

  // Switch to Search tab and verify search spans BOTH folders
  await page.locator('.ty-sidebar-tab', { hasText: '搜索' }).click();
  await page.locator('.ty-sidebar-subbar input.ty-sidebar-input').fill('MultiFolderSearchToken');
  await page.waitForFunction(
    () => {
      const sidebarText = document.querySelector('#typora-sidebar')?.textContent || '';
      return sidebarText.includes('e2e-guide.md') && sidebarText.includes('extra-note.md');
    }
  );
  await page.locator('.ty-sidebar-tab', { hasText: '文件' }).click();

  // Remove the 2nd folder and verify the 1st folder remains intact
  const extraRootName = path.basename(tmpWorkspaceExtra);
  await page.locator('.ty-tree-dir-row', { hasText: extraRootName }).hover();
  await page.getByTitle(`从工作区移除 ${extraRootName}`).click();
  await page.waitForFunction(
    (name) => !(document.querySelector('#file-library')?.textContent || '').includes(name),
    extraRootName
  );
  assert.equal(await page.getByText('e2e-guide.md').count() >= 1, true, 'Primary workspace folder should remain after removing extra folder');

  // 10. Test WebDAV Cloud Sync UI & End-to-End Synchronization
  await page.getByTestId('top-webdav-btn').click();
  await page.waitForSelector('.ty-webdav-panel');

  await page.getByTestId('webdav-enabled-checkbox').check();
  await page.getByTestId('webdav-server-url').fill(webdavServerUrl);
  await page.getByTestId('webdav-username').fill('typora_e2e');
  await page.getByTestId('webdav-password').fill('pass_123');
  await page.getByTestId('webdav-remote-path').fill('/TyporaNotes/');

  // Test connection & remote directory listing
  await page.getByTestId('webdav-test-btn').click();
  await page.waitForSelector('[data-testid="webdav-pull-cloud-welcome.md"]');

  // Push current active document (e2e-guide.md) to WebDAV server
  await page.getByTestId('webdav-push-current-btn').click();
  await page.waitForSelector('[data-testid="webdav-pull-e2e-guide.md"]');
  assert.equal(webdavFiles.has('/dav/TyporaNotes/e2e-guide.md'), true, 'Pushed document must exist on WebDAV server');

  // Capture WebDAV UI verified screenshot
  const webdavScreenshotPath = path.join(screenshotRoot, 'typora_webdav_verified.png');
  await page.screenshot({ path: webdavScreenshotPath });

  // Close Preferences Modal
  await page.locator('#ty-preferences .ty-preferences-header .ty-icon-btn').click();

  // Verify Sidebar WebDAV section shows remote files and allows pulling cloud-welcome.md into #write
  await page.waitForSelector('[data-testid="sidebar-webdav-file-cloud-welcome.md"]');
  await page.getByTestId('sidebar-webdav-file-cloud-welcome.md').click();
  await page.waitForFunction(
    () => document.querySelector('#write .ty-heading-block')?.textContent?.includes('Cloud Synced Heading')
  );
  const pulledHeading = await page.locator('#write .ty-heading-block').first().innerText();
  assert.match(pulledHeading, /Cloud Synced Heading/, 'Clicking remote file in sidebar should pull and render it in #write');
}
module.exports = checkLayoutWebdav;
