/**
 * CryptoUtils - 加密工具函数
 *
 * 提供 SHA-256、HMAC-SHA256、AWS Signature V4 等通用加密操作。
 * 使用浏览器 Web Crypto API，不依赖任何平台 SDK。
 */

class CryptoUtils {
  /**
   * 计算 SHA-256 哈希（十六进制字符串）
   * @param {string|Uint8Array} message
   * @returns {Promise<string>}
   */
  static async hash256(message) {
    let msgBuffer;
    if (typeof message === 'string') {
      msgBuffer = new TextEncoder().encode(message);
    } else {
      msgBuffer = message;
    }
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * 计算 HMAC-SHA256（十六进制字符串）
   * @param {string} key - 密钥（字符串形式，UTF-8 编码）
   * @param {string} message - 消息
   * @returns {Promise<string>}
   */
  static async hmacSha256(key, message) {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(key),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign(
      'HMAC',
      cryptoKey,
      new TextEncoder().encode(message)
    );
    return Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * 获取 AWS Signature V4 签名密钥
   * @param {string} secretKey - AWS Secret Access Key
   * @param {string} dateStamp - 日期（YYYYMMDD）
   * @param {string} region - 区域
   * @param {string} service - 服务名（如 s3）
   * @returns {Promise<string>}
   */
  static async getSignatureKey(secretKey, dateStamp, region, service) {
    const kDate = await CryptoUtils.hmacSha256('AWS4' + secretKey, dateStamp);
    const kRegion = await CryptoUtils.hmacSha256(kDate, region);
    const kService = await CryptoUtils.hmacSha256(kRegion, service);
    const kSigning = await CryptoUtils.hmacSha256(kService, 'aws4_request');
    return kSigning;
  }

  /**
   * 生成 UUID v4
   * @returns {string}
   */
  static generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * 格式化日期为 AWS amzDate 格式
   * @param {Date} date
   * @returns {string}
   */
  static formatAmzDate(date) {
    const dateStr = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
    return dateStr.substr(0, 8) + 'T' + dateStr.substr(9, 6) + 'Z';
  }

  /**
   * 生成 AWS Signature V4 Authorization 头
   * @param {object} config - S3 配置
   * @param {string} config.s3Endpoint - S3 端点
   * @param {string} config.s3AccessKey - Access Key
   * @param {string} config.s3SecretKey - Secret Key
   * @param {string} config.s3Region - 区域
   * @param {string} fileName - 对象路径
   * @param {Uint8Array} fileData - 文件数据
   * @param {string} contentType - MIME 类型
   * @param {Date} [date] - 签名日期，默认当前时间
   * @returns {Promise<string>}
   */
  static async generateS3AuthHeader(config, fileName, fileData, contentType, date = new Date()) {
    const host = config.s3Endpoint.replace(/^https?:\/\//, '');
    const region = config.s3Region || 'us-east-1';

    const dateStr = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = dateStr.substr(0, 8);
    const amzDate = dateStamp + 'T' + dateStr.substr(9, 6) + 'Z';

    const payloadHash = await CryptoUtils.hash256(fileData);

    const canonicalUri = '/' + fileName;
    const canonicalQuerystring = '';
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

    const canonicalRequest = [
      'PUT',
      canonicalUri,
      canonicalQuerystring,
      canonicalHeaders,
      signedHeaders,
      payloadHash
    ].join('\n');

    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = [
      algorithm,
      amzDate,
      credentialScope,
      await CryptoUtils.hash256(canonicalRequest)
    ].join('\n');

    const signingKey = await CryptoUtils.getSignatureKey(
      config.s3SecretKey,
      dateStamp,
      region,
      's3'
    );
    const signature = await CryptoUtils.hmacSha256(signingKey, stringToSign);

    return `${algorithm} Credential=${config.s3AccessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CryptoUtils;
}
