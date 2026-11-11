/** Retain LX manual themes; auto follows the public ZTools color notification. */
function bindHostTheme({ host, setting, setDark, apply, watch }) {
  const update = () => apply(setting['theme.id'], setting['theme.lightId'], setting['theme.darkId'])
  try { if (host?.isDarkColors) setDark(Boolean(host.isDarkColors())) } catch {}
  const unwatch = watch(update)
  let closed = false
  host?.onThemeChange?.(theme => {
    if (closed) return
    setDark(Boolean(theme.isDark))
    if (setting['theme.id'] === 'auto') update()
  })
  update()
  return () => { closed = true; unwatch?.() }
}
module.exports = { bindHostTheme }
