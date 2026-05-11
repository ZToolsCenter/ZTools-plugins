/**
 * 加密工具类 (基于 Web Crypto API)
 * 提供主密码派生、数据加解密及安全存储集成
 */

const PBKDF2_ITERATIONS = 600000; // OWASP 2023 推荐值
const SALT_SIZE = 16;
const IV_SIZE = 12;

/**
 * 将二进制数据转换为 Base64 字符串
 */
function bufferToBase64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * 将 Base64 字符串转换为二进制数据
 */
function base64ToBuffer(base64: string): Uint8Array {
    return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

/**
 * 从主密码派生 CryptoKey
 */
export async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const passwordKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );

    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt.slice(),
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256'
        },
        passwordKey,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
}

/**
 * 加密数据 (AES-GCM)
 * 返回格式: IV(Base64):Ciphertext(Base64)
 */
export async function encryptSecret(plaintext: string, key: CryptoKey): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_SIZE));
    const encoder = new TextEncoder();
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv.slice() },
        key,
        encoder.encode(plaintext)
    );

    return bufferToBase64(iv.buffer as ArrayBuffer) + ":" + bufferToBase64(encrypted);
}

/**
 * 解密数据 (AES-GCM)
 */
export async function decryptSecret(combined: string, key: CryptoKey): Promise<string> {
    const parts = combined.split(':');
    if (parts.length !== 2) throw new Error('Invalid encrypted format');

    const iv = base64ToBuffer(parts[0]);
    const ciphertext = base64ToBuffer(parts[1]);

    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv.slice() },
        key,
        ciphertext.slice()
    );

    return new TextDecoder().decode(decrypted);
}

/**
 * 获取随机盐值 (用于初始化)
 */
export function generateSalt(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(SALT_SIZE));
}

/**
 * 导出/导入密钥数据 (用于 safeStorage 托管)
 */
export async function exportKey(key: CryptoKey): Promise<string> {
    const buf = await crypto.subtle.exportKey('raw', key);
    return bufferToBase64(buf);
}

export async function importKeyFromRaw(rawBase64: string): Promise<CryptoKey> {
    const buf = base64ToBuffer(rawBase64);
    return crypto.subtle.importKey(
        'raw',
        buf.slice(),
        'AES-GCM',
        true,
        ['encrypt', 'decrypt']
    );
}

/**
 * 计算密钥的哈希值，用于跨设备同步时的密码验证
 * 不依赖硬件，仅依赖 masterKey (即 masterPassword + salt)
 */
export async function hashVerifier(rawBase64: string): Promise<string> {
    const buf = base64ToBuffer(rawBase64);
    // 使用 slice() 确保传递的是标准 Uint8Array/ArrayBufferView，解决 SharedArrayBuffer 报错
    const hash = await crypto.subtle.digest('SHA-256', buf.slice());
    return bufferToBase64(hash);
}
