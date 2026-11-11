const { workerData, parentPort } = require('node:worker_threads')
const { write } = require('./metadata-job.cjs')
write(workerData).then(metadata => parentPort.postMessage({ ok: true, metadata }), error => parentPort.postMessage({ ok: false, error: error.message }))
