import { defineStore } from 'pinia'

export const useAppStore = defineStore('app', {
  state: () => ({
    isDarkTheme: false,
    codeEditorThemeMode: 'dracula'
  }),
  actions: {
    updateIsDarkTheme(newValue) {
      this.isDarkTheme = newValue
      this.codeEditorThemeMode = newValue ? 'dracula' : 'base16-light'
    }
  }
})
