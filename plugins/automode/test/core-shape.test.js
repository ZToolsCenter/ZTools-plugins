const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');

describe('schedule mode core shape', () => {
  let indexHtml;
  let preloadJs;
  let pluginManifest;

  before(() => {
    indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
    preloadJs = fs.readFileSync(path.join(rootDir, 'preload.js'), 'utf8');
    pluginManifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'plugin.json'), 'utf8'));
  });

  it('should keep the interface focused on schedule mode', () => {
    assert.ok(indexHtml.includes('定时模式'));
    assert.ok(indexHtml.includes('id="enableToggle"'));
    assert.ok(indexHtml.includes('id="darkH"'));
    assert.ok(indexHtml.includes('id="lightH"'));
    assert.ok(indexHtml.includes('id="btnDark"'));
    assert.ok(indexHtml.includes('id="btnLight"'));
  });

  it('should expose only the schedule-mode preload surface', () => {
    assert.ok(preloadJs.includes('enableScheduler'));
    assert.ok(preloadJs.includes('disableScheduler'));
    assert.ok(preloadJs.includes('switchImmediate'));
    assert.ok(preloadJs.includes('getTaskStatus'));
    assert.ok(preloadJs.includes('getSavedConfig'));
  });

  it('should describe the plugin as schedule-only', () => {
    assert.equal(pluginManifest.description, '定时自动切换 Windows 系统深浅色主题');
    assert.deepEqual(pluginManifest.features, [
      {
        code: 'theme-scheduler',
        explain: '定时切换系统深浅色模式',
        cmds: ['主题切换', '深色模式', '定时主题', 'theme switch', 'dark mode']
      }
    ]);
  });
});
