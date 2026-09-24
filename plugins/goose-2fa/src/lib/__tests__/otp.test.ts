import { describe, it, expect } from "vitest";
import { formatCode, generateHOTP, parseOtpAuthUri } from "../otp";

function toBase32(text: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of new TextEncoder().encode(text)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += alphabet[(value >> bits) & 31];
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

describe("formatCode", () => {
  it("应该将 6 位验证码格式化为 3+3", () => {
    expect(formatCode("123456")).toBe("123 456");
  });

  it("应该将 8 位验证码格式化为 4+4", () => {
    expect(formatCode("12345678")).toBe("1234 5678");
  });

  it("其他长度的验证码保持不变", () => {
    expect(formatCode("12345")).toBe("12345");
    expect(formatCode("1234567")).toBe("1234567");
    expect(formatCode("")).toBe("");
  });
});

describe("OTP RFC 向量", () => {
  it("符合 RFC 4226 HOTP SHA-1 向量", async () => {
    const secret = toBase32("12345678901234567890");
    await expect(generateHOTP(secret, 0, 6, "SHA-1")).resolves.toBe("755224");
    await expect(generateHOTP(secret, 1, 6, "SHA-1")).resolves.toBe("287082");
    await expect(generateHOTP(secret, 9, 6, "SHA-1")).resolves.toBe("520489");
  });

  it.each([
    ["SHA-1", "12345678901234567890", "94287082"],
    ["SHA-256", "12345678901234567890123456789012", "46119246"],
    ["SHA-512", "1234567890123456789012345678901234567890123456789012345678901234", "90693936"],
  ] as const)("符合 RFC 6238 %s 向量", async (algorithm, rawSecret, expected) => {
    await expect(generateHOTP(toBase32(rawSecret), 1, 8, algorithm)).resolves.toBe(expected);
  });

  it("拒绝非法密钥和危险参数", async () => {
    await expect(generateHOTP("JBSWY3DP!EHPK3PXP", 0)).rejects.toThrow();
    await expect(generateHOTP("JBSWY3DPEHPK3PXP", -1)).rejects.toThrow();
    await expect(generateHOTP("JBSWY3DPEHPK3PXP", 0, 9)).rejects.toThrow();
    expect(parseOtpAuthUri("otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&digits=999")).toBeNull();
    expect(parseOtpAuthUri("otpauth://hotp/Test?secret=JBSWY3DPEHPK3PXP&counter=-1")).toBeNull();
  });
});
