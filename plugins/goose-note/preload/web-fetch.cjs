const dns = require("dns");
const http = require("http");
const https = require("https");
const net = require("net");
const zlib = require("zlib");
const { URL } = require("url");

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 4;

function isPrivateIPv4(address, options = {}) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }

  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (!options.allowProxyBenchmarkRange &&
      a === 198 &&
      (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isPrivateIp(address, options = {}) {
  const normalized = String(address).toLowerCase().split("%")[0];
  const family = net.isIP(normalized);
  if (family === 4) return isPrivateIPv4(normalized, options);
  if (family !== 6) return true;

  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1], options);

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}

function parsePublicUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || "").trim());
  } catch {
    throw new Error("网址格式不正确");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("只允许读取 HTTP 或 HTTPS 网页");
  }
  if (parsed.username || parsed.password) {
    throw new Error("网址不能包含账号或密码");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    !hostname.includes(".")
  ) {
    throw new Error("不能读取本机或内网地址");
  }
  if (net.isIP(hostname) && isPrivateIp(hostname)) {
    throw new Error("不能读取本机或内网地址");
  }

  return parsed;
}

function resolvePublicAddress(hostname) {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error || !Array.isArray(addresses) || addresses.length === 0) {
        reject(new Error("无法解析网页地址"));
        return;
      }

      const publicAddress = addresses.find(
        (item) =>
          item &&
          !isPrivateIp(item.address, { allowProxyBenchmarkRange: true }),
      );
      if (!publicAddress) {
        reject(new Error("不能读取本机或内网地址"));
        return;
      }
      resolve(publicAddress);
    });
  });
}

function decodeBody(buffer, encoding) {
  const normalized = String(encoding || "").toLowerCase();
  if (normalized.includes("br")) return zlib.brotliDecompressSync(buffer);
  if (normalized.includes("gzip")) return zlib.gunzipSync(buffer);
  if (normalized.includes("deflate")) return zlib.inflateSync(buffer);
  return buffer;
}

async function fetchPublicText(rawUrl, options = {}) {
  const timeoutMs = Math.min(
    30_000,
    Math.max(1_000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS),
  );
  const maxBytes = Math.min(
    4 * 1024 * 1024,
    Math.max(64 * 1024, Number(options.maxBytes) || DEFAULT_MAX_BYTES),
  );

  async function visit(currentUrl, redirectsLeft) {
    const parsed = parsePublicUrl(currentUrl);
    const resolved = await resolvePublicAddress(parsed.hostname);
    const library = parsed.protocol === "http:" ? http : https;

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };

      const request = library.request(
        {
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port || undefined,
          path: `${parsed.pathname}${parsed.search}`,
          method: "GET",
          headers: {
            Accept:
              "text/html,application/xhtml+xml,application/xml,text/xml,text/plain,application/rss+xml,application/atom+xml;q=0.9,*/*;q=0.2",
            "Accept-Encoding": "gzip, deflate, br",
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 GooseNote/1.0",
          },
          lookup: (_hostname, lookupOptions, callback) => {
            const cb =
              typeof lookupOptions === "function" ? lookupOptions : callback;
            if (typeof lookupOptions === "object" && lookupOptions?.all) {
              cb(null, [resolved]);
              return;
            }
            cb(null, resolved.address, resolved.family);
          },
        },
        (response) => {
          const status = response.statusCode || 0;
          if (status >= 300 && status < 400 && response.headers.location) {
            response.resume();
            if (redirectsLeft <= 0) {
              finish(reject, new Error("网页重定向次数过多"));
              return;
            }
            let nextUrl;
            try {
              nextUrl = new URL(response.headers.location, parsed).toString();
            } catch {
              finish(reject, new Error("网页返回了无效的重定向地址"));
              return;
            }
            visit(nextUrl, redirectsLeft - 1).then(
              (value) => finish(resolve, value),
              (error) => finish(reject, error),
            );
            return;
          }

          if (status < 200 || status >= 300) {
            response.resume();
            finish(reject, new Error(`网页请求失败（HTTP ${status || "未知"}）`));
            return;
          }

          const contentType = String(response.headers["content-type"] || "");
          if (
            contentType &&
            !/(?:text\/|html|xml|json|rss|atom)/i.test(contentType)
          ) {
            response.resume();
            finish(reject, new Error("该地址不是可读取的文本网页"));
            return;
          }

          const chunks = [];
          let total = 0;
          response.on("data", (chunk) => {
            total += chunk.length;
            if (total > maxBytes) {
              request.destroy();
              finish(reject, new Error("网页内容过大，已停止读取"));
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () => {
            try {
              const decoded = decodeBody(
                Buffer.concat(chunks),
                response.headers["content-encoding"],
              );
              if (decoded.length > maxBytes * 2) {
                finish(reject, new Error("网页解压后内容过大，已停止读取"));
                return;
              }
              finish(resolve, {
                ok: true,
                url: parsed.toString(),
                status,
                contentType,
                text: decoded.toString("utf8"),
              });
            } catch {
              finish(reject, new Error("网页内容解码失败"));
            }
          });
          response.on("error", (error) => finish(reject, error));
        },
      );

      request.setTimeout(timeoutMs, () => {
        request.destroy();
        finish(reject, new Error("网页读取超时"));
      });
      request.on("error", (error) => finish(reject, error));
      request.end();
    });
  }

  return visit(rawUrl, MAX_REDIRECTS);
}

module.exports = {
  fetchPublicText,
  isPrivateIp,
  parsePublicUrl,
};
