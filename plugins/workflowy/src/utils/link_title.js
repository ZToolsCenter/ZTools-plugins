const http = require('http');
const https = require('https');
const zlib = require('zlib');

const TITLE_FETCH_TIMEOUT_MS = 1000;
const MAX_REDIRECTS = 5;
const DEBUG_HOSTS = new Set(['mp.weixin.qq.com']);

const shouldDebug = (targetUrl) => {
    try {
        const urlObject = new URL(targetUrl);
        return DEBUG_HOSTS.has(urlObject.hostname);
    } catch (error) {
        return false;
    }
};

const debugLog = (targetUrl, message, extra) => {
    if (!shouldDebug(targetUrl)) return;
    if (typeof extra === 'undefined') console.log(`[link_title] ${message}`);
    else console.log(`[link_title] ${message}`, extra);
};

const normalizeWhitespace = (text) => String(text || '').replace(/\s+/g, ' ').trim();

const decodeHtmlEntities = (text) => normalizeWhitespace(String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, '\'')
    .replace(/&#(\d+);/g, (_, code) => {
        const value = Number(code);
        return Number.isFinite(value) ? String.fromCodePoint(value) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
        const value = Number.parseInt(code, 16);
        return Number.isFinite(value) ? String.fromCodePoint(value) : '';
    }));

const matchMetaTitle = (html) => {
    const patterns = [
        /<meta\b[^>]*property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/i,
        /<meta\b[^>]*content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:title["'][^>]*>/i,
        /<meta\b[^>]*name\s*=\s*["']twitter:title["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/i,
        /<meta\b[^>]*content\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']twitter:title["'][^>]*>/i
    ];

    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1]) return decodeHtmlEntities(match[1]);
    }
    return '';
};

const matchDocumentTitle = (html) => {
    const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    return match && match[1] ? decodeHtmlEntities(match[1]) : '';
};

const checkMetaTags = (html) => ({
    hasOgTitleTag: /property\s*=\s*["']og:title["']/i.test(html),
    hasTwitterTitleTag: /name\s*=\s*["']twitter:title["']/i.test(html),
    hasTitleTag: /<title\b[^>]*>[\s\S]*?<\/title>/i.test(html)
});

const buildRequestHeaders = (urlObject) => {
    const headers = {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        'Upgrade-Insecure-Requests': '1',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
    };

    if (urlObject.hostname === 'mp.weixin.qq.com') {
        headers.Referer = 'https://mp.weixin.qq.com/';
    } else {
        headers.Referer = `${urlObject.protocol}//${urlObject.host}/`;
    }

    return headers;
};

const readResponseBody = (response) => new Promise((resolve, reject) => {
    const encoding = String(response.headers['content-encoding'] || '').toLowerCase();
    let stream = response;

    if (encoding.includes('br')) stream = response.pipe(zlib.createBrotliDecompress());
    else if (encoding.includes('gzip')) stream = response.pipe(zlib.createGunzip());
    else if (encoding.includes('deflate')) stream = response.pipe(zlib.createInflate());

    const chunks = [];
    stream.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
});

const requestHtml = (targetUrl, options = {}, redirectCount = 0) => new Promise((resolve, reject) => {
    if (redirectCount > MAX_REDIRECTS) {
        debugLog(targetUrl, 'too many redirects');
        reject(new Error('Too many redirects'));
        return;
    }

    const urlObject = new URL(targetUrl);
    const client = urlObject.protocol === 'https:' ? https : http;
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : TITLE_FETCH_TIMEOUT_MS;
    debugLog(targetUrl, `request start (redirect=${redirectCount}, timeout=${timeoutMs}ms)`);
    const requestOptions = {
        protocol: urlObject.protocol,
        hostname: urlObject.hostname,
        port: urlObject.port || undefined,
        path: `${urlObject.pathname || '/'}${urlObject.search || ''}`,
        method: 'GET',
        headers: buildRequestHeaders(urlObject)
    };
    const request = client.request(requestOptions, async (response) => {
        const statusCode = response.statusCode || 0;
        const location = response.headers.location;
        debugLog(targetUrl, `response status=${statusCode}`, {
            contentType: response.headers['content-type'],
            location: location || null
        });

        if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
            response.resume();
            const redirectUrl = new URL(location, urlObject).toString();
            debugLog(targetUrl, `follow redirect -> ${redirectUrl}`);
            try {
                const redirectedHtml = await requestHtml(redirectUrl, options, redirectCount + 1);
                resolve(redirectedHtml);
            } catch (error) {
                reject(error);
            }
            return;
        }

        if (statusCode < 200 || statusCode >= 300) {
            response.resume();
            debugLog(targetUrl, 'non-2xx response, abort title fetch');
            resolve(null);
            return;
        }

        const contentType = String(response.headers['content-type'] || '').toLowerCase();
        if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
            response.resume();
            debugLog(targetUrl, `unsupported content-type: ${contentType}`);
            resolve(null);
            return;
        }

        try {
            const html = await readResponseBody(response);
            debugLog(targetUrl, `html received length=${html ? html.length : 0}`);
            resolve(html || null);
        } catch (error) {
            debugLog(targetUrl, `read body failed: ${error.message}`);
            reject(error);
        }
    });

    request.setTimeout(timeoutMs, () => {
        request.destroy(new Error('Request timeout'));
    });
    request.on('error', reject);
    request.end();
});

async function fetchPageTitle(url, options = {}) {
    const targetUrl = String(url || '').trim();
    if (!/^https?:\/\//i.test(targetUrl)) return null;

    try {
        const html = await requestHtml(targetUrl, options);
        if (!html) {
            debugLog(targetUrl, 'no html returned');
            return null;
        }

        // Check meta tags once, reuse results for both title extraction and debug logging
        const metaTags = checkMetaTags(html);
        const metaTitle = matchMetaTitle(html);
        const documentTitle = metaTitle ? '' : matchDocumentTitle(html);
        debugLog(targetUrl, 'title extraction summary', {
            ...metaTags,
            resolvedFrom: metaTitle ? 'meta' : (documentTitle ? 'title' : 'none')
        });

        const resolvedTitle = metaTitle || documentTitle || null;
        if (resolvedTitle) debugLog(targetUrl, `resolved title: ${resolvedTitle}`);
        else debugLog(targetUrl, 'no title matched');
        return resolvedTitle;
    } catch (error) {
        debugLog(targetUrl, `fetch title failed: ${error.message}`);
        return null;
    }
}

module.exports = {
    TITLE_FETCH_TIMEOUT_MS,
    fetchPageTitle,
    // Exported for testing
    matchMetaTitle,
    matchDocumentTitle,
    checkMetaTags
};
