"use strict";

const http = require("node:http");
const https = require("node:https");
const net = require("node:net");

function nodeHttpFetch(rawUrl, init = {}) {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError("MCP transport only supports HTTP and HTTPS");
  const transport = url.protocol === "https:" ? https : http;
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  return new Promise((resolve, reject) => {
    if (init.signal?.aborted) { reject(init.signal.reason || new Error("MCP request cancelled")); return; }
    const request = transport.request({
      protocol: url.protocol, hostname, port: url.port || undefined,
      path: `${url.pathname}${url.search}`, method: init.method || "GET",
      headers: init.headers || {}, signal: init.signal,
      ...(url.protocol === "https:" && !net.isIP(hostname) ? { servername: hostname } : {})
    }, (incoming) => {
      let bodyUsed = false;
      const response = {
        status: incoming.statusCode || 0,
        headers: { get(name) { return incoming.headers[String(name).toLowerCase()]?.toString() || null; } },
        body: {
          getReader() {
            if (bodyUsed) throw new Error("MCP response body was already consumed");
            bodyUsed = true;
            const iterator = incoming[Symbol.asyncIterator]();
            return {
              async read() {
                try { const item = await iterator.next(); return item.done ? { done: true } : { done: false, value: item.value }; }
                catch (error) { throw error; }
              },
              async cancel() {
                incoming.destroy();
            request.destroy();
                try { await iterator.return?.(); } catch {}
              },
              releaseLock() {}
            };
          },
          async cancel() { incoming.destroy(); request.destroy(); }
        }
      };
      resolve(response);
    });
    request.once("error", reject);
    request.end(init.body);
  });
}

module.exports = { nodeHttpFetch };
