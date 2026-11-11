const context = require('../context.cjs')
const requests = new Set()
async function httpFetch(url, options = {}) {
  const request = context.lx.network.request({ url, ...options })
  requests.add(request)
  try {
    const response = await request.result
    return { ...response, body: Buffer.from(response.raw).toString('utf8') }
  } finally { requests.delete(request) }
}
function cancelRequests() { for (const request of requests) request.cancel() }
module.exports = { httpFetch, cancelRequests }
