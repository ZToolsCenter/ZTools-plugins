import { createPinia } from 'pinia'
import piniaPersistedstate from 'pinia-plugin-persistedstate'
import FloatingVue from 'floating-vue'
import 'floating-vue/dist/style.css'
import { createApp } from 'vue'
import { installNuxtCompat } from './nuxt-compat'
import './assets/css/app.css'
import App from './App.vue'
import autoAnimate from '@formkit/auto-animate'

const DEFAULT_EXPEND_HEIGHT = 700
const DETACHED_WINDOW_HEIGHT_KEY = 'showcode:detached-window-height'
const MIN_WINDOW_HEIGHT = 480
const MAX_WINDOW_HEIGHT = 1600

function normalizeWindowHeight(height: number) {
  if (!Number.isFinite(height)) {
    return null
  }

  return Math.round(Math.min(Math.max(height, MIN_WINDOW_HEIGHT), MAX_WINDOW_HEIGHT))
}

function getWindowType() {
  try {
    return window.ztools?.getWindowType?.()
  } catch {
    return undefined
  }
}

function readDetachedWindowHeight() {
  const storedHeight = Number(window.localStorage.getItem(DETACHED_WINDOW_HEIGHT_KEY))

  return normalizeWindowHeight(storedHeight)
}

function saveDetachedWindowHeight() {
  const height = normalizeWindowHeight(window.innerHeight)

  if (height) {
    window.localStorage.setItem(DETACHED_WINDOW_HEIGHT_KEY, String(height))
  }
}

function applyInitialExpendHeight() {
  if (!window.ztools?.setExpendHeight || getWindowType() === 'detach') {
    return
  }

  window.ztools.setExpendHeight(readDetachedWindowHeight() ?? DEFAULT_EXPEND_HEIGHT)
}

function rememberDetachedWindowHeight() {
  let isTracking = false
  let resizeFrame = 0

  const startTracking = () => {
    if (isTracking || getWindowType() !== 'detach') {
      return
    }

    const scheduleSave = () => {
      if (resizeFrame) {
        window.cancelAnimationFrame(resizeFrame)
      }

      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = 0
        saveDetachedWindowHeight()
      })
    }

    isTracking = true
    saveDetachedWindowHeight()
    window.addEventListener('resize', scheduleSave, { passive: true })
  }

  startTracking()
  window.ztools?.onPluginDetach?.(startTracking)
}

const app = createApp(App)

const pinia = createPinia()
pinia.use(piniaPersistedstate)

app.use(pinia)
app.use(FloatingVue)
app.directive('auto-animate', {
  mounted(el, binding) {
    autoAnimate(el, binding.value)
  },
})

installNuxtCompat(app)

applyInitialExpendHeight()
rememberDetachedWindowHeight()

app.mount('#app')
