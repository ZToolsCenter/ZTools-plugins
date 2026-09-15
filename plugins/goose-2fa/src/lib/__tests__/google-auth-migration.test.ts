import { describe, expect, it } from "vitest";
import { parseGoogleAuthMigrationPayload } from "../google-auth-migration";

function migrationUri(bytes: number[]): string {
  const data = btoa(String.fromCharCode(...bytes));
  return `otpauth-migration://offline?data=${encodeURIComponent(data)}`;
}

describe("Google Authenticator 迁移数据", () => {
  it("拒绝未结束的 varint", () => {
    expect(parseGoogleAuthMigrationPayload(migrationUri([0x80]))).toBeNull();
  });

  it("拒绝长度超过剩余数据的字段", () => {
    // field 1 / wire type 2，声明 5 字节但只提供 1 字节。
    expect(parseGoogleAuthMigrationPayload(migrationUri([0x0a, 0x05, 0x01]))).toBeNull();
  });
});
