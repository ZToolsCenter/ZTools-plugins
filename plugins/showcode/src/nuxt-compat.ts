import mitt from 'mitt'
import Queue from 'queue'
import { ref } from 'vue'

type RuntimeConfig = {
  public: {
    isDistributing: boolean
    isDesktop: boolean
    platform: {
      windows: boolean
      darwin: boolean
      linux: boolean
    }
  }
}

type IpcLike = {
  on: (...args: any[]) => void
  once: (...args: any[]) => void
  removeListener: (...args: any[]) => void
  addListener: (...args: any[]) => void
  send: (...args: any[]) => void
  invoke: (...args: any[]) => Promise<any>
  sendSync: (...args: any[]) => any
  postMessage: (...args: any[]) => void
  sendTo: (...args: any[]) => void
  sendToHost: (...args: any[]) => void
}

type ShikiService = {
  ready: Promise<void>
  loadLanguage(lang: string): Promise<void>
  loadLanguages(langs?: string[]): Promise<void[]>
  loadTheme(theme: string): Promise<void>
  getTheme(theme: string): any
  languages(): string[]
  languageIsLoaded(lang: string): boolean
  loadedLanguages(): string[]
  themes(): string[]
  themeIsLoaded(theme: string): boolean
  loadedThemes(): string[]
  tokens(code: string, lang: string, theme: string): Promise<any>
}

type NuxtCompatApp = {
  vueApp: any
  $bus: {
    $on: (...args: any[]) => void
    $emit: (...args: any[]) => void
    $off: (...args: any[]) => void
  }
  $queue: any
  $shiki: ShikiService
  $ipc: IpcLike
  $config: RuntimeConfig
}

let currentNuxtApp: NuxtCompatApp | null = null

function isWindowsPlatform() {
  return Boolean(window.ztools?.isWindows?.()) || /win/i.test(navigator.userAgent)
}

function isMacPlatform() {
  return Boolean(window.ztools?.isMacOS?.() || (window.ztools as any)?.isMacOs?.()) || /mac/i.test(navigator.userAgent)
}

function isLinuxPlatform() {
  return Boolean(window.ztools?.isLinux?.()) || /linux/i.test(navigator.userAgent)
}

function createRuntimeConfig(): RuntimeConfig {
  return {
    public: {
      isDistributing: true,
      isDesktop: false,
      platform: {
        windows: isWindowsPlatform(),
        darwin: isMacPlatform(),
        linux: isLinuxPlatform(),
      },
    },
  }
}

function createIpcFallback(): IpcLike {
  const noop = () => undefined

  return {
    on: noop,
    once: noop,
    removeListener: noop,
    addListener: noop,
    send: noop,
    invoke: async () => undefined,
    sendSync: noop,
    postMessage: noop,
    sendTo: noop,
    sendToHost: noop,
  }
}

function createIpcBridge(ipc?: Record<string, any>): IpcLike {
  return {
    ...createIpcFallback(),
    ...(ipc ?? {}),
  }
}

function assetUrl(path: string) {
  const normalized = path.replace(/^\/+/, '')
  return new URL(normalized, document.baseURI).toString()
}

function createShikiService(): ShikiService {
  let highlighter: any = null
  const allLanguageIds = ref<string[]>([])
  const allThemeIds = ref<string[]>([])
  let resolveReady!: () => void

  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })

  const ensureReady = async () => {
    if (highlighter) return

    try {
      const { createHighlighter, bundledLanguagesInfo, bundledThemesInfo } = await import('shiki')

      highlighter = await createHighlighter({
        themes: ['github-light'],
        langs: ['html', 'xml', 'sql', 'javascript', 'json', 'css', 'php'],
      })

      allLanguageIds.value = bundledLanguagesInfo
        .map((lang) => lang.id)
        .filter((id) => !['php-html', 'html-derivative'].includes(id))
        .sort()

      const bundledIds = bundledThemesInfo
        .map((theme) => theme.id)
        .filter((theme) => !['css-variables'].some((value) => theme.includes(value)))
        .sort()

      let customIds: string[] = []
      try {
        const manifest = await fetch(assetUrl('shiki/themes/all.json')).then((r) => r.json())
        customIds = manifest.filter((id: string) => !bundledIds.includes(id)).sort()
      } catch {
        customIds = []
      }

      allThemeIds.value = [...new Set([...bundledIds, ...customIds])].sort()
    } catch (error) {
      console.error('Failed to initialize shiki:', error)
    } finally {
      resolveReady()
    }
  }

  void ensureReady()

  const themeTypeOverrides: Record<string, string> = {
    hc_light: 'dark',
  }

  return {
    ready,

    async loadLanguage(lang: string) {
      await ready
      if (!highlighter || this.languageIsLoaded(lang)) return
      await highlighter.loadLanguage(lang)
    },

    async loadLanguages(langs: string[] = []) {
      return await Promise.all(langs.map(async (lang) => await this.loadLanguage(lang)))
    },

    async loadTheme(theme: string) {
      await ready
      if (!highlighter || this.themeIsLoaded(theme)) return

      try {
        await highlighter.loadTheme(theme)
      } catch {
        const themeData = await fetch(assetUrl(`shiki/themes/${encodeURIComponent(theme)}.json`)).then(
          (r) => {
            if (!r.ok) throw new Error(`Theme "${theme}" not found.`)
            return r.json()
          }
        )

        await highlighter.loadTheme(themeData)
      }
    },

    getTheme(theme: string) {
      return highlighter?.getTheme(theme)
    },

    languages() {
      return allLanguageIds.value
    },

    languageIsLoaded(lang: string) {
      return this.loadedLanguages().includes(lang)
    },

    loadedLanguages() {
      return highlighter?.getLoadedLanguages?.() ?? []
    },

    themes() {
      return allThemeIds.value
    },

    themeIsLoaded(theme: string) {
      return this.loadedThemes().includes(theme)
    },

    loadedThemes() {
      return highlighter?.getLoadedThemes?.() ?? []
    },

    async tokens(code: string, lang: string, theme: string) {
      await ready

      if (!highlighter) return []

      if (code.includes('<?php') && lang === 'php') {
        await this.loadLanguage('php')
      }

      const result = highlighter.codeToTokensBase(code, { lang, theme })
      const themeMeta = highlighter.getTheme(theme)

      if (themeMeta?.name && themeTypeOverrides[themeMeta.name]) {
        // keep parity with the original theme handling; themeMeta is still returned to callers
      }

      return result
    },
  }
}

export function installNuxtCompat(app: any) {
  const busEmitter = mitt()
  const queue = new Queue({
    autostart: true,
    concurrency: 2,
  })
  const config = createRuntimeConfig()
  const shiki = createShikiService()
  const ipc = createIpcBridge(window.electronIpc)

  const nuxtApp: NuxtCompatApp = {
    vueApp: app,
    $bus: {
      $on: busEmitter.on,
      $emit: busEmitter.emit,
      $off: busEmitter.off,
    },
    $queue: queue,
    $shiki: shiki,
    $ipc: ipc,
    $config: config,
  }

  currentNuxtApp = nuxtApp

  Object.assign(app.config.globalProperties, {
    $bus: nuxtApp.$bus,
    $queue: nuxtApp.$queue,
    $shiki: nuxtApp.$shiki,
    $ipc: nuxtApp.$ipc,
    $config: nuxtApp.$config,
  })

  app.provide('nuxtApp', nuxtApp)
  app.provide('bus', nuxtApp.$bus)
  app.provide('queue', queue)
  app.provide('shiki', shiki)
  app.provide('ipc', ipc)
  app.provide('config', config)

  return nuxtApp
}

export function useNuxtApp(): NuxtCompatApp {
  if (!currentNuxtApp) {
    throw new Error('Nuxt compat app has not been installed yet.')
  }

  return currentNuxtApp
}

export function useRuntimeConfig(): RuntimeConfig {
  return currentNuxtApp?.$config ?? createRuntimeConfig()
}
