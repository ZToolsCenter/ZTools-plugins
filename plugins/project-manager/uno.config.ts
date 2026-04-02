import { defineConfig, presetUno, presetIcons } from 'unocss'

export default defineConfig({
  presets: [
    presetUno(),
    presetIcons({
      scale: 1.2,
      cdn: 'https://esm.sh/',
    }),
  ],
  theme: {
    colors: {
      surface: {
        DEFAULT: '#ffffff',
        dark: '#0f172a',
      },
      panel: {
        DEFAULT: '#f8fafc',
        dark: '#0b1120',
      },
      card: {
        DEFAULT: '#ffffff',
        dark: '#1e293b',
      },
    },
  },
  shortcuts: {
    // Consistent focus ring for all interactive elements
    'focus-ring': 'outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-offset-1',
    // Standard transition preset
    'transition-base': 'transition-all duration-200 ease-out',
    // Clickable elements always get pointer
    'clickable': 'cursor-pointer select-none',
    // Panel backgrounds
    'bg-surface': 'bg-white dark:bg-[#0f172a]',
    'bg-panel': 'bg-slate-50 dark:bg-[#0b1120]',
    'bg-card': 'bg-white dark:bg-[#1e293b]',
    // Text colors
    'text-primary': 'text-slate-900 dark:text-slate-100',
    'text-secondary': 'text-slate-600 dark:text-slate-400',
    'text-muted': 'text-slate-400 dark:text-slate-500',
    // Border
    'border-base': 'border-slate-200 dark:border-slate-700/30',
  },
})
