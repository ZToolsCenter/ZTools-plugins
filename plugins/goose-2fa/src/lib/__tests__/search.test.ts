import { describe, expect, it } from "vitest";
import type { AccountData } from "../types";
import { filterAccounts, matchAccount } from "../search";

function makeAccount(partial: Partial<AccountData>): AccountData {
  return {
    id: partial.id ?? crypto.randomUUID(),
    name: partial.name ?? "",
    issuer: partial.issuer ?? "",
    secret: partial.secret ?? "JBSWY3DPEHPK3PXP",
    type: partial.type ?? "totp",
    digits: partial.digits ?? 6,
    period: partial.period ?? 30,
    counter: partial.counter ?? 0,
    algorithm: partial.algorithm ?? "SHA-1",
    createdAt: partial.createdAt ?? Date.now(),
    remark: partial.remark,
    note: partial.note,
    originalName: partial.originalName,
    meta: partial.meta,
  };
}

describe("matchAccount", () => {
  const github = makeAccount({
    issuer: "GitHub",
    name: "alice@example.com",
    remark: "工作主号",
  });
  const google = makeAccount({
    issuer: "Google",
    name: "user@gmail.com",
    note: "MFA 备用",
  });

  it("空查询匹配全部", () => {
    expect(matchAccount(github, "")).toBe(true);
    expect(matchAccount(google, "   ")).toBe(true);
  });

  it("大小写不敏感", () => {
    expect(matchAccount(github, "github")).toBe(true);
    expect(matchAccount(github, "GITHUB")).toBe(true);
    expect(matchAccount(github, "GitHub")).toBe(true);
  });

  it("匹配 issuer", () => {
    expect(matchAccount(github, "git")).toBe(true);
    expect(matchAccount(google, "git")).toBe(false);
  });

  it("匹配 name", () => {
    expect(matchAccount(github, "alice")).toBe(true);
    expect(matchAccount(github, "example")).toBe(true);
  });

  it("匹配 remark", () => {
    expect(matchAccount(github, "工作")).toBe(true);
    expect(matchAccount(github, "主号")).toBe(true);
  });

  it("匹配 note", () => {
    expect(matchAccount(google, "MFA")).toBe(true);
    expect(matchAccount(google, "备用")).toBe(true);
  });

  it("多关键字 AND", () => {
    expect(matchAccount(github, "github alice")).toBe(true);
    expect(matchAccount(github, "github 工作")).toBe(true);
    expect(matchAccount(github, "github gmail")).toBe(false);
  });

  it("不存在的字段返回 false", () => {
    expect(matchAccount(github, "nope")).toBe(false);
  });

  it("undefined remark/note 不爆炸", () => {
    const bare = makeAccount({ issuer: "Bare", name: "x" });
    expect(matchAccount(bare, "bare")).toBe(true);
    expect(matchAccount(bare, "missing")).toBe(false);
  });
});

describe("filterAccounts", () => {
  const list = [
    makeAccount({ issuer: "GitHub", name: "alice" }),
    makeAccount({ issuer: "Google", name: "bob" }),
    makeAccount({ issuer: "GitLab", name: "carol" }),
  ];

  it("空查询返回全部", () => {
    expect(filterAccounts(list, "")).toHaveLength(3);
  });

  it("子串匹配", () => {
    const result = filterAccounts(list, "git");
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.issuer)).toEqual(["GitHub", "GitLab"]);
  });
});
