const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const uiState = require('../lib/ui-state');
const utils = require('../lib/utils');

describe('schedule UI state helpers', () => {
  it('should disable schedule inputs when the scheduler is enabled', () => {
    assert.equal(
      uiState.shouldDisableScheduleInputs({ scheduleEnabled: true }),
      true
    );
  });

  it('should keep schedule inputs enabled when the scheduler is disabled', () => {
    assert.equal(
      uiState.shouldDisableScheduleInputs({ scheduleEnabled: false }),
      false
    );
  });
});

describe('theme sync helpers', () => {
  it('should treat the first detected theme as a change', () => {
    assert.equal(
      uiState.hasThemeStateChanged({ previousIsDark: null, detectedIsDark: true }),
      true
    );
  });

  it('should detect a theme change when the value flips', () => {
    assert.equal(
      uiState.hasThemeStateChanged({ previousIsDark: false, detectedIsDark: true }),
      true
    );
  });

  it('should ignore repeated theme values', () => {
    assert.equal(
      uiState.hasThemeStateChanged({ previousIsDark: true, detectedIsDark: true }),
      false
    );
  });
});

describe('resolveDesiredTheme(config, now)', () => {
  var config = { darkTime: '19:00', lightTime: '07:00' };

  it('should return light when current time is 10:00 (within light window)', () => {
    var now = new Date(2026, 2, 29, 10, 0, 0);
    assert.equal(utils.resolveDesiredTheme(config, now), 'light');
  });

  it('should return dark when current time is 21:00 (within dark window)', () => {
    var now = new Date(2026, 2, 29, 21, 0, 0);
    assert.equal(utils.resolveDesiredTheme(config, now), 'dark');
  });

  it('should return light exactly at lightTime boundary (07:00)', () => {
    var now = new Date(2026, 2, 29, 7, 0, 0);
    assert.equal(utils.resolveDesiredTheme(config, now), 'light');
  });

  it('should return dark exactly at darkTime boundary (19:00)', () => {
    var now = new Date(2026, 2, 29, 19, 0, 0);
    assert.equal(utils.resolveDesiredTheme(config, now), 'dark');
  });

  it('should return dark at midnight (00:00, within dark window)', () => {
    var now = new Date(2026, 2, 29, 0, 0, 0);
    assert.equal(utils.resolveDesiredTheme(config, now), 'dark');
  });

  it('should return light at 06:59 (just before lightTime)', () => {
    var now = new Date(2026, 2, 29, 6, 59, 0);
    assert.equal(utils.resolveDesiredTheme(config, now), 'dark');
  });

  it('should handle custom times (dark 22:00, light 06:00)', () => {
    var customConfig = { darkTime: '22:00', lightTime: '06:00' };
    var at21 = new Date(2026, 2, 29, 21, 0, 0);
    var at23 = new Date(2026, 2, 29, 23, 0, 0);
    assert.equal(utils.resolveDesiredTheme(customConfig, at21), 'light');
    assert.equal(utils.resolveDesiredTheme(customConfig, at23), 'dark');
  });

  it('should return light late at night when the light window spans midnight', () => {
    var overnightConfig = { darkTime: '06:00', lightTime: '22:00' };
    var now = new Date(2026, 2, 29, 23, 0, 0);
    assert.equal(utils.resolveDesiredTheme(overnightConfig, now), 'light');
  });

  it('should return light before dawn when the light window spans midnight', () => {
    var overnightConfig = { darkTime: '06:00', lightTime: '22:00' };
    var now = new Date(2026, 2, 30, 5, 59, 0);
    assert.equal(utils.resolveDesiredTheme(overnightConfig, now), 'light');
  });
});
