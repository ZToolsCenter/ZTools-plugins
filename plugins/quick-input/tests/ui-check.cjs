'use strict';

// Optional browser check: use an installed Playwright, or NODE_PATH for a bundled copy.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };

(async () => {
  assert.ok(fs.existsSync(path.join(root, 'index.html')), 'the command management interface must exist');
  const server = http.createServer((request, response) => {
    const file = path.resolve(root, '.' + new URL(request.url, 'http://localhost').pathname.replace(/\/$/u, '/index.html'));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 800, height: 620 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const url = `http://127.0.0.1:${server.address().port}`;
    await page.goto(url);
    await page.getByRole('heading', { name: '还没有命令' }).waitFor();
    assert.equal(await page.locator('[data-command-id]').count(), 0);
    await page.getByLabel('命令名称', { exact: true }).fill('测试手机');
    await page.getByLabel('触发词', { exact: true }).fill('输入测试手机');
    await page.getByLabel('输入内容', { exact: true }).fill('adb connect 192.168.1.10:5555 ');
    await page.getByRole('button', { name: '保存命令', exact: true }).click();
    await page.getByRole('button', { name: /测试手机.*输入测试手机/u }).waitFor();
    assert.equal(await page.evaluate(() => window.quickInput.list()[0].text), 'adb connect 192.168.1.10:5555 ');
    await page.reload();
    await page.getByRole('button', { name: /测试手机.*输入测试手机/u }).click();
    assert.equal(await page.getByLabel('输入内容', { exact: true }).inputValue(), 'adb connect 192.168.1.10:5555 ');

    await page.getByLabel('命令名称', { exact: true }).fill('<img src=x onerror=alert(1)>');
    await page.getByRole('button', { name: '保存命令', exact: true }).click();
    assert.equal(await page.locator('#command-list img').count(), 0, 'command text must never become HTML');
    await page.getByLabel('输入内容', { exact: true }).fill('adb devices\n');
    await page.getByRole('button', { name: '保存命令', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: /单行/u }).waitFor();
    assert.equal(await page.evaluate(() => window.quickInput.list()[0].text), 'adb connect 192.168.1.10:5555 ');
    await page.getByLabel('输入内容', { exact: true }).fill('adb devices');
    await page.getByRole('button', { name: '保存命令', exact: true }).click();
    await page.getByRole('button', { name: '绑定快捷键', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: /ZTools/u }).waitFor();
    await page.getByLabel('启用此命令', { exact: true }).uncheck();
    await page.getByRole('button', { name: '保存命令', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '绑定快捷键', exact: true }).isDisabled(), true);

    // Actual input crosses the host boundary; capture its payload without touching the OS.
    await page.getByLabel('启用此命令', { exact: true }).check();
    await page.getByRole('button', { name: '保存命令', exact: true }).click();
    await page.evaluate(() => {
      window.__typed = [];
      window.quickInput.type = async id => window.__typed.push(window.quickInput.list().find(item => item.id === id).text);
    });
    await page.getByRole('button', { name: '输入到原窗口', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.__typed), ['adb devices']);
    await page.getByRole('button', { name: '新增命令', exact: true }).click();
    await page.getByLabel('命令名称', { exact: true }).fill('重复');
    await page.getByLabel('触发词', { exact: true }).fill('输入测试手机');
    await page.getByLabel('输入内容', { exact: true }).fill('other');
    await page.getByRole('button', { name: '保存命令', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: /重复|已存在/u }).waitFor();
    assert.equal(await page.evaluate(() => window.quickInput.list().length), 1);
    await page.getByRole('button', { name: /<img.*输入测试手机/u }).click();
    await page.getByLabel('命令名称', { exact: true }).fill('测试手机');
    await page.getByRole('button', { name: '保存命令', exact: true }).click();

    fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
    // The preview notice does not appear in the native plugin view.
    await page.locator('#preview-banner').evaluate(element => { element.hidden = true; });
    const actionBox = await page.getByRole('button', { name: '输入到原窗口', exact: true }).boundingBox();
    assert.ok(actionBox.y + actionBox.height <= 620, `native actions should fit the plugin viewport: ${JSON.stringify(actionBox)}; ${JSON.stringify(await page.evaluate(() => ({ scrollY, height: document.documentElement.scrollHeight, panels: ['.app-header', '.workspace', '.editor', '.shortcut-panel'].map(selector => ({ selector, height: document.querySelector(selector).getBoundingClientRect().height })) })))}`);
    await page.screenshot({ path: path.join(root, 'artifacts', 'management.png') });
    await page.getByRole('button', { name: '删除命令', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '确认删除', exact: true }).click();
    await page.getByRole('heading', { name: '还没有命令' }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: '还没有命令' }).waitFor();
    await page.locator('#preview-banner').evaluate(element => { element.hidden = true; });
    await page.screenshot({ path: path.join(root, 'artifacts', 'empty.png') });
    await page.setViewportSize({ width: 480, height: 720 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.deepEqual(errors, []);
    console.log('Browser check passed: empty start, CRUD, persistence, validation, enable/disable, input action, and narrow layout.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
