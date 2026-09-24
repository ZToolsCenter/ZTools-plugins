'use strict'

const { invoke } = require('./task-service')

/** Creates the constrained application API that exposes scheduler state but no scheduler internals. */
function createAppApi(scheduler) {
  return {
    /** Returns the authoritative current scheduler status through the standard Result envelope. */
    getSchedulerStatus() {
      return invoke(() => scheduler.getStatus())
    },

    /** Bridges scheduler status pushes and returns the scheduler's idempotent unsubscribe callback. */
    subscribeSchedulerStatus(listener) {
      return scheduler.subscribe(listener)
    }
  }
}

module.exports = { createAppApi }
