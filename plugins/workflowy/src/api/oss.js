const crypto = require('crypto');
const http = require('http');
const https = require('https');

const DEFAULT_OSS_REGION = 'oss-cn-hangzhou';
const DEFAULT_OSS_ENDPOINT = 'oss-cn-hangzhou.aliyuncs.com';
const DEFAULT_OSS_PATH_PREFIX = 'workflowy-images/';
const DEFAULT_OSS_IMAGE_TAG = 'img';
const DEFAULT_UPLOAD_TIMEOUT_MS = 20000;
const DEFAULT_UPLOAD_RETRIES = 3;

const trimString = (value) => String(value || '').trim();

const normalizeEndpoint = (value) => trimString(value)
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/g, '');

const normalizeRegion = (value) => trimString(value)
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/g, '')
    .replace(/\.aliyuncs\.com$/i, '');

const normalizeCustomDomain = (value) => trimString(value)
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/g, '');

const normalizePathPrefix = (value) => {
    const normalized = trimString(value)
        .replace(/^\/+/g, '')
        .replace(/\/+$/g, '');
    return normalized ? `${normalized}/` : '';
};

const normalizeTagName = (value) => trimString(value).replace(/^#+/g, '');

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildOssEndpointFromRegion = (region) => {
    const normalized = normalizeRegion(region);
    return normalized ? `${normalized}.aliyuncs.com` : '';
};

const inferOssRegionFromEndpoint = (endpoint, bucket = '') => {
    const normalizedEndpoint = normalizeEndpoint(endpoint);
    if (!normalizedEndpoint) return '';

    const directMatch = normalizedEndpoint.match(/^(oss-[a-z0-9-]+)\.aliyuncs\.com$/i);
    if (directMatch) return directMatch[1];

    const normalizedBucket = trimString(bucket);
    if (normalizedBucket) {
        const bucketScopedMatch = normalizedEndpoint.match(new RegExp(`^${escapeRegex(normalizedBucket)}\\.(oss-[a-z0-9-]+)\\.aliyuncs\\.com$`, 'i'));
        if (bucketScopedMatch) return bucketScopedMatch[1];
    }

    return '';
};

const normalizeOssSettings = (settings = {}) => {
    const ossBucket = trimString(settings.ossBucket);
    const rawEndpoint = normalizeEndpoint(settings.ossEndpoint);
    const ossRegion = normalizeRegion(settings.ossRegion || inferOssRegionFromEndpoint(rawEndpoint, ossBucket));
    const endpointLooksLikeBucketHost = !!(
        rawEndpoint
        && ossBucket
        && rawEndpoint.toLowerCase().startsWith(`${ossBucket.toLowerCase()}.`)
    );
    const ossEndpoint = endpointLooksLikeBucketHost
        ? buildOssEndpointFromRegion(ossRegion)
        : (rawEndpoint || buildOssEndpointFromRegion(ossRegion));

    return {
        ossEnabled: !!settings.ossEnabled,
        ossRegion,
        ossEndpoint,
        ossBucket,
        ossAccessKeyId: trimString(settings.ossAccessKeyId),
        ossAccessKeySecret: trimString(settings.ossAccessKeySecret),
        ossPathPrefix: normalizePathPrefix(settings.ossPathPrefix || DEFAULT_OSS_PATH_PREFIX),
        ossCustomDomain: normalizeCustomDomain(settings.ossCustomDomain),
        ossImageTagEnabled: settings.ossImageTagEnabled !== false,
        ossImageTag: normalizeTagName(settings.ossImageTag || DEFAULT_OSS_IMAGE_TAG)
    };
};

const getMissingOssFields = (settings = {}) => {
    const normalized = normalizeOssSettings(settings);
    const missing = [];
    if (!normalized.ossBucket) missing.push('Bucket');
    if (!normalized.ossEndpoint) missing.push('地区');
    if (!normalized.ossAccessKeyId) missing.push('AccessKey ID');
    if (!normalized.ossAccessKeySecret) missing.push('AccessKey Secret');
    return missing;
};

const isOssConfigured = (settings = {}) => getMissingOssFields(settings).length === 0;

const formatDatePath = (date = new Date()) => {
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
};

const createObjectId = () => {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return crypto.randomBytes(16).toString('hex');
};

const sanitizeExtension = (extension = 'jpg') => trimString(extension)
    .replace(/^\./, '')
    .toLowerCase() || 'jpg';

const buildOssObjectKey = ({
    pathPrefix = DEFAULT_OSS_PATH_PREFIX,
    date = new Date(),
    extension = 'jpg',
    objectId
} = {}) => {
    const prefix = normalizePathPrefix(pathPrefix || DEFAULT_OSS_PATH_PREFIX);
    const id = trimString(objectId) || createObjectId();
    const ext = sanitizeExtension(extension);
    return `${prefix}${formatDatePath(date)}/${id}.${ext}`;
};

const buildOssResource = (bucket, objectKey) => `/${bucket}/${objectKey}`;

const canonicalizeOssHeaders = (headers = {}) => Object.keys(headers)
    .filter(key => /^x-oss-/i.test(key))
    .sort((left, right) => left.localeCompare(right))
    .map(key => `${key.toLowerCase()}:${String(headers[key]).trim()}`)
    .join('\n');

const buildStringToSign = ({
    method,
    contentMd5 = '',
    contentType = '',
    date,
    resource,
    headers = {}
}) => {
    const canonicalHeaders = canonicalizeOssHeaders(headers);
    return [
        String(method || 'PUT').toUpperCase(),
        contentMd5,
        contentType,
        date,
        canonicalHeaders ? `${canonicalHeaders}\n${resource}` : resource
    ].join('\n');
};

const buildOssFetchUrl = (settings = {}, objectKey) => {
    const normalized = normalizeOssSettings(settings);
    return `https://${normalized.ossBucket}.${normalized.ossEndpoint}/${objectKey}`;
};

const buildOssDefaultPublicHost = (settings = {}) => {
    const normalized = normalizeOssSettings(settings);
    if (!normalized.ossBucket || !normalized.ossEndpoint) return '';
    return `${normalized.ossBucket}.${normalized.ossEndpoint}`;
};

const buildOssPublicUrl = (settings = {}, objectKey) => {
    const normalized = normalizeOssSettings(settings);
    if (normalized.ossCustomDomain) {
        return `https://${normalized.ossCustomDomain}/${objectKey}`;
    }
    return buildOssFetchUrl(normalized, objectKey);
};

const signOssRequest = ({
    settings = {},
    method = 'PUT',
    objectKey,
    contentType = '',
    date = new Date().toUTCString(),
    headers = {}
}) => {
    const normalized = normalizeOssSettings(settings);
    if (!isOssConfigured(normalized)) {
        throw new Error(`OSS 配置不完整：${getMissingOssFields(normalized).join(' / ')}`);
    }

    const resource = buildOssResource(normalized.ossBucket, objectKey);
    const stringToSign = buildStringToSign({
        method,
        contentType,
        date,
        resource,
        headers
    });
    const signature = crypto
        .createHmac('sha1', normalized.ossAccessKeySecret)
        .update(stringToSign)
        .digest('base64');

    return {
        url: buildOssFetchUrl(normalized, objectKey),
        date,
        resource,
        stringToSign,
        authorization: `OSS ${normalized.ossAccessKeyId}:${signature}`
    };
};

const createAbortError = () => {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    return error;
};

const createTimeoutError = () => {
    const error = new Error('OSS 请求超时，请稍后重试');
    error.name = 'TimeoutError';
    return error;
};

const nodeRequest = (url, options = {}) => new Promise((resolve, reject) => {
    const requestUrl = new URL(url);
    const transport = requestUrl.protocol === 'http:' ? http : https;
    const req = transport.request({
        protocol: requestUrl.protocol,
        hostname: requestUrl.hostname,
        port: requestUrl.port || undefined,
        path: `${requestUrl.pathname}${requestUrl.search || ''}`,
        method: options.method || 'GET',
        headers: options.headers || {}
    }, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
            const body = Buffer.concat(chunks);
            const textBody = body.toString('utf8');
            resolve({
                ok: res.statusCode >= 200 && res.statusCode < 300,
                status: res.statusCode || 0,
                headers: res.headers || {},
                text: async () => textBody
            });
        });
    });

    let settled = false;
    const finishReject = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
    };

    req.on('error', finishReject);
    req.setTimeout(options.timeoutMs || DEFAULT_UPLOAD_TIMEOUT_MS, () => {
        req.destroy(createTimeoutError());
    });

    if (options.signal?.addEventListener) {
        const onAbort = () => req.destroy(createAbortError());
        if (options.signal.aborted) {
            onAbort();
        } else {
            options.signal.addEventListener('abort', onAbort, { once: true });
            req.on('close', () => options.signal.removeEventListener?.('abort', onAbort));
        }
    }

    if (options.body?.length) req.write(options.body);
    req.end();
});

const shouldRetry = ({ attempt, maxRetries, status, error }) => {
    if (attempt >= maxRetries - 1) return false;
    if (error && error.name === 'AbortError') return false;
    if (error) return true;
    return status >= 500;
};

const parseOssErrorMessage = async (response) => {
    const text = await response.text();
    if (!text) return `OSS 请求失败 (${response.status})`;

    const codeMatch = text.match(/<Code>([^<]+)<\/Code>/i);
    const messageMatch = text.match(/<Message>([^<]+)<\/Message>/i);
    if (codeMatch || messageMatch) {
        return [codeMatch?.[1], messageMatch?.[1]].filter(Boolean).join(': ');
    }
    return text;
};

const uploadBufferToOss = async (settings, file, options = {}) => {
    const normalized = normalizeOssSettings(settings);
    if (!isOssConfigured(normalized)) {
        throw new Error(`OSS 配置不完整：${getMissingOssFields(normalized).join(' / ')}`);
    }
    if (!file?.buffer) {
        throw new Error('当前环境无法上传文件');
    }

    const objectKey = file.objectKey || buildOssObjectKey({
        pathPrefix: normalized.ossPathPrefix,
        date: options.date,
        extension: file.extension
    });
    const contentType = file.contentType || 'application/octet-stream';
    const retries = Number.isFinite(options.retries) ? options.retries : DEFAULT_UPLOAD_RETRIES;
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_UPLOAD_TIMEOUT_MS;

    for (let attempt = 0; attempt < retries; attempt += 1) {
        const signed = signOssRequest({
            settings: normalized,
            method: 'PUT',
            objectKey,
            contentType
        });

        try {
            const response = await nodeRequest(signed.url, {
                method: 'PUT',
                headers: {
                    'Content-Type': contentType,
                    'Content-Length': String(file.buffer.length),
                    Date: signed.date,
                    Authorization: signed.authorization
                },
                body: file.buffer,
                timeoutMs,
                signal: options.signal
            });

            if (response.ok) {
                const verifySigned = signOssRequest({
                    settings: normalized,
                    method: 'HEAD',
                    objectKey
                });
                const verifyResponse = await nodeRequest(verifySigned.url, {
                    method: 'HEAD',
                    headers: {
                        Date: verifySigned.date,
                        Authorization: verifySigned.authorization
                    },
                    timeoutMs,
                    signal: options.signal
                });

                if (!verifyResponse.ok) {
                    throw new Error(await parseOssErrorMessage(verifyResponse));
                }

                return {
                    objectKey,
                    url: buildOssPublicUrl(normalized, objectKey),
                    contentType,
                    size: file.buffer.length
                };
            }

            const message = await parseOssErrorMessage(response);
            if (!shouldRetry({ attempt, maxRetries: retries, status: response.status })) {
                throw new Error(message);
            }
        } catch (error) {
            if (!shouldRetry({ attempt, maxRetries: retries, error })) {
                throw error;
            }
        }

        await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
    }

    throw new Error('文件上传失败，请稍后重试');
};

const deleteObjectFromOss = async (settings, objectKey, options = {}) => {
    const normalized = normalizeOssSettings(settings);
    if (!isOssConfigured(normalized)) {
        throw new Error(`OSS 配置不完整：${getMissingOssFields(normalized).join(' / ')}`);
    }
    if (!objectKey) {
        throw new Error('当前环境无法删除文件');
    }

    const signed = signOssRequest({
        settings: normalized,
        method: 'DELETE',
        objectKey
    });

    const response = await nodeRequest(signed.url, {
        method: 'DELETE',
        headers: {
            Date: signed.date,
            Authorization: signed.authorization
        },
        timeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_UPLOAD_TIMEOUT_MS,
        signal: options.signal
    });

    if (response.ok) return true;
    throw new Error(await parseOssErrorMessage(response));
};

module.exports = {
    DEFAULT_OSS_REGION,
    DEFAULT_OSS_ENDPOINT,
    DEFAULT_OSS_PATH_PREFIX,
    DEFAULT_OSS_IMAGE_TAG,
    buildOssDefaultPublicHost,
    buildOssEndpointFromRegion,
    normalizeOssSettings,
    inferOssRegionFromEndpoint,
    getMissingOssFields,
    isOssConfigured,
    buildOssObjectKey,
    buildOssPublicUrl,
    buildStringToSign,
    signOssRequest,
    uploadBufferToOss,
    deleteObjectFromOss
};
