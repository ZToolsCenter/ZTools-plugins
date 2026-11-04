'use strict'

const Module = require('node:module')
const path = require('node:path')

const [preloadPath, mode] = process.argv.slice(2)
if (!path.isAbsolute(preloadPath)) process.exit(2)

const ztools = {}
if (mode === 'throwing') ztools.getAppVersion = () => { throw new Error('unavailable') }
else if (mode === 'empty') ztools.getAppVersion = () => ''
else if (mode === 'invalid') ztools.getAppVersion = () => 'ZTools current'
else if (mode === 'below-floor') ztools.getAppVersion = () => '2.3.9'

const managerLoads = []
const originalLoad = Module._load
Module._load = function trackedLoad(request, parent, isMain) {
  if (typeof request === 'string' && request.startsWith('./') && request !== './ztoolsCompatibility') {
    managerLoads.push(request)
  }
  return originalLoad.call(this, request, parent, isMain)
}

let timeoutCount = 0
let intervalCount = 0
global.setTimeout = () => { timeoutCount += 1; return { unref() {} } }
global.setInterval = () => { intervalCount += 1; return { unref() {} } }
global.window = { ztools }

require(preloadPath)
process.stdout.write(JSON.stringify({
  bridgeMethods: Object.keys(window.ccSwitch || {}),
  compatibility: window.ccSwitch?.getHostCompatibility?.(),
  intervalCount,
  managerLoads,
  timeoutCount,
}))
