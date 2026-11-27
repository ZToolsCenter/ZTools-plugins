const crypto = require('crypto');

/**
 * PBKDF2 派生主密钥
 * @param {string} pin 用户输入的 PIN 或主密码
 * @param {string} saltHex 16进制盐字符串
 * @param {number} iterations 迭代次数，默认 100,000
 * @returns {Buffer} 32 字节 masterKey
 */
function deriveMasterKey(pin, saltHex, iterations = 100000) {
  if (!pin || typeof pin !== 'string') {
    throw new Error('PIN 码不能为空且必须是字符串');
  }
  if (!saltHex || typeof saltHex !== 'string') {
    throw new Error('Salt 不能为空且必须是十六进制字符串');
  }
  const salt = Buffer.from(saltHex, 'hex');
  return crypto.pbkdf2Sync(pin, salt, iterations, 32, 'sha256');
}

/**
 * 生成 32 字节随机盐
 * @returns {string} 64 位十六进制字符串
 */
function generateSalt() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * AES-256-GCM 加密明文
 * @param {Buffer} masterKey 32 字节 Buffer
 * @param {string} plainText 明文字符串
 * @returns {{ iv: string, tag: string, data: string }} 十六进制编码的对象
 */
function encrypt(masterKey, plainText) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
    throw new Error('非法的 MasterKey，必须为 32 字节 Buffer');
  }
  const iv = crypto.randomBytes(12); // 96-bit IV 推荐用于 GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
  
  const encrypted = Buffer.concat([
    cipher.update(String(plainText), 'utf8'),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: encrypted.toString('hex')
  };
}

/**
 * AES-256-GCM 解密密文
 * @param {Buffer} masterKey 32 字节 Buffer
 * @param {{ iv: string, tag: string, data: string }} cipherObj
 * @returns {string} 解密后的明文字符串
 */
function decrypt(masterKey, cipherObj) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
    throw new Error('非法的 MasterKey，必须为 32 字节 Buffer');
  }
  if (!cipherObj || !cipherObj.iv || !cipherObj.tag || cipherObj.data === undefined) {
    throw new Error('密文对象格式不正确');
  }

  const iv = Buffer.from(cipherObj.iv, 'hex');
  const tag = Buffer.from(cipherObj.tag, 'hex');
  const encrypted = Buffer.from(cipherObj.data, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]);

  return decrypted.toString('utf8');
}

module.exports = {
  deriveMasterKey,
  generateSalt,
  encrypt,
  decrypt
};
