import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSafeVault, searchSafeAccounts, summarizeVault } from "../vault";

const directories: string[] = [];

function createBackup(content: unknown) {
  const directory = mkdtempSync(join(tmpdir(), "goose-2fa-mcp-"));
  directories.push(directory);
  const backupPath = join(directory, "backup.json");
  writeFileSync(backupPath, JSON.stringify(content), "utf8");
  return backupPath;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("MCP 安全保险库读取", () => {
  it("只返回脱敏元数据，不泄露种子", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const vault = loadSafeVault(createBackup({
      app: "goose-2fa",
      accounts: [{ name: "alice@example.com", issuer: "GitHub", secret, type: "totp", digits: 6, period: 30, counter: 0, algorithm: "SHA-1", note: "个人" }],
      groups: [{ id: "work", name: "工作", order: 0, createdAt: 1 }],
    }));

    expect(vault.accounts).toEqual([expect.objectContaining({ name: "alice@example.com", issuer: "GitHub", hasNote: true })]);
    expect(JSON.stringify(vault)).not.toContain(secret);
    expect(JSON.stringify(vault)).not.toContain("otpauth://");
  });

  it("汇总与检索均受限且不包含密钥字段", () => {
    const vault = loadSafeVault(createBackup({
      app: "goose-2fa",
      accounts: [
        { name: "alice@example.com", issuer: "GitHub", secret: "JBSWY3DPEHPK3PXP", type: "totp", digits: 6, period: 30, counter: 0, algorithm: "SHA-1" },
        { name: "build", issuer: "GitLab", secret: "GEZDGNBVGY3TQOJQ", type: "hotp", digits: 6, period: 30, counter: 2, algorithm: "SHA-1" },
      ],
      groups: [],
    }));

    expect(summarizeVault(vault)).toMatchObject({ accountCount: 2, totpCount: 1, hotpCount: 1 });
    expect(searchSafeAccounts(vault, "git", 1)).toHaveLength(1);
    expect(searchSafeAccounts(vault, "", 999)).toHaveLength(2);
    expect(searchSafeAccounts(vault, "git", 1)[0]).not.toHaveProperty("secret");
  });

  it("未配置文件时拒绝读取", () => {
    expect(() => loadSafeVault(undefined)).toThrow("GOOSE_2FA_MCP_BACKUP_PATH");
  });

  it("脱敏元数据中误填的 URI、种子和动态码", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const vault = loadSafeVault(createBackup({
      app: "goose-2fa",
      accounts: [{
        name: `otpauth://totp/example?secret=${secret}`,
        issuer: `issuer-${secret}-123456`,
        secret,
        type: "totp",
        digits: 6,
        period: 30,
        counter: 0,
        algorithm: "SHA-1",
        groupId: "group-1",
      }],
      groups: [{ id: "group-1", name: `group-${secret}-654321`, order: 0, createdAt: 1 }],
    }));

    const serialized = JSON.stringify(vault);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("otpauth://");
    expect(serialized).not.toContain("123456");
    expect(serialized).not.toContain("654321");
  });

  it("拒绝过大的备份，且限制摘要分组明细", () => {
    const tooLarge = createBackup("x".repeat(5 * 1024 * 1024));
    expect(() => loadSafeVault(tooLarge)).toThrow("无法读取配置的 2FA 备份文件");

    const vault = {
      accounts: Array.from({ length: 51 }, (_, index) => ({
        name: `account-${index}`,
        issuer: "",
        type: "totp" as const,
        digits: 6,
        period: 30,
        algorithm: "SHA-1" as const,
        group: `group-${index}`,
        hasNote: false,
        hasRemark: false,
      })),
      groups: [],
    };
    const summary = summarizeVault(vault);
    expect(Object.keys(summary.accountsByGroup)).toHaveLength(50);
    expect(summary.omittedGroupAccounts).toBe(1);
  });
});
