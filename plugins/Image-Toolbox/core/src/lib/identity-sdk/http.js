/**
 * Teaven Identity SDK HTTP 请求适配器
 */
/**
 * 默认的请求适配器，基于浏览器 fetch API
 */
export const defaultRequestAdapter = async (input) => {
    const response = await fetch(input.url, {
        method: input.method,
        headers: input.headers,
        body: input.body,
        signal: input.signal,
    });
    const text = await response.text();
    let body = null;
    if (text) {
        try {
            body = JSON.parse(text);
        }
        catch {
            body = text;
        }
    }
    const headers = {};
    response.headers.forEach((value, key) => {
        headers[key] = value;
    });
    return { status: response.status, headers, body };
};
