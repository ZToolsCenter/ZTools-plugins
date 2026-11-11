// Keep the two original search-cleanup options independent in the plugin build.
// Clearing the result query must not flow back into a preserved draft input.
module.exports = source => {
  source = source.replaceAll('\r\n', '\n')
  const declaration = '    let prevTempSearchSource = \'\''
  const clearList = "          if (appSetting['odc.isAutoClearSearchList']) setSearchText('')"
  const syncInput = '    watch(_searchText, (newValue, oldValue) => {\n      searchText.value = newValue'
  for (const contract of [declaration, clearList, syncInput]) {
    if (!source.includes(contract)) throw new Error('LX search-input cleanup contract changed')
  }
  return source
    .replace(declaration, declaration + '\n    let clearingSearchList = false')
    .replace(clearList, `          if (appSetting['odc.isAutoClearSearchList']) {
            clearingSearchList = true
            setSearchText('')
            void nextTick(() => { clearingSearchList = false })
          }`)
    .replace(syncInput, `    watch(_searchText, (newValue, oldValue) => {
      if (clearingSearchList && newValue === '') return
      searchText.value = newValue`)
}
