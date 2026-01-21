const https = preload.https
const http = preload.http
const URL = preload.url.URL;

export function httpsRequest(options, data, json = false, ext = {
    is_https: true
}) {
    let httpReq = https;
    // 判断是否需要https请求
    if (!ext.is_https) {
        httpReq = http;
    }
    return new Promise((resolve, reject) => {

        // 如果请求方法是DELETE 并且有body，需要设置Content-Length
        if (options.method.toUpperCase() === 'DELETE' && data) {
            options.headers['Content-Length'] = preload.buffer.byteLength(data);
        }

        const req = httpReq.request({...options, timeout: 10000}, (res) => {
            const charset = getCharset(res.headers['content-type']);
            const chunks = [];
            res.on('data', (chunk) => {
                chunks.push(chunk);
            });

            res.on('end', () => {
                const buffer = preload.buffer.concat(chunks);
                let responseData;

                if (charset && charset.toLowerCase() !== 'utf-8') {
                    responseData = preload.string2UTF8(buffer, charset, 'utf-8');
                } else {
                    responseData = buffer.toString('utf8');
                }
                if (json && res.headers['content-type'] && res.headers['content-type'].includes('json')) {
                    responseData = JSON.parse(responseData);
                }
                resolve(responseData);
            });
        });

        req.on('error', (e) => {
            reject(e);
        });

        req.on('timeout', () => {
            req.destroy()
            reject(new Error('Request timed out'));
        });

        if (data) {
            req.write(data);
        }
        req.end();
    });
}

function getCharset(contentType) {
    if (!contentType) return null;
    const matches = contentType.match(/charset=([^;]+)/i);
    return matches ? matches[1] : null;
}

export function httpsRequestWithResponseHeader(options, data, ext = {
    is_https: true
}) {
    let httpReq = https;
    // 判断是否需要https请求
    if (!ext.is_https) {
        httpReq = http;
    }
    return new Promise((resolve, reject) => {
        // 如果请求方法是DELETE 并且有body，需要设置Content-Length
        if (options.method.toUpperCase() === 'DELETE' && data) {
            options.headers['Content-Length'] = preload.buffer.byteLength(data);
        }
        const req = httpReq.request({...options, timeout: 5000}, (res) => {
            const charset = getCharset(res.headers['content-type']);
            const chunks = [];
            const responseHeaders = res.headers;

            res.on('data', (chunk) => {
                chunks.push(chunk);
            });

            res.on('end', () => {
                const buffer = preload.buffer.concat(chunks);
                let responseData;

                if (charset && charset.toLowerCase() !== 'utf-8') {
                    responseData = preload.string2UTF8(buffer, charset, 'utf-8');
                } else {
                    responseData = buffer.toString('utf8');
                }

                if (responseHeaders['content-type'] && responseHeaders['content-type'].includes('json')) {
                    responseData = JSON.parse(responseData);
                }
                resolve({
                    data: responseData,
                    headers: responseHeaders,
                    statusCode: res.statusCode
                });
            });
        });
        req.on('error', (e) => {
            reject(e);
        });
        req.on('timeout', () => {
            req.destroy()
            reject(new Error('Request timed out'));
        });
        if (data) {
            req.write(data);
        }
        req.end();
    });
}


export async function httpGet(url, header = {}) {
    return await httpMethod('GET', url, header);
}

export async function httpMethod(Method, url, header = {}, data = null) {
    const urlObj = new URL(url);
    const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: Method.toUpperCase(),
        headers: header
    };
    let ext = {is_https: false}
    // 判断是否使用https
    if (url.startsWith('https')) {
        ext.is_https = true
    }
    // 如果data是对象，转为json字符串
    if (typeof data === 'object') {
        data = JSON.stringify(data);
    }
    return await httpsRequest(options, data, true, ext);
}


export async function httpPost(url, data, header = {}) {
    return await httpMethod('POST', url, header, data);
}