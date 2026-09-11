const test = require('node:test')
const assert = require('node:assert/strict')

test('双击可用且未激活的卡片时切换 Provider', async () => {
  const { shouldSwitchProviderOnDoubleClick } = await import('../src/providerCardInteractions.js')
  assert.equal(shouldSwitchProviderOnDoubleClick({ canSwitch: true }), true)
})

test('双击当前卡片、交互控件、忙碌态或拖拽态时不切换', async () => {
  const { shouldSwitchProviderOnDoubleClick } = await import('../src/providerCardInteractions.js')
  for (const state of [
    { canSwitch: true, active: true },
    { canSwitch: true, busy: true },
    { canSwitch: true, dragging: true },
    { canSwitch: true, interactiveTarget: true },
    { canSwitch: false }
  ]) assert.equal(shouldSwitchProviderOnDoubleClick(state), false)
})
