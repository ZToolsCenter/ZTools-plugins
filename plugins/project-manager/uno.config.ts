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
        DEFAULT: 'var(--app-surface)',
        dark: 'var(--app-bg)',
      },
      panel: {
        DEFAULT: 'var(--app-bg-muted)',
        dark: 'var(--app-bg-muted)',
      },
      card: {
        DEFAULT: 'var(--app-surface)',
        dark: 'var(--app-surface)',
      },
    },
  },
  shortcuts: {
    // Consistent focus ring for all interactive elements
    'focus-ring': 'outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-offset-1',
    // Standard transition preset
    'transition-base': 'transition-all duration-200 ease-out motion-reduce:transition-none',
    // Clickable elements always get pointer
    'clickable': 'cursor-pointer select-none',
    // Panel backgrounds
    'bg-surface': 'bg-[var(--app-surface)]',
    'bg-panel': 'bg-[var(--app-bg-muted)]',
    'bg-card': 'bg-[var(--app-surface)]',
    // Text colors
    'text-primary': 'text-[var(--app-text)]',
    'text-secondary': 'text-[var(--app-text-secondary)]',
    'text-muted': 'text-[var(--app-text-muted)]',
    // Border
    'border-base': 'border-[var(--app-border)]',
    // Shared desktop app surfaces
    'app-card': 'bg-[var(--app-surface)] border border-[var(--app-border)] rounded-lg shadow-sm',
    'app-toolbar': 'bg-[var(--app-surface-soft)] border border-[var(--app-border)] rounded-lg',
  },
})
