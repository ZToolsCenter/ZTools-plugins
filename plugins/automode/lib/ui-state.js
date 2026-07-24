(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.autoModeUiState = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  function shouldDisableScheduleInputs(state) {
    return !!state && !!state.scheduleEnabled;
  }

  function hasThemeStateChanged(state) {
    if (!state) {
      return false;
    }
    return state.previousIsDark !== !!state.detectedIsDark;
  }

  return {
    shouldDisableScheduleInputs: shouldDisableScheduleInputs,
    hasThemeStateChanged: hasThemeStateChanged
  };
}));
