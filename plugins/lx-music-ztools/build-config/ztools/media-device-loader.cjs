const fs = require('node:fs')
const path = require('node:path')
// Preserve the upstream source; replace only its host-dependent output-device hook.
module.exports = source => {
  if (!source.includes('export default () => {')) throw new Error('LX media device contract changed')
  const helper = path.join(__dirname, '../../src/ztools/audio-capabilities.cjs').replaceAll('\\', '/')
  return fs.readFileSync(path.join(__dirname, '../../src/ztools/use-media-device.js'), 'utf8')
    .replace("'./audio-capabilities.cjs'", JSON.stringify(helper))
}
