<template>
  <Teleport to="body">
    <div class="settings-overlay" @click.self="$emit('close')">
      <div
        ref="modalRef"
        class="settings-modal"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
      >
        <div class="settings-header">
          <h3 :id="titleId" class="settings-title">{{ t('settings.title') }}</h3>
          <button ref="closeButtonRef" type="button" class="settings-close" @click="$emit('close')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div class="settings-body">
          <!-- Theme Section -->
          <div class="settings-section">
            <h4 class="section-label">{{ t('settings.theme') }}</h4>
            <div class="theme-options">
              <button
                class="theme-card"
                :class="{ active: theme === 'system' }"
                @click="settings.setTheme('system')"
              >
                <div class="theme-card__preview theme-card__preview--system">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                  </svg>
                </div>
                <span class="theme-card__label">{{ t('settings.systemTheme') }}</span>
                <svg v-if="theme === 'system'" class="theme-card__check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </button>

              <button
                class="theme-card"
                :class="{ active: theme === 'dark' }"
                @click="settings.setTheme('dark')"
              >
                <div class="theme-card__preview theme-card__preview--dark">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
                  </svg>
                </div>
                <span class="theme-card__label">{{ t('settings.darkTheme') }}</span>
                <svg v-if="theme === 'dark'" class="theme-card__check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </button>

              <button
                class="theme-card"
                :class="{ active: theme === 'light' }"
                @click="settings.setTheme('light')"
              >
                <div class="theme-card__preview theme-card__preview--light">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                  </svg>
                </div>
                <span class="theme-card__label">{{ t('settings.lightTheme') }}</span>
                <svg v-if="theme === 'light'" class="theme-card__check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </button>
            </div>
          </div>

          <!-- Language Section -->
          <div class="settings-section">
            <h4 class="section-label">{{ t('settings.language') }}</h4>
            <UiSelect
              v-model="selectedLocale"
              :options="localeOptions"
              class="lang-select"
            />
          </div>

          <div class="settings-section">
            <h4 class="section-label">{{ t('settings.accessibility') }}</h4>
            <div class="settings-actions">
              <button class="settings-action" type="button" @click="emit('open-shortcuts')">
                <span class="settings-action__label">{{ t('settings.openShortcuts') }}</span>
                <span class="settings-action__hint">{{ t('shortcuts.keys.help') }}</span>
              </button>
              <button class="settings-action" type="button" @click="emit('replay-onboarding')">
                <span class="settings-action__label">{{ t('settings.replayOnboarding') }}</span>
                <span class="settings-action__hint">{{ t('shortcuts.keys.replayGuide') }}</span>
              </button>
            </div>
            <label class="settings-toggle" for="shortcuts-enabled">
              <span class="settings-toggle__label">{{ t('settings.shortcutsEnabled') }}</span>
              <input id="shortcuts-enabled" v-model="shortcutsEnabled" type="checkbox" />
            </label>
            <label class="settings-toggle" for="cookies-enabled">
              <span class="settings-toggle__label">{{ t('settings.cookiesEnabled') }}</span>
              <input id="cookies-enabled" v-model="cookiesEnabled" type="checkbox" />
            </label>
            <label class="settings-toggle" for="persist-session-cookies">
              <span class="settings-toggle__label">{{ t('settings.persistSessionCookies') }}</span>
              <input id="persist-session-cookies" v-model="persistSessionCookies" type="checkbox" :disabled="!cookiesEnabled" />
            </label>
            <div class="settings-actions">
              <button class="settings-action" type="button" @click="clearCookies">
                <span class="settings-action__label">{{ t('settings.clearCookies') }}</span>
                <span class="settings-action__hint">{{ t('settings.clearCookiesHint') }}</span>
              </button>
            </div>
          </div>

          <!-- About Section -->
          <div class="settings-section">
            <h4 class="section-label">{{ t('settings.about') }}</h4>
            <div class="about-card">
              <div class="about-card__logo">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                </svg>
              </div>
              <div class="about-card__content">
                <h5 class="about-card__title">{{ t('settings.projectTitle') }}</h5>
                <p class="about-card__desc">{{ t('settings.projectDesc') }}</p>
              </div>
            </div>
          </div>

          <!-- Tech Stack Section -->
          <div class="settings-section">
            <h4 class="section-label">{{ t('settings.techStack') }}</h4>
            <div class="tech-grid">
              <div class="tech-card" style="--tech-color: #42B883">
                <svg class="tech-card__icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 19.5h4.5l1.5-3h8l1.5 3H22L12 2zm-2.5 13l-1.5 3h-3l4-7 4 7h-3l-1.5-3h-1z"/></svg>
                <span class="tech-card__label">Vue 3</span>
              </div>
              <div class="tech-card" style="--tech-color: #3178C6">
                <svg class="tech-card__icon" viewBox="0 0 24 24" fill="currentColor"><path d="M1.125 0C.502 0 0 .502 0 1.125v21.75C0 23.498.502 24 1.125 24h21.75c.623 0 1.125-.502 1.125-1.125V1.125C24 .502 23.498 0 22.875 0zm17.363 9.75c.612 0 1.154.037 1.627.111a6.38 6.38 0 0 1 1.306.34v2.458a3.95 3.95 0 0 0-.643-.361 5.093 5.093 0 0 0-.717-.26 5.453 5.453 0 0 0-1.426-.2c-.3 0-.573.028-.819.086a2.1 2.1 0 0 0-.623.242c-.17.104-.3.229-.393.374a.888.888 0 0 0-.14.49c0 .196.053.373.156.529.104.156.252.304.443.444s.423.276.696.41c.273.135.582.274.926.416.47.197.892.407 1.266.628.374.222.695.473.963.753.268.279.472.598.614.957.142.359.214.776.214 1.253 0 .657-.125 1.21-.373 1.656a3.033 3.033 0 0 1-1.012 1.085 4.38 4.38 0 0 1-1.487.596c-.566.12-1.163.18-1.79.18a9.916 9.916 0 0 1-1.84-.164 5.544 5.544 0 0 1-1.512-.493v-2.63c.285.285.603.524.953.717.35.193.713.347 1.09.462.376.115.743.19 1.1.224.357.035.684.052.982.052.3 0 .564-.024.793-.072.229-.048.42-.118.574-.21.154-.092.27-.208.35-.349a.976.976 0 0 0-.024-1.077.98.98 0 0 0-.349-.349 3.43 3.43 0 0 0-.574-.332 11.19 11.19 0 0 0-.815-.39 14.19 14.19 0 0 1-1.098-.546 5.14 5.14 0 0 1-.889-.606 2.74 2.74 0 0 1-.615-.785 2.374 2.374 0 0 1-.226-1.065c0-.585.113-1.084.338-1.497.226-.413.534-.754.924-1.023a4.27 4.27 0 0 1 1.373-.623 6.793 6.793 0 0 1 1.68-.204zM13.5 9.75h2.625v10.5H13.5z"/></svg>
                <span class="tech-card__label">TypeScript</span>
              </div>
              <div class="tech-card" style="--tech-color: #646CFF">
                <svg class="tech-card__icon" viewBox="0 0 24 24" fill="currentColor"><path d="M13.975 2.246a.5.5 0 0 1 .573.354l.95 3.503 3.503.95a.5.5 0 0 1 0 .966l-3.503.95-.95 3.503a.5.5 0 0 1-.966 0l-.95-3.503-3.503-.95a.5.5 0 0 1 0-.966l3.503-.95.95-3.503a.5.5 0 0 1 .393-.354z"/><path d="M6.5 14.5l-1 3.5 3.5-1L13 13l-4-4-2.5 5.5z"/></svg>
                <span class="tech-card__label">Vite</span>
              </div>
              <div class="tech-card" style="--tech-color: #42B883">
                <svg class="tech-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
                <span class="tech-card__label">Vue I18n</span>
              </div>
              <div class="tech-card" style="--tech-color: #42B883">
                <svg class="tech-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
                <span class="tech-card__label">Composition API</span>
              </div>
              <div class="tech-card" style="--tech-color: #FF6B6B">
                <svg class="tech-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                <span class="tech-card__label">Reactive Store</span>
              </div>
              <div class="tech-card" style="--tech-color: #2965F1">
                <svg class="tech-card__icon" viewBox="0 0 24 24" fill="currentColor"><path d="M1.5 0h21l-1.91 21.563L11.977 24l-8.564-2.438L1.5 0zm7.031 9.75l-.232-2.718 10.059.003.071-.757.074-.814H7.593l.47 5.263h10.889l-.232 2.718-4.748 1.332-4.748-1.332-.307-3.383H7.031l.47 5.263 6.477 1.82 6.477-1.82.759-8.664H8.531z"/></svg>
                <span class="tech-card__label">CSS Variables</span>
              </div>
              <div class="tech-card" style="--tech-color: #00E5FF">
                <svg class="tech-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="16" height="16" rx="2"/><path d="M6 3h12a2 2 0 012 2v10"/><path d="M10 7v4"/><path d="M14 7v4"/></svg>
                <span class="tech-card__label">Glassmorphism UI</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '../store/settings'
import { setLocale, getLocale } from '../i18n'
import UiSelect from './ui/UiSelect.vue'

const { t } = useI18n()
const settings = useSettingsStore()
const currentLocale = ref<'zh-CN' | 'zh-TW' | 'en' | 'system'>(getLocale() as 'zh-CN' | 'zh-TW' | 'en' | 'system')

const localeOptions = computed(() => [
  { label: t('settings.langSystem'), value: 'system' },
  { label: t('settings.langZhCN'), value: 'zh-CN' },
  { label: t('settings.langZhTW'), value: 'zh-TW' },
  { label: t('settings.langEn'), value: 'en' }
])

const selectedLocale = computed({
  get: () => currentLocale.value,
  set: (val: string) => changeLocale(val as 'zh-CN' | 'zh-TW' | 'en' | 'system')
})

function changeLocale(loc: 'zh-CN' | 'zh-TW' | 'en' | 'system') {
  currentLocale.value = loc
  setLocale(loc)
}

const theme = computed(() => settings.getTheme())

const shortcutsEnabled = computed({
  get: () => settings.isShortcutsEnabled(),
  set: (enabled: boolean) => settings.setShortcutsEnabled(enabled)
})

const cookiesEnabled = computed({
  get: () => settings.isCookiesEnabled(),
  set: (enabled: boolean) => settings.setCookiesEnabled(enabled)
})

const persistSessionCookies = computed({
  get: () => settings.shouldPersistSessionCookies(),
  set: (enabled: boolean) => settings.setPersistSessionCookies(enabled)
})

function clearCookies() {
  if (window.services?.cookiesClear) {
    window.services.cookiesClear()
  }
}

const emit = defineEmits<{
  close: []
  'open-shortcuts': []
  'replay-onboarding': []
}>()

const modalRef = ref<HTMLElement | null>(null)
const closeButtonRef = ref<HTMLButtonElement | null>(null)
const titleId = `settings-modal-title-${Math.random().toString(36).slice(2, 10)}`
let previousFocusedElement: HTMLElement | null = null

function getFocusableElements(): HTMLElement[] {
  const root = modalRef.value
  if (!root) {
    return []
  }

  const selectors = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ]

  return Array.from(root.querySelectorAll<HTMLElement>(selectors.join(','))).filter((el) => {
    return !el.hasAttribute('disabled') && el.tabIndex !== -1
  })
}

function focusInitialElement() {
  if (closeButtonRef.value) {
    closeButtonRef.value.focus()
    return
  }

  const focusables = getFocusableElements()
  focusables[0]?.focus()
}

function onWindowKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }

  if (event.key !== 'Tab') {
    return
  }

  const focusables = getFocusableElements()
  if (focusables.length === 0) {
    event.preventDefault()
    return
  }

  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const active = document.activeElement as HTMLElement | null

  if (event.shiftKey) {
    if (!active || active === first || !modalRef.value?.contains(active)) {
      event.preventDefault()
      last.focus()
    }
    return
  }

  if (!active || active === last || !modalRef.value?.contains(active)) {
    event.preventDefault()
    first.focus()
  }
}

onMounted(async () => {
  previousFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
  await nextTick()
  focusInitialElement()
  window.addEventListener('keydown', onWindowKeydown, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeydown, true)
  previousFocusedElement?.focus()
})
</script>

<style scoped>
.settings-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-bg, rgba(0, 0, 0, 0.4));
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9000;
  animation: overlayIn 0.2s ease;
}

@keyframes overlayIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.settings-modal {
  width: 520px;
  max-width: 92vw;
  max-height: 85vh;
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg, 16px);
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
  animation: modalIn 0.2s ease;
  overflow: hidden;
}

@keyframes modalIn {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-surface);
  flex-shrink: 0;
}

.settings-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.settings-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: var(--radius-sm);
}

.settings-close:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.settings-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-label {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
}

/* Theme Options */
.theme-options {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.theme-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 14px 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  cursor: pointer;
  position: relative;
  color: var(--text-secondary);
}

.theme-card:hover {
  border-color: var(--text-muted);
  background: var(--bg-elevated);
}

.theme-card.active {
  border-color: var(--accent-primary);
  background: var(--bg-elevated);
  color: var(--accent-primary);
}

.theme-card__preview {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
}

.theme-card__preview--system {
  background: linear-gradient(135deg, #1e293b 50%, #f1f5f9 50%);
  color: #fff;
}

.theme-card__preview--dark {
  background: #2b2b2b;
  color: #f9f9f9;
}

.theme-card__preview--light {
  background: #f9f9f9;
  color: #2b2b2b;
  border: 1px solid var(--border-color);
}

.theme-card__label {
  font-size: 12px;
  font-weight: 500;
}

.theme-card__check {
  position: absolute;
  top: 6px;
  right: 6px;
  color: var(--accent-primary);
}

/* Language Select */
.lang-select {
  width: 100%;
}

.settings-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.settings-action {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-primary);
  padding: 10px 12px;
  cursor: pointer;
}

.settings-action:hover {
  border-color: var(--border-color-hover);
  background: var(--bg-elevated);
}

.settings-action__label {
  font-size: 12px;
  font-weight: 500;
}

.settings-action__hint {
  font-size: 11px;
  color: var(--text-muted);
}

.settings-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
  background: var(--bg-surface);
}

.settings-toggle__label {
  font-size: 12px;
  color: var(--text-primary);
}

.settings-toggle input {
  width: 16px;
  height: 16px;
  accent-color: var(--accent-primary);
}

/* About Card */
.about-card {
  display: flex;
  gap: 14px;
  padding: 14px;
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
}

.about-card__logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  color: var(--accent-primary);
  flex-shrink: 0;
  border: 1px solid var(--border-color);
}

.about-card__content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.about-card__title {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.about-card__desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
}

/* Tech Grid */
.tech-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.tech-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 6px 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  cursor: default;
  transition: all 0.2s ease;
}

.tech-card__icon {
  width: 24px;
  height: 24px;
  color: var(--tech-color);
  transition: transform 0.2s ease;
}

.tech-card__label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
  text-align: center;
  transition: color 0.2s ease;
}

.tech-card:hover {
  border-color: var(--tech-color);
  background: var(--bg-elevated);
  box-shadow: 0 0 12px color-mix(in srgb, var(--tech-color) 20%, transparent);
}

.tech-card:hover .tech-card__icon {
  transform: scale(1.1);
}

.tech-card:hover .tech-card__label {
  color: var(--tech-color);
}
</style>
