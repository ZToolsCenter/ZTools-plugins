import { defineStore } from 'pinia';
import { ref, watch, computed } from 'vue';
import type { Settings } from '../types';
import type { TerminalInfo } from '../api/types';
import { api } from '../api';
import i18n from '../i18n';

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings>({
    editorPath: 'code',
    defaultTerminal: 'cmd',
    customTerminals: [],
    locale: 'zh',
    themeMode: 'auto',
    autoUpdate: true,
    gitAiEnabled: false,
    gitAiBaseUrl: 'https://api.openai.com/v1',
    gitAiApiKey: '',
    gitAiModel: 'gpt-4o-mini',
    gitAiPromptTemplate: '',
  });

  const availableTerminals = ref<TerminalInfo[]>([]);

  const fetchAvailableTerminals = async (force = false) => {
    if (availableTerminals.value.length === 0 || force) {
      try {
        const terminals = await api.detectAvailableTerminals();
        // Keep current selection if valid, or default to first
        availableTerminals.value = terminals;
      } catch (e) {
        console.error('Failed to detect terminals:', e);
      }
    }
    return availableTerminals.value;
  };

  // Initial fetch on app start (lazy)
  // We don't want to block app start, so just call it
  fetchAvailableTerminals();

  const stored = localStorage.getItem('settings');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      // Migrate old themeColor to themeMode if needed, or just ignore
      if (parsed.themeColor && !parsed.themeMode) {
          delete parsed.themeColor;
          parsed.themeMode = 'auto';
      }
      // Migrate single editorPath to editors array
      if (!parsed.editors && parsed.editorPath) {
        parsed.editors = [{ id: crypto.randomUUID(), name: parsed.editorPath === 'code' ? 'VS Code' : parsed.editorPath.split(/[/\\]/).pop() || 'Editor', path: parsed.editorPath }];
      }
      settings.value = { ...settings.value, ...parsed };
    } catch (e) {
      console.error(e);
    }
  }
  // Ensure at least one editor exists
  if (!settings.value.editors || settings.value.editors.length === 0) {
    settings.value.editors = [{ id: crypto.randomUUID(), name: 'VS Code', path: settings.value.editorPath || 'code' }];
  }
  
  const systemThemeMedia = window.matchMedia('(prefers-color-scheme: dark)');
  
  const updateTheme = (e?: MediaQueryListEvent) => {
      const mode = settings.value.themeMode;
      const isDark = mode === 'dark' || (mode === 'auto' && (e ? e.matches : systemThemeMedia.matches));
      
      if (isDark) {
          document.documentElement.classList.add('dark');
      } else {
          document.documentElement.classList.remove('dark');
      }
  };

  // Listen for system changes
  systemThemeMedia.addEventListener('change', (e) => {
      if (settings.value.themeMode === 'auto') {
          updateTheme(e);
      }
  });

  const applySettings = () => {
    // Locale
    if (settings.value.locale) {
      // @ts-ignore
      i18n.global.locale.value = settings.value.locale;
    }
    
    // Theme Mode
    updateTheme();
  };

  // Apply on init
  applySettings();

  watch(settings, (newVal) => {
    localStorage.setItem('settings', JSON.stringify(newVal));
    applySettings();
  }, { deep: true });

  const allTerminals = computed(() => {
    const custom = settings.value.customTerminals || [];
    const detected = availableTerminals.value;
    const ids = new Set(detected.map(t => t.id));
    return [...detected, ...custom.filter(t => !ids.has(t.id))];
  });

  return {
    settings,
    availableTerminals,
    allTerminals,
    fetchAvailableTerminals
  };
});
