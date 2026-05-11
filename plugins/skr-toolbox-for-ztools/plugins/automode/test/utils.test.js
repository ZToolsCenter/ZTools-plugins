const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

let utils;

describe('lib/utils.js', () => {
  before(() => {
    utils = require('../lib/utils');
  });

  describe('generateTaskXml(mode, time, scriptsDir)', () => {
    it('should generate valid UTF-16 LE XML with BOM', () => {
      const xml = utils.generateTaskXml('dark', '19:00', 'C:\\test');
      assert.equal(xml[0], 0xFF);
      assert.equal(xml[1], 0xFE);
    });

    it('should contain description matching the mode', () => {
      const xmlDark = utils.generateTaskXml('dark', '19:00', 'C:\\test');
      const xmlLight = utils.generateTaskXml('light', '07:00', 'C:\\test');
      const textDark = xmlDark.toString('utf16le');
      const textLight = xmlLight.toString('utf16le');
      assert.ok(textDark.includes('深色模式'));
      assert.ok(textLight.includes('浅色模式'));
    });

    it('should use different script files for dark and light', () => {
      const xmlDark = utils.generateTaskXml('dark', '19:00', 'C:\\test');
      const xmlLight = utils.generateTaskXml('light', '07:00', 'C:\\test');
      const textDark = xmlDark.toString('utf16le');
      const textLight = xmlLight.toString('utf16le');
      assert.ok(textDark.includes('switch-dark.vbs') && !textDark.includes('switch-light.vbs'));
      assert.ok(textLight.includes('switch-light.vbs') && !textLight.includes('switch-dark.vbs'));
    });

    it('should embed the time in StartBoundary', () => {
      const xml = utils.generateTaskXml('dark', '19:30', 'C:\\test');
      const text = xml.toString('utf16le');
      assert.ok(text.includes('T19:30:00'));
    });

    it('should use the local current date in StartBoundary when local date differs from UTC', () => {
      const RealDate = global.Date;
      function FakeDate() {
        return {
          toISOString: () => '2026-04-04T16:30:00.000Z',
          getFullYear: () => 2026,
          getMonth: () => 3,
          getDate: () => 5
        };
      }

      global.Date = FakeDate;

      try {
        const xml = utils.generateTaskXml('dark', '19:00', 'C:\\test');
        const text = xml.toString('utf16le');
        assert.ok(text.includes('2026-04-05T19:00:00'));
        assert.ok(!text.includes('2026-04-04T19:00:00'));
      } finally {
        global.Date = RealDate;
      }
    });

    it('should have StartWhenAvailable=false for theme tasks', () => {
      const xml = utils.generateTaskXml('dark', '19:00', 'C:\\test');
      const text = xml.toString('utf16le');
      assert.ok(text.includes('StartWhenAvailable>false'));
    });

    it('should include wscript.exe as Command', () => {
      const xml = utils.generateTaskXml('dark', '19:00', 'C:\\test');
      const text = xml.toString('utf16le');
      assert.ok(text.includes('<Command>wscript.exe</Command>'));
    });

    it('should pass the wrapped VBS path as the task argument', () => {
      const xml = utils.generateTaskXml('dark', '19:00', 'C:\\test');
      const text = xml.toString('utf16le');
      assert.ok(text.includes('<Arguments>"C:\\test\\switch-dark.vbs"</Arguments>'));
    });
  });

  describe('generateThemeSwitchScript(mode)', () => {
    it('should generate a valid shell refresh block for dark mode', () => {
      const script = utils.generateThemeSwitchScript('dark');
      assert.ok(script.includes('EntryPoint = "SendMessageTimeoutW"'));
      assert.ok(script.includes('EntryPoint = "FindWindowW"'));
      assert.ok(script.includes('FindWindow("Shell_TrayWnd", $null)'));
      assert.ok(script.includes('ImmersiveColorSet'));
    });

    it('should write both app and system theme values for light mode', () => {
      const script = utils.generateThemeSwitchScript('light');
      assert.ok(script.includes('/v AppsUseLightTheme /t REG_DWORD /d 1 /f'));
      assert.ok(script.includes('/v SystemUsesLightTheme /t REG_DWORD /d 1 /f'));
    });

    it('should generate a direct taskbar refresh call', () => {
      const script = utils.generateThemeSwitchScript('dark');
      assert.ok(script.includes('SendMessageTimeout($tray, $WM_SETTINGCHANGE'));
    });
  });
});
