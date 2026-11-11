const context = require('./context.cjs')
const setting = key => context.lx?.appSetting?.[`network.proxy.${key}`]
exports.proxy = { get enable() { return setting('enable') }, get host() { return setting('host') }, get port() { return setting('port') } }
