'use strict'

const { invoke } = require('./task-service')

/** Builds the read-only settings API retained for history cleanup and runtime defaults. */
function createSettingsApi(metadataRepository) {
  return {
    /** Returns the current device settings singleton without exposing obsolete interpreter controls. */
    get() {
      return invoke(() => metadataRepository.read('settings'))
    }
  }
}

module.exports = { createSettingsApi }
