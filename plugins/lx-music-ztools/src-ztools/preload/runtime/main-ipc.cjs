const context = require('./context.cjs')
function mainHandle(name, listener) {
  context.bridge.register(name, params => listener({ event: null, params }))
}
module.exports = { mainHandle, mainOn: mainHandle, mainOnce: mainHandle }
