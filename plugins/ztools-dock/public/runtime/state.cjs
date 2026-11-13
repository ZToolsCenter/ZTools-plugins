'use strict';

/** Preserve immutable entry/category references when only runtime or settings change. */
function mergeState(current, update) {
  if (update.config) return update;
  if (!current) return undefined; // The initial snapshot supplies the complete configuration.
  const { settings, ...runtime } = update;
  return { ...current, ...runtime, ...(settings ? { config: { ...current.config, settings } } : {}) };
}
module.exports = { mergeState };
