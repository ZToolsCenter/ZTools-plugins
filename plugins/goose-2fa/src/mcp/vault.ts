import { readFileSync, statSync } from "node:fs";
import { parseImportBundle } from "../lib/data-transfer";
import type { NewAccountInput, VaultGroup } from "../lib/types";

export interface SafeAccountMetadata {
  name: string;
  issuer: string;
  type: "totp" | "hotp";
  digits: number;
  period: number;
  algorithm: "SHA-1" | "SHA-256" | "SHA-512";
  group: string | null;
  hasNote: boolean;
  hasRemark: boolean;
}

export interface SafeVault {
  accounts: SafeAccountMetadata[];
  groups: Array<{ name: string }>;
}

const OTP_AUTH_URI = /otpauth:\/\/\S+/giu;
const BASE32_SECRET = /(?<![a-z2-7])[a-z2-7]{8,}(?![a-z2-7])/giu;
const OTP_CODE = /(?<!\d)\d{6,8}(?!\d)/g;
const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
const MAX_SUMMARY_GROUPS = 50;

function redactSensitiveMetadata(value: string): string {
  return value
    .replace(OTP_AUTH_URI, "[已隐藏敏感 URI]")
    .replace(BASE32_SECRET, "[已隐藏种子]")
    .replace(OTP_CODE, "[已隐藏动态码]");
}

function toSafeAccount(account: NewAccountInput, groups: VaultGroup[]): SafeAccountMetadata {
  const group = account.groupId
    ? groups.find((candidate) => candidate.id === account.groupId)?.name ?? null
    : null;

  return {
    name: redactSensitiveMetadata(account.name),
    issuer: redactSensitiveMetadata(account.issuer),
    type: account.type,
    digits: account.digits,
    period: account.period,
    algorithm: account.algorithm,
    group: group ? redactSensitiveMetadata(group) : null,
    hasNote: Boolean(account.note),
    hasRemark: Boolean(account.remark),
  };
}

/**
 * 仅从用户显式配置的 goose-2fa 导出备份读取数据。
 * 永不返回种子、otpauth URI 或动态验证码。
 */
export function loadSafeVault(backupPath: string | undefined): SafeVault {
  if (!backupPath) {
    throw new Error("未配置 GOOSE_2FA_MCP_BACKUP_PATH；请先在鹅的验证中导出备份，再显式指定该文件路径。");
  }

  let text: string;
  try {
    const stats = statSync(backupPath);
    if (!stats.isFile() || stats.size > MAX_BACKUP_BYTES) throw new Error("invalid backup file");
    text = readFileSync(backupPath, "utf8");
  } catch {
    throw new Error("无法读取配置的 2FA 备份文件。请确认路径和读取权限。");
  }

  const bundle = parseImportBundle(text);
  if (!bundle) {
    throw new Error("备份格式无效或不包含有效账户。MCP 未读取或输出任何种子。");
  }

  return {
    accounts: bundle.accounts.map((account) => toSafeAccount(account, bundle.groups)),
    groups: bundle.groups.map(({ name }) => ({ name: redactSensitiveMetadata(name) })),
  };
}

export function summarizeVault(vault: SafeVault) {
  const byGroup = new Map<string, number>();
  for (const account of vault.accounts) {
    const group = account.group ?? "未分组";
    byGroup.set(group, (byGroup.get(group) ?? 0) + 1);
  }
  const sortedGroups = [...byGroup.entries()].sort(([, left], [, right]) => right - left);
  const visibleGroups = sortedGroups.slice(0, MAX_SUMMARY_GROUPS);
  const omittedAccounts = sortedGroups.slice(MAX_SUMMARY_GROUPS).reduce((total, [, count]) => total + count, 0);

  return {
    accountCount: vault.accounts.length,
    groupCount: vault.groups.length,
    accountsByGroup: Object.fromEntries(visibleGroups),
    omittedGroupAccounts: omittedAccounts,
    hotpCount: vault.accounts.filter((account) => account.type === "hotp").length,
    totpCount: vault.accounts.filter((account) => account.type === "totp").length,
  };
}

export function searchSafeAccounts(vault: SafeVault, query: string, limit = 20): SafeAccountMetadata[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  return vault.accounts
    .filter((account) => {
      if (!normalizedQuery) return true;
      return [account.name, account.issuer, account.group ?? ""]
        .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    })
    .slice(0, safeLimit);
}
