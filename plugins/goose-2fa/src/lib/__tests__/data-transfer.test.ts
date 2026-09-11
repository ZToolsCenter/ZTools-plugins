import { describe, expect, it } from "vitest";
import { deduplicateImports, exportAsJson, parseImportBundle } from "../data-transfer";
import type { AccountData, NewAccountInput, VaultGroup } from "../types";

const input: NewAccountInput = {
  name: "alice@example.com",
  issuer: "GitHub",
  secret: "JBSWY3DPEHPK3PXP",
  type: "totp",
  digits: 6,
  period: 30,
  counter: 0,
  algorithm: "SHA-1",
  note: "工作账号",
  remark: "主账号",
  originalName: "GitHub (alice@example.com)",
  groupId: "work",
};

const account: AccountData = { ...input, id: "account-1", createdAt: 1 };
const groups: VaultGroup[] = [{ id: "work", name: "工作", order: 0, createdAt: 1 }];

describe("goose-2fa 备份", () => {
  it("完整恢复分组、备注和账户归属，并剔除设备元数据", () => {
    const exported = exportAsJson([{ ...account, meta: { location: { latitude: 1, longitude: 2 } } }], groups);
    expect(exported).not.toContain("latitude");
    const parsed = parseImportBundle(exported);
    expect(parsed?.groups).toEqual(groups);
    expect(parsed?.accounts).toEqual([input]);
  });

  it("兼容 v1 备份", () => {
    const parsed = parseImportBundle(JSON.stringify({ app: "goose-2fa", version: 1, accounts: [input] }));
    expect(parsed?.accounts).toEqual([input]);
    expect(parsed?.groups).toEqual([]);
  });
});

describe("导入去重", () => {
  it("同时去除已有重复和同一批内部重复", () => {
    const other = { ...input, name: "bob@example.com" };
    const result = deduplicateImports([input, input, other, other], [account]);
    expect(result.dupeCount).toBe(3);
    expect(result.newAccounts).toEqual([other]);
  });

  it("不会把同密钥但不同类型或账号名误判为重复", () => {
    const hotp = { ...input, type: "hotp" as const, counter: 2 };
    const renamed = { ...input, name: "bob@example.com" };
    expect(deduplicateImports([hotp, renamed], [account]).newAccounts).toEqual([hotp, renamed]);
  });
});
