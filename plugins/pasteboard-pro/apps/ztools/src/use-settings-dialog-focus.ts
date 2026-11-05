import { nextTick, onBeforeUnmount, onMounted, watch, type Ref } from "vue";

/** Keep settings keyboard focus within its modal, including pending saves. */
export function useSettingsDialogFocus(
  dialogElement: Ref<HTMLElement | null>,
  saving: () => boolean,
): (event: KeyboardEvent) => void {
  const previousFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;

  onMounted(async () => {
    await nextTick();
    dialogElement.value
      ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?.focus({ preventScroll: true });
  });

  onBeforeUnmount(() => {
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  });

  watch(saving, async (pending) => {
    if (!pending) return;
    await nextTick();
    dialogElement.value?.focus({ preventScroll: true });
  });

  return function trapDialogFocus(event: KeyboardEvent): void {
    if (event.key !== "Tab") return;
    const dialog = dialogElement.value;
    if (dialog === null) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    )].filter((element) => element.tabIndex >= 0 &&
      element.getClientRects().length > 0 && element.closest("[inert]") === null);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (first === undefined || last === undefined) {
      event.preventDefault();
      dialog.focus();
    } else if (document.activeElement === dialog || !dialog.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
}
