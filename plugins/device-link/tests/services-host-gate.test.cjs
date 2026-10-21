'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const test = require('node:test')

test('unsupported real hosts leave the actual preload inert before DB, directories, or server startup', () => {
  const servicesPath = path.resolve(__dirname, '../public/preload/services.js')
  const originalLoad = Module._load
  const originalMkdirSync = fs.mkdirSync
  const previousWindow = global.window
  let dbReads = 0
  let directoryCreates = 0
  let serverStarts = 0
  const ztools = new Proxy({
    getAppVersion() { return '2.3.9' },
  }, {
    get(target, property, receiver) {
      if (property === 'db') {
        dbReads += 1
        throw new Error('unsupported hosts must not access the database')
      }
      return Reflect.get(target, property, receiver)
    },
  })

  try {
    global.window = { ztools }
    fs.mkdirSync = (...args) => {
      directoryCreates += 1
      return originalMkdirSync(...args)
    }
    Module._load = function load(request, parent, isMain) {
      if (request === 'electron') return {}
      if (request === './core/server' && parent?.filename === servicesPath) {
        return {
          CHUNK_SIZE: 1,
          createDeviceLinkServer() {
            serverStarts += 1
            throw new Error('unsupported hosts must not start the server')
          },
        }
      }
      return originalLoad.call(this, request, parent, isMain)
    }
    delete require.cache[servicesPath]
    require(servicesPath)

    assert.deepEqual(window.deviceLink, {})
    assert.equal(Object.isFrozen(window.deviceLink), true)
    assert.equal(dbReads, 0)
    assert.equal(directoryCreates, 0)
    assert.equal(serverStarts, 0)
  } finally {
    delete require.cache[servicesPath]
    Module._load = originalLoad
    fs.mkdirSync = originalMkdirSync
    if (previousWindow === undefined) delete global.window
    else global.window = previousWindow
  }
})
