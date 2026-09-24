const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 720 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const root = path.resolve(__dirname, '..');
  const outputDirectory = path.join(root, 'test-results');
  await fs.mkdir(outputDirectory, { recursive: true });
  try {
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
    const text = '你好，Base64 🌏\n第二行';
    const encoded = Buffer.from(text).toString('base64');
    await page.locator('#input').fill(text);
    await expect(page.locator('#output')).toHaveValue(encoded);
    await page.screenshot({ path: path.join(outputDirectory, 'text-encode.png') });
    await page.locator('#decode-mode').click();
    await page.locator('#input').fill(encoded);
    await expect(page.locator('#output')).toHaveValue(text);
    await page.locator('#input').fill('%%%');
    await expect(page.locator('#error')).toBeVisible();
    await expect(page.locator('#copy')).toBeDisabled();
    await expect(page.locator('#output')).toBeHidden();
    const png = await fs.readFile(path.join(root, 'logo.png'));
    await page.locator('#input').fill(png.toString('base64'));
    await expect(page.locator('#decoded-preview')).toBeVisible();
    await expect(page.locator('#image-meta')).toContainText('128 × 128');
    await page.screenshot({ path: path.join(outputDirectory, 'image-decode.png') });
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#save').click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'base64-image.png');
    assert.deepEqual(await fs.readFile(await download.path()), png);
    await page.locator('#encode-mode').click();
    await expect(page.locator('#input')).toHaveValue(text);
    await page.locator('#image-source').click();
    const chooserPromise = page.waitForEvent('filechooser');
    await page.locator('#pick-image').click();
    await (await chooserPromise).setFiles(path.join(root, 'logo.png'));
    await expect(page.locator('#output')).toHaveValue(`data:image/png;base64,${png.toString('base64')}`);
    await page.locator('#data-url').uncheck();
    await expect(page.locator('#output')).toHaveValue(png.toString('base64'));
    await page.locator('#clear').click();
    await expect(page.locator('#pick-image')).toBeVisible();
    await expect(page.locator('#copy')).toBeDisabled();
    await page.locator('#file-input').setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
    await expect(page.locator('#error')).toContainText('无法识别');
    await page.locator('#decode-mode').click();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#5267df"/></svg>';
    await page.locator('#input').fill(Buffer.from(svg).toString('base64'));
    await expect(page.locator('#image-meta')).toContainText('80 × 60');
    await page.setViewportSize({ width: 760, height: 540 });
    await page.screenshot({ path: path.join(outputDirectory, 'compact.png') });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 1000, height: 720 });
    await page.screenshot({ path: path.join(outputDirectory, 'dark.png') });
    // Host integration uses documented API stubs; this does not replace a real ZTools smoke test.
    await page.addInitScript(() => {
      window.ztools = {
        onPluginEnter(callback) { window.enterPlugin = callback; },
        copyText(text) { window.copiedText = text; return true; }
      };
      window.nativePickCalls = 0;
      window.base64Native = {
        async openImage() {
          window.nativePickCalls++;
          if (window.nativePickError) throw new Error(window.nativePickError);
          return window.nativePickResult || { canceled: true };
        },
        async saveImage(base64) { window.savedBase64 = base64; return { canceled: true }; }
      };
    });
    await page.reload();
    await page.evaluate(value => window.enterPlugin({ code: 'decode', type: 'regex', payload: value }), encoded);
    await expect(page.locator('#output')).toHaveValue(text);
    await page.locator('#copy').click();
    assert.equal(await page.evaluate(() => window.copiedText), text);
    await page.locator('#input').fill(png.toString('base64'));
    await expect(page.locator('#save')).toBeVisible();
    await page.locator('#save').click();
    await expect(page.locator('#status')).toHaveText('已取消保存');
    assert.equal(await page.evaluate(() => window.savedBase64), png.toString('base64'));
    // Regression: host picker buttons must never open an HTML file chooser,
    // which bypasses ZTools' blur-hide suppression and hides its main window.
    let hostHtmlChoosers = 0;
    page.on('filechooser', () => { hostHtmlChoosers++; });
    await page.locator('#encode-mode').click();
    await page.locator('#image-source').click();
    await page.evaluate(bytes => { window.nativePickResult = { canceled: false, name: 'native.png', bytes }; }, [...png]);
    await page.locator('#pick-image').click();
    await expect(page.locator('#output')).toHaveValue(`data:image/png;base64,${png.toString('base64')}`);
    await expect(page.locator('#file-info')).toContainText('native.png');
    await expect(page.locator('#source-preview')).toBeVisible();
    await page.evaluate(() => { window.nativePickResult = { canceled: true }; });
    await page.locator('#replace-image').click();
    await expect(page.locator('#output')).toHaveValue(`data:image/png;base64,${png.toString('base64')}`);
    await page.evaluate(() => { window.nativePickError = '文件读取失败'; });
    await page.locator('#replace-image').click();
    await expect(page.locator('#status')).toHaveText('选图失败：文件读取失败');
    await expect(page.locator('#output')).toHaveValue(`data:image/png;base64,${png.toString('base64')}`);
    await expect(page.locator('#replace-image')).toBeEnabled();
    assert.equal(await page.evaluate(() => window.nativePickCalls), 3);
    assert.equal(hostHtmlChoosers, 0);
    await page.evaluate(() => { delete window.base64Native.openImage; });
    await page.locator('#replace-image').click();
    await expect(page.locator('#status')).toContainText('请重新加载插件');
    assert.equal(hostHtmlChoosers, 0, 'missing native API must not fall back to unsafe host file input');
    assert.deepEqual(errors, []);
    console.log('PASS: UTF-8, invalid input, browser/native image pickers, picker cancellation/errors, raw/Data URL, PNG/SVG previews, exact download bytes, clear, responsive/dark layout and mocked host integration.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
