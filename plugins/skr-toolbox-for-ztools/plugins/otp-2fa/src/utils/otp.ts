/**
 * TOTP/HOTP 算法实现工具类 (基于 Web Crypto API)
 */

// Base32 字符表
const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * 将 Base32 编码的密钥转换为 Uint8Array
 */
export function base32ToBuf(base32: string): Uint8Array {
    base32 = base32.toUpperCase().replace(/\s/g, "").replace(/=+$/, "");
    const len = base32.length;
    const buf = new Uint8Array(((len * 5) / 8) | 0);
    let v = 0, bits = 0, idx = 0;
    for (let i = 0; i < len; i++) {
        const val = BASE32_CHARS.indexOf(base32[i]);
        if (val === -1) continue;
        v = (v << 5) | val;
        bits += 5;
        if (bits >= 8) {
            buf[idx++] = (v >> (bits - 8)) & 0xff;
            bits -= 8;
        }
    }
    return buf;
}

/**
 * 将十六进制字符串转换为 Uint8Array
 */
function hexToBuf(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return bytes;
}

/**
 * 获取 OTP 验证码 (异步)
 */
export async function getOTP(acc: any, isNext = false): Promise<string> {
    try {
        const { secret, type = 'totp', algorithm = 'SHA1', digits = 6, period = 30 } = acc;
        let counter = BigInt(acc.counter || 0) + BigInt(isNext && type === 'hotp' ? 1 : 0);

        // 计算计数器 (8 字节 Buffer)
        const counterBuf = new Uint8Array(8);
        let epoch = 0n;
        if (type === 'totp' || type === 'steam') {
            const step = BigInt(type === 'steam' ? 30 : period);
            epoch = BigInt(Math.floor(Date.now() / 1000.0)) + (isNext ? step : 0n);
            counter = epoch / step;
        }
        
        const dv = new DataView(counterBuf.buffer);
        dv.setBigUint64(0, counter, false); // Big-Endian

        // 映射算法名称
        const hashName = algorithm.replace('SHA', 'SHA-'); // SHA1 -> SHA-1, SHA256 -> SHA-256
        
        // 准备密钥
        const keyBuf = base32ToBuf(secret);
        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            keyBuf.buffer as ArrayBuffer,
            { name: 'HMAC', hash: hashName },
            false,
            ['sign']
        );

        // 生成 HMAC 签名
        const signature = await crypto.subtle.sign('HMAC', cryptoKey, counterBuf);
        const hmac = new Uint8Array(signature);

        // 动态截断
        const offset = hmac[hmac.length - 1] & 0xf;
        let binary = ((hmac[offset] & 0x7f) << 24) |
                     ((hmac[offset + 1] & 0xff) << 16) |
                     ((hmac[offset + 2] & 0xff) << 8) |
                     (hmac[offset + 3] & 0xff);

        // Steam 特殊编码
        if (type === 'steam') {
            const alphabet = "23456789BCDFGHJKMNPQRTVWXY";
            let code = "";
            for (let i = 0; i < 5; i++) {
                code += alphabet.charAt(Number(BigInt(binary) % 26n));
                binary = Math.floor(binary / 26);
            }
            return code;
        }

        // 标准 TOTP 格式化
        const otp = (BigInt(binary) % (10n ** BigInt(digits))).toString();
        return otp.padStart(digits, '0');
    } catch (e) {
        console.error('OTP Calculation Error:', e);
        return "Error";
    }
}

/**
 * 保持 base32tohex 导出兼容性 (某些 UI 可能还在用)
 */
export function base32tohex(base32: string): string {
    const buf = base32ToBuf(base32);
    return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}
