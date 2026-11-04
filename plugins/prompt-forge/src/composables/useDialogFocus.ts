import { nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useDialogFocus(visible: () => boolean) {
  const dialogRef: Ref<HTMLElement | null> = ref(null)
  let previousFocus: HTMLElement | null = null

  function restoreFocus() {
    if (previousFocus?.isConnected) previousFocus.focus()
    previousFocus = null
  }

  watch(visible, async isVisible => {
    if (!isVisible) {
      restoreFocus()
      return
    }

    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    const dialog = dialogRef.value
    if (!dialog) return
    const target = dialog.querySelector<HTMLElement>('[data-autofocus]')
      || dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      || dialog
    target.focus()
  })

  function trapFocus(event: KeyboardEvent) {
    if (event.key !== 'Tab') return
    const dialog = dialogRef.value
    if (!dialog) return
    const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
      .filter(element => element.offsetParent !== null)

    if (!focusable.length) {
      event.preventDefault()
      dialog.focus()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault()
      first.focus()
    }
  }

  onBeforeUnmount(restoreFocus)

  return { dialogRef, trapFocus }
}
