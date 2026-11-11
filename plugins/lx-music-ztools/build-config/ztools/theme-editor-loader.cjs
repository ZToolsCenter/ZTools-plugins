module.exports = source => {
  source = source.replaceAll('\r\n', '\n')
  // Hide-detail colour remains applicable inside the plugin; only window chrome goes.
  for (const kind of ['close', 'min']) {
    const color = new RegExp('              <div :class="\\$style.item">\\n                <div ref="' + kind + '_btn_color_ref"[^\\n]*\\n                <div[^\\n]*\\n              </div>\\n')
    const preview = new RegExp('                <button type="button" :class="\\$style.' + kind + '">[\\s\\S]*?</button>\\n')
    if (!color.test(source) || !preview.test(source)) throw new Error('LX theme editor window colour shape changed: ' + kind)
    source = source.replace(color, '').replace(preview, '')
  }
  return source
}
