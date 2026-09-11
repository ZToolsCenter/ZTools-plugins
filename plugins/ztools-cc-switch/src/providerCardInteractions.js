export function shouldSwitchProviderOnDoubleClick({ active, busy, canSwitch, dragging, interactiveTarget } = {}) {
  return Boolean(canSwitch && !active && !busy && !dragging && !interactiveTarget)
}
