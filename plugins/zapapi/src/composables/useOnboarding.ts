import { nextTick } from 'vue'
import { driver } from 'driver.js'

interface UseOnboardingOptions {
  t: (key: string) => string
  hasSeen: () => boolean
  markSeen: () => void
  prepareUi?: () => void
}

function createDriver(options: UseOnboardingOptions) {
  return driver({
    showProgress: true,
    allowClose: true,
    smoothScroll: true,
    overlayOpacity: 0.42,
    nextBtnText: options.t('onboarding.next'),
    prevBtnText: options.t('onboarding.prev'),
    doneBtnText: options.t('onboarding.done'),
    steps: [
      {
        element: '[data-tour-id="env-selector"]',
        popover: {
          title: options.t('onboarding.steps.env.title'),
          description: options.t('onboarding.steps.env.desc'),
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '[data-tour-id="sidebar-root"]',
        popover: {
          title: options.t('onboarding.steps.sidebar.title'),
          description: options.t('onboarding.steps.sidebar.desc'),
          side: 'right',
          align: 'start'
        }
      },
      {
        element: '[data-tour-id="tabs-root"]',
        popover: {
          title: options.t('onboarding.steps.tabs.title'),
          description: options.t('onboarding.steps.tabs.desc'),
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '[data-tour-id="code-generator"]',
        popover: {
          title: options.t('onboarding.steps.code.title'),
          description: options.t('onboarding.steps.code.desc'),
          side: 'bottom',
          align: 'end'
        }
      },
      {
        element: '[data-tour-id="request-method"]',
        popover: {
          title: options.t('onboarding.steps.method.title'),
          description: options.t('onboarding.steps.method.desc'),
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '[data-tour-id="request-url"]',
        popover: {
          title: options.t('onboarding.steps.url.title'),
          description: options.t('onboarding.steps.url.desc'),
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '[data-tour-id="request-config-tabs"]',
        popover: {
          title: options.t('onboarding.steps.config.title'),
          description: options.t('onboarding.steps.config.desc'),
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '[data-tour-id="request-send"]',
        popover: {
          title: options.t('onboarding.steps.send.title'),
          description: options.t('onboarding.steps.send.desc'),
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '[data-tour-id="request-save"]',
        popover: {
          title: options.t('onboarding.steps.save.title'),
          description: options.t('onboarding.steps.save.desc'),
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '[data-tour-id="response-panel"]',
        popover: {
          title: options.t('onboarding.steps.response.title'),
          description: options.t('onboarding.steps.response.desc'),
          side: 'top',
          align: 'start'
        }
      },
      {
        element: '[data-tour-id="shortcuts-entry"]',
        popover: {
          title: options.t('onboarding.steps.shortcuts.title'),
          description: options.t('onboarding.steps.shortcuts.desc'),
          side: 'right',
          align: 'center'
        }
      },
      {
        element: '[data-tour-id="settings-entry"]',
        popover: {
          title: options.t('onboarding.steps.settings.title'),
          description: options.t('onboarding.steps.settings.desc'),
          side: 'right',
          align: 'center'
        }
      }
    ]
  })
}

export function useOnboarding(options: UseOnboardingOptions) {
  async function startTour(markAsSeen: boolean) {
    options.prepareUi?.()
    await nextTick()
    const guide = createDriver(options)
    guide.drive()
    if (markAsSeen) {
      options.markSeen()
    }
  }

  async function startIfNeeded() {
    if (options.hasSeen()) {
      return
    }
    await startTour(true)
  }

  async function replay() {
    await startTour(false)
  }

  return {
    startIfNeeded,
    replay
  }
}
