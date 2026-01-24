/**
 * 火山引擎API签名工具类
 * 实现火山引擎的HMAC-SHA256签名算法
 */
class VolcengineSigner {
    constructor(accessKey, secretKey, region = 'cn-beijing', service = 'ark') {
        this.accessKey = accessKey;
        this.secretKey = secretKey;
        this.region = region;
        this.service = service;
    }

    /**
     * 生成签名的主方法
     * @param {string} method HTTP方法
     * @param {string} url 请求URL
     * @param {Object} headers 请求头
     * @param {string} body 请求体
     * @returns {Object} 包含签名信息的对象
     */
    async sign(method, url, headers = {}, body = '') {
        // 使用请求头中已设置的时间戳，确保一致性
        const dateTime = headers['x-date'] || this.formatDateTime(new Date());
        const date = dateTime.split('T')[0];

        // 使用请求头中已计算的body hash，确保一致性
        const bodyHash = headers['x-content-sha256'] || await this.sha256(body);

        // 构建规范请求
        const canonicalRequest = this.buildCanonicalRequest(method, url, headers, bodyHash);

        // 构建签名字符串
        const credentialScope = `${date}/${this.region}/${this.service}/request`;
        const stringToSign = await this.buildStringToSign(dateTime, credentialScope, canonicalRequest);

        // 计算签名
        const signature = await this.calculateSignature(date, stringToSign);

        // 构建Authorization头
        const signedHeaders = this.getSignedHeaders(headers);
        const authorization = `HMAC-SHA256 Credential=${this.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

        return {
            authorization,
            dateTime,
            bodyHash,
            signedHeaders
        };
    }

    /**
     * 格式化日期时间为ISO8601格式
     */
    formatDateTime(date) {
        return date.toISOString().replace(/[:\-]|\.\d{3}/g, '');
    }

    /**
     * 计算SHA256哈希
     */
    async sha256(data) {
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(data);
        const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * 计算HMAC-SHA256
     */
    async hmacSha256(key, data) {
        const encoder = new TextEncoder();
        let keyBuffer;
        
        if (typeof key === 'string') {
            keyBuffer = encoder.encode(key);
        } else {
            keyBuffer = key;
        }

        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            keyBuffer,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );

        const dataBuffer = encoder.encode(data);
        const signature = await crypto.subtle.sign('HMAC', cryptoKey, dataBuffer);
        return new Uint8Array(signature);
    }

    /**
     * 构建规范请求字符串
     */
    buildCanonicalRequest(method, url, headers, bodyHash) {
        const urlObj = new URL(url);
        const canonicalUri = urlObj.pathname || '/';
        const canonicalQueryString = this.buildCanonicalQueryString(urlObj.searchParams);
        const canonicalHeaders = this.buildCanonicalHeaders(headers);
        const signedHeaders = this.getSignedHeaders(headers);

        // 按照AWS Signature V4标准格式构建规范请求
        return [
            method.toUpperCase(),
            canonicalUri,
            canonicalQueryString,
            canonicalHeaders,
            signedHeaders,
            bodyHash
        ].join('\n');
    }

    /**
     * 构建规范查询字符串
     */
    buildCanonicalQueryString(searchParams) {
        const params = [];
        for (const [key, value] of searchParams.entries()) {
            // 使用RFC 3986编码
            const encodedKey = this.uriEncode(key);
            const encodedValue = this.uriEncode(value);
            params.push(`${encodedKey}=${encodedValue}`);
        }
        return params.sort().join('&');
    }

    /**
     * RFC 3986 URI编码
     */
    uriEncode(str) {
        return encodeURIComponent(str)
            .replace(/[!'()*]/g, function(c) {
                return '%' + c.charCodeAt(0).toString(16).toUpperCase();
            });
    }

    /**
     * 构建规范请求头
     */
    buildCanonicalHeaders(headers) {
        const canonicalHeaders = [];
        const sortedHeaders = Object.keys(headers).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

        for (const key of sortedHeaders) {
            const value = headers[key];
            // 规范化请求头：小写键名，去除值的前后空格，压缩内部空格
            canonicalHeaders.push(`${key.toLowerCase()}:${value.toString().trim().replace(/\s+/g, ' ')}`);
        }

        // 规范请求头以换行符结尾
        return canonicalHeaders.join('\n') + '\n';
    }

    /**
     * 获取已签名的请求头列表
     */
    getSignedHeaders(headers) {
        return Object.keys(headers)
            .map(key => key.toLowerCase())
            .sort()
            .join(';');
    }

    /**
     * 构建签名字符串
     */
    async buildStringToSign(dateTime, credentialScope, canonicalRequest) {
        const canonicalRequestHash = await this.sha256(canonicalRequest);
        return [
            'HMAC-SHA256',
            dateTime,
            credentialScope,
            canonicalRequestHash
        ].join('\n');
    }

    /**
     * 计算最终签名
     */
    async calculateSignature(date, stringToSign) {
        // 按照AWS Signature V4标准计算签名密钥
        const kDate = await this.hmacSha256(this.secretKey, date);
        const kRegion = await this.hmacSha256(kDate, this.region);
        const kService = await this.hmacSha256(kRegion, this.service);
        const kSigning = await this.hmacSha256(kService, 'request');
        const signature = await this.hmacSha256(kSigning, stringToSign);

        return Array.from(signature).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * 为火山引擎API请求添加必要的请求头
     */
    buildHeaders(method, url, body = '', customHeaders = {}) {
        const urlObj = new URL(url);
        const headers = {
            'content-type': 'application/json',
            'host': urlObj.host,
            ...customHeaders
        };

        return headers;
    }
}

// 导出类
if (typeof module !== 'undefined' && module.exports) {
    module.exports = VolcengineSigner;
} else if (typeof window !== 'undefined') {
    window.VolcengineSigner = VolcengineSigner;
}
