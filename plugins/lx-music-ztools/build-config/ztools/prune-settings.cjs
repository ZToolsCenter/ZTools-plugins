// User approved removal of desktop-only controls, while retaining lyric controls.
module.exports = function pruneSettings(source, file) {
  const removeCheckboxRow = id => {
    const row = new RegExp('^( *)\\.gap-top\\n\\1  base-checkbox\\(id="' + id + '"[^\\n]*\\)\\n', 'm')
    if (!row.test(source)) throw new Error('LX removable checkbox shape changed: ' + id)
    source = source.replace(row, '')
  }
  const removeSection = id => {
    const section = new RegExp('\\ndd(?:\\([^\\n]*\\))?\\n  h3#' + id + '(?:\\s|\\n)[\\s\\S]*?(?=\\ndd(?:\\(|\\n)|\\n</template>)')
    if (!section.test(source)) throw new Error('LX removable section shape changed: ' + id)
    source = source.replace(section, '')
  }
  if (file.endsWith('/SettingBasic.vue')) {
    removeCheckboxRow('setting_start_in_fullscreen'); removeCheckboxRow('setting_to_tray')
    removeSection('basic_window_size'); removeSection('basic_control_btn_position')
  } else if (file.endsWith('/SettingPlay.vue')) {
    removeCheckboxRow('setting_player_power_save_blocker'); removeCheckboxRow('setting_player_showTaskProgess')
    source = source.replace('阻止系统睡眠、Windows 任务栏进度/缩略图按钮和系统状态栏歌词尚无可用的 ZTools 公开接口。', '系统状态栏歌词尚无可用的 ZTools 公开接口。')
  } else if (file.endsWith('/SettingOther.vue')) {
    const block = /\ndd\n  div\n    \.gap-top\n      base-checkbox\(id="setting_transparent_window"[^\n]*\)\n      svg-icon[^\n]*\n/
    if (!block.test(source)) throw new Error('LX removable transparency section shape changed')
    source = source.replace(block, '')
    removeSection('other_tray_theme'); removeSection('other_resource_cache')
    source = source.replace('透明窗口、托盘图标与浏览器资源缓存由 ZTools 管理。下方的歌曲地址、歌词、换源缓存和不喜欢列表保留独立管理。', '歌曲地址、歌词、换源缓存和不喜欢列表由插件独立管理。')
  }
  return source
}
