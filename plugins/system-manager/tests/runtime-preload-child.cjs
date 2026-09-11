'use strict'

const Module = require('node:module')
const path = require('node:path')

const [preloadPath, pageUrl, hostMode = 'modern'] = process.argv.slice(2)
if (!path.isAbsolute(preloadPath) || typeof pageUrl !== 'string') process.exit(2)

const originalLoad = Module._load
const serviceLoads = []
Module._load = function load(request, parent, isMain) {
  if (/(?:^|[/\\])modules[/\\][^/\\]+(?:[/\\]|$)/.test(request)) serviceLoads.push(request)
  if (request === 'electron') {
    return {
      shell: {
        async trashItem() {},
        showItemInFolder() {},
      },
    }
  }
  return originalLoad.call(this, request, parent, isMain)
}

const registeredTools = []
const ztools = {
  onPluginEnter() {},
  copyText() {},
}
if (hostMode !== 'legacy') {
  ztools.registerTool = (name, handler) => {
    if (hostMode === 'reject-one' && name === 'render_diagnostic_report') throw new Error('rejected')
    registeredTools.push({ name, handlerType: typeof handler })
  }
}

global.window = {
  location: {
    href: pageUrl,
    assign(value) { this.href = value },
  },
  ztools,
}

require(preloadPath)

const bridgeNames = [
  'systemManagerSuite',
  'systemManagerAgentAccess',
  'systemReport',
  'applicationUninstaller',
  'startupManager',
  'systemCleaner',
  'lanDiscovery',
]
process.stdout.write(JSON.stringify({
  bridges: bridgeNames.filter((name) => Object.hasOwn(window, name)),
  registeredTools,
  serviceLoads,
}))
