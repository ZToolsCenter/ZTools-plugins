const { ready } = require('./runtime/metadata-parser.cjs')
require('./runtime/encodings.cjs')
const { write } = require('./runtime/download/metadata-job.cjs')
window.lxNativeJobs = Object.freeze({ async write(data) {
  try { await ready; return await write(data) }
  catch (error) { return { error: String(error.message || error), stack: String(error.stack || error) } }
} })
