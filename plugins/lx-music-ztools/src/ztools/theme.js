import { watch } from 'vue'
import { appSetting } from '@renderer/store/setting'
import { themeId, themeShouldUseDarkColors } from '@renderer/store'
import { applyTheme, getThemes } from '@renderer/store/utils'
import binding from './host-theme.cjs'

binding.bindHostTheme({ host: window.ztools, setting: appSetting,
  setDark: value => { themeShouldUseDarkColors.value = value },
  apply: (id, light, dark) => { themeId.value = id; getThemes(info => applyTheme(id, light, dark, info.dataPath)) },
  watch: callback => watch(() => [appSetting['theme.id'], appSetting['theme.lightId'], appSetting['theme.darkId']], callback),
})
