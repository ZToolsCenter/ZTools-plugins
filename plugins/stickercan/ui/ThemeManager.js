/**
 * ThemeManager - 主题管理器（ZTools 客户端）
 *
 * 管理深色/浅色/跟随系统主题。
 * 支持 ZTools 设置持久化和 localStorage 兜底。
 */

class ThemeManager {
  constructor(deps = {}) {
    this.settingsService = deps.settingsService;
    this.THEME_KEY = 'theme_preference';
    this.isLightMode = false;
    this.init();
  }

  init() {
    this.applyTheme(this.getUserPreference());
    this.setupSystemThemeListener();
  }

  getUserPreference() {
    if (this.settingsService && this.settingsService.settings) {
      if (this.settingsService.settings.themePreference) {
        return this.settingsService.settings.themePreference;
      }
    }
    const saved = localStorage.getItem(this.THEME_KEY);
    return saved || 'system';
  }

  setUserPreference(theme) {
    localStorage.setItem(this.THEME_KEY, theme);
    if (this.settingsService && this.settingsService.settings) {
      this.settingsService.settings.themePreference = theme;
    }
    this.applyTheme(theme);
    this.updateThemeRadio(theme);
  }

  applyTheme(preference) {
    const root = document.documentElement;

    if (preference === 'system') {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.dataset.theme = isDark ? 'dark' : 'light';
      this.isLightMode = !isDark;
    } else if (preference === 'light') {
      root.dataset.theme = 'light';
      this.isLightMode = true;
    } else {
      root.dataset.theme = 'dark';
      this.isLightMode = false;
    }
  }

  setupSystemThemeListener() {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (this.getUserPreference() === 'system') {
        this.applyTheme('system');
      }
    });
  }

  updateThemeRadio(theme) {
    const radio = document.querySelector(`input[name="theme"][value="${theme}"]`);
    if (radio) {
      radio.checked = true;
    }
  }

  /**
   * 兼容旧 API：加载主题
   */
  loadTheme() {
    if (this.settingsService && this.settingsService.settings) {
      if (this.settingsService.settings.theme !== undefined) {
        this.isLightMode = this.settingsService.settings.theme;
      }
    }
    this.applyTheme(this.getUserPreference());
  }

  /**
   * 兼容旧 API：切换主题
   */
  toggleTheme() {
    this.isLightMode = !this.isLightMode;
    this.setUserPreference(this.isLightMode ? 'light' : 'dark');
  }

  /**
   * 兼容旧 API：应用主题到 DOM
   */
  applyThemeToBody() {
    this.applyTheme(this.isLightMode ? 'light' : 'dark');
  }

  /**
   * 保存主题到设置
   */
  async saveTheme() {
    if (this.settingsService && this.settingsService.settings) {
      this.settingsService.settings.theme = this.isLightMode;
      await this.settingsService.saveSettings();
    }
    localStorage.setItem('emotion-theme', this.isLightMode ? 'light' : 'dark');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ThemeManager;
}
