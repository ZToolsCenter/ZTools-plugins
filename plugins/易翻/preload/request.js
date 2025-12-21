const http = require ('node:http')
const https = require ('node:https')
const querystring = require ('node:querystring')

async function request(url, { method, data, headers }) {
  const options = new URL (url)
  const protocol = options.protocol === 'https:' ? https : http

  if (method === 'GET') {
    options.search = querystring.stringify (data)
  }
  options.path = options.host + options.search
  const reqOptions = {
    hostname: options.hostname,
    port: options.port,
    path: options.pathname,
    method,
    headers,
  }

  return new Promise ((resolve, reject) => {
    // 发起请求
    const req = protocol.request (reqOptions, async (res) => {
      let response = ''
      for await (const chunk of res) {
        response += chunk
      }

      const data = JSON.parse (response)
      resolve (data)
    })

    req.on ('error', (err) => {
      reject (err)
    })

    if (data) {
      req.write (data)
    }

    req.end ()
  })
}

module.exports = request
