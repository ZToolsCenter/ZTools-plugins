"use strict";

const dns = require("node:dns/promises");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const { isPublicAddress } = require("./safe-net.cjs");

async function fetchMarkdownSnippet(rawUrl, options = {}) {
  const url = validateUrl(rawUrl);
  const controller = new AbortController();
  const relayAbort = () => controller.abort(options.signal?.reason || new Error("External fetch cancelled"));
  options.signal?.addEventListener("abort", relayAbort, { once: true });
  if (options.signal?.aborted) relayAbort();
  const timeoutMs = Math.min(30_000, Math.max(1_000, Number(options.timeoutMs) || 12_000));
  const timer = setTimeout(() => controller.abort(new Error("External fetch timed out")), timeoutMs);
  try {
    const address = await withAbort(resolvePublicHost(url.hostname, options.lookup || dns.lookup), controller.signal);
    const response = await (options.request || requestPinned)(url, address, { ...options, signal: controller.signal, timeoutMs });
    if (response.status >= 300 && response.status < 400) throw new Error("External redirects are blocked for safety");
    if (response.status < 200 || response.status >= 300) throw new Error(`External page returned HTTP ${response.status}`);
    if (!/(text\/html|application\/xhtml\+xml|text\/plain)/i.test(response.contentType)) throw new Error("External page is not HTML or plain text");
    const markdown = /text\/html|application\/xhtml\+xml/i.test(response.contentType) ? htmlToText(response.body) : response.body;
    const normalized = markdown.trim();
    const truncated = normalized.length > 20_000;
    const excerpt = normalized.slice(0, 20_000);
    if (!excerpt) throw new Error("External page contains no readable text");
    return `# ${url.hostname}\n\n${excerpt}${truncated ? "\n\n[内容已按 20,000 字符限制截断]" : ""}`;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", relayAbort);
  }
}

function validateUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw new TypeError("A valid http(s) URL is required"); }
  if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password) throw new TypeError("Only http(s) URLs without embedded credentials are allowed");
  return url;
}

async function resolvePublicHost(hostname, lookup) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new Error("Local network URLs are not allowed");
  if (net.isIP(host)) {
    if (!isPublicAddress(host)) throw new Error("Private network URLs are not allowed");
    return { address: host, family: net.isIP(host) };
  }
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!Array.isArray(addresses) || addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("External host does not resolve exclusively to public addresses");
  }
  return addresses[0];
}

function withAbort(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason || new Error("External fetch cancelled"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new Error("External fetch cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function requestPinned(url, address, options = {}) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const request = transport.request({
      protocol: url.protocol, hostname, port: url.port || undefined,
      path: `${url.pathname}${url.search}`, method: "GET",
      headers: { Host: url.host, Accept: "text/html,text/plain,application/xhtml+xml" },
      ...(url.protocol === "https:" && !net.isIP(hostname) ? { servername: hostname } : {}),
      lookup: (_host, lookupOptions, callback) => {
        const done = typeof lookupOptions === "function" ? lookupOptions : callback;
        if (lookupOptions && typeof lookupOptions === "object" && lookupOptions.all) done(null, [{ address: address.address, family: address.family }]);
        else done(null, address.address, address.family);
      },
      signal: options.signal
    }, (response) => {
      const contentType = String(response.headers["content-type"] || "");
      const declared = Number(response.headers["content-length"]);
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      response.once("error", fail);
      response.once("aborted", () => fail(new Error("External page response ended before it was complete")));
      response.once("close", () => {
        if (!response.complete) fail(new Error("External page response ended before it was complete"));
      });
      if (Number.isFinite(declared) && declared > 1_000_000) {
        fail(new Error("External page exceeded the 1 MB safety limit"));
        response.destroy();
        return;
      }
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > 1_000_000) {
          fail(new Error("External page exceeded the 1 MB safety limit"));
          response.destroy();
          return;
        }
        chunks.push(chunk);
      });
      response.once("end", () => {
        if (settled) return;
        settled = true;
        resolve({ status: response.statusCode || 0, contentType, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    request.setTimeout(options.timeoutMs || 12_000, () => request.destroy(new Error("External fetch timed out")));
    request.once("error", reject);
    request.end();
  });
}

function htmlToText(html) {
  return html.replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Math.min(0x10ffff, Number(code))))
    .replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n");
}

module.exports = { fetchMarkdownSnippet, validateUrl, resolvePublicHost, htmlToText, requestPinned };
