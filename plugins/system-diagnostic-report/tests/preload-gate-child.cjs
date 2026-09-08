'use strict'

const Module = require('node:module')
const path = require('node:path')

const [servicesPath, mode] = process.argv.slice(2)
if (!path.isAbsolute(servicesPath)) process.exit(2)

const ztools = {}
if (mode === 'throwing') ztools.getAppVersion = () => { throw new Error('unavailable') }
else if (mode === 'empty') ztools.getAppVersion = () => ''
else if (mode === 'invalid') ztools.getAppVersion = () => 'ZTools current'
else if (mode === 'below-floor') ztools.getAppVersion = () => '2.3.9'

const heavyLoads = []
const originalLoad = Module._load
Module._load = function trackedLoad(request, parent, isMain) {
  if (request === 'systeminformation' || request === './collectors/core.cjs') heavyLoads.push(request)
  return originalLoad.call(this, request, parent, isMain)
}

global.window = { ztools }
require(servicesPath)

process.stdout.write(JSON.stringify({
  heavyLoads,
  bridgeMethods: Object.keys(window.systemReport || {}),
}))
