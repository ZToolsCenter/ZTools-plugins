class ThemeManager {
    constructor() {
        this.THEME_KEY = 'theme_preference';
        this.init();
    }

    init() {
        this.applyTheme(this.getUserPreference());
        this.setupSystemThemeListener();
    }

    getUserPreference() {
        const saved = localStorage.getItem(this.THEME_KEY);
        return saved || 'system';
    }

    setUserPreference(theme) {
        localStorage.setItem(this.THEME_KEY, theme);
        this.applyTheme(theme);
        this.updateThemeRadio(theme);
    }

    applyTheme(preference) {
        const root = document.documentElement;

        if (preference === 'system') {
            const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            root.dataset.theme = isDark ? 'dark' : 'light';
        } else {
            root.dataset.theme = preference;
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
}
