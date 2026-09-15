import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NewAccountInput } from "@/lib/types";
import type { PlatformAdapter } from "@/platform/types";
import { initPlatform, useAccounts } from "../useAccounts";

const input: NewAccountInput = {
  name: "alice@example.com",
  issuer: "GitHub",
  secret: "JBSWY3DPEHPK3PXP",
  type: "totp",
  digits: 6,
  period: 30,
  counter: 0,
  algorithm: "SHA-1",
};

function makeAdapter(saveAccounts: PlatformAdapter["saveAccounts"] = vi.fn()): PlatformAdapter {
  return {
    loadAccounts: vi.fn(() => []),
    saveAccounts,
    loadGroups: vi.fn(() => []),
    saveGroups: vi.fn(),
    copyText: vi.fn(),
    readClipboardText: vi.fn(() => ""),
    readClipboardImage: vi.fn(() => null),
    captureScreen: vi.fn(async () => null),
    saveToFile: vi.fn(() => true),
    readFromFile: vi.fn(() => null),
    hideWindow: vi.fn(),
    showWindow: vi.fn(),
    showNotification: vi.fn(),
  };
}

beforeEach(() => {
  localStorage.clear();
  useAccounts.setState({
    accounts: [],
    trash: [],
    groups: [],
    selectedGroup: null,
    showAddForm: false,
    loadStatus: "ready",
    loadError: null,
  });
});

describe("账户存储", () => {
  it("持久化强调色并同步到页面属性", () => {
    useAccounts.getState().setAccentColor("ocean");

    expect(useAccounts.getState().accentColor).toBe("ocean");
    expect(localStorage.getItem("goose-2fa-accent")).toBe("ocean");
    expect(document.documentElement).toHaveAttribute("data-accent", "ocean");
  });

  it("串行保存连续变更，最后一次快照包含全部账户", async () => {
    const snapshots: string[][] = [];
    const adapter = makeAdapter(async (accounts) => {
      snapshots.push(accounts.map((account) => account.name));
    });
    initPlatform(adapter);

    useAccounts.getState().addAccount(input);
    useAccounts.getState().addAccount({ ...input, name: "bob@example.com" });

    await vi.waitFor(() => expect(snapshots).toHaveLength(2));
    expect(snapshots).toEqual([
      ["alice@example.com"],
      ["alice@example.com", "bob@example.com"],
    ]);
  });

  it("导入分组 ID 冲突但名称不同时创建新分组", () => {
    initPlatform(makeAdapter());
    useAccounts.setState({
      groups: [{ id: "shared-id", name: "现有分组", order: 0, createdAt: 1 }],
    });

    useAccounts.getState().importAccounts(
      [{ ...input, groupId: "shared-id" }],
      [{ id: "shared-id", name: "备份分组", order: 0, createdAt: 2 }],
    );

    const state = useAccounts.getState();
    expect(state.groups.map((group) => group.name)).toEqual(["现有分组", "备份分组"]);
    expect(state.accounts[0]?.groupId).not.toBe("shared-id");
    expect(state.groups.some((group) => group.id === state.accounts[0]?.groupId)).toBe(true);
  });

  it("保存失败时向用户发出通知", async () => {
    const adapter = makeAdapter(vi.fn(async () => {
      throw new Error("disk full");
    }));
    initPlatform(adapter);

    useAccounts.getState().addAccount(input);

    await vi.waitFor(() => {
      expect(adapter.showNotification).toHaveBeenCalledWith("账户保存失败，请检查存储权限后重试");
    });
  });

  it("可把账户移动到其他分组或未分组，重复投放不会保存", async () => {
    const saveAccounts = vi.fn();
    initPlatform(makeAdapter(saveAccounts));
    useAccounts.setState({
      groups: [{ id: "work", name: "工作", order: 0, createdAt: 1 }],
      accounts: [{
        ...input,
        id: "account-1",
        createdAt: 1,
        groupId: null,
      }],
    });

    useAccounts.getState().updateAccountGroup("account-1", "work");
    expect(useAccounts.getState().accounts[0]?.groupId).toBe("work");

    await vi.waitFor(() => expect(saveAccounts).toHaveBeenCalledTimes(1));
    useAccounts.getState().updateAccountGroup("account-1", "work");
    expect(saveAccounts).toHaveBeenCalledTimes(1);

    useAccounts.getState().updateAccountGroup("account-1", null);
    expect(useAccounts.getState().accounts[0]?.groupId).toBeNull();
    await vi.waitFor(() => expect(saveAccounts).toHaveBeenCalledTimes(2));
  });

  it("拒绝未知分组，避免把账户误移到未分组", () => {
    const saveAccounts = vi.fn();
    initPlatform(makeAdapter(saveAccounts));
    useAccounts.setState({
      accounts: [{
        ...input,
        id: "account-1",
        createdAt: 1,
        groupId: "work",
      }],
      groups: [{ id: "work", name: "工作", order: 0, createdAt: 1 }],
    });

    useAccounts.getState().updateAccountGroup("account-1", "missing");

    expect(useAccounts.getState().accounts[0]?.groupId).toBe("work");
    expect(saveAccounts).not.toHaveBeenCalled();
  });
});

describe("分组存储", () => {
  it("创建分组时写入平台存储，而不是只留在 localStorage", async () => {
    const saveGroups = vi.fn();
    const adapter = makeAdapter();
    adapter.saveGroups = saveGroups;
    initPlatform(adapter);

    const groupId = useAccounts.getState().createGroup("工作");
    expect(groupId).toBeTruthy();
    await vi.waitFor(() => expect(saveGroups).toHaveBeenCalledTimes(1));
    expect(saveGroups).toHaveBeenCalledWith([
      expect.objectContaining({ id: groupId, name: "工作" }),
    ]);
    expect(localStorage.getItem("goose-2fa-groups")).toBeNull();
  });

  it("加载时优先使用平台分组，并迁移旧 localStorage 分组", async () => {
    const saveGroups = vi.fn();
    const legacy = [{ id: "legacy", name: "旧分组", order: 0, createdAt: 1 }];
    localStorage.setItem("goose-2fa-groups", JSON.stringify(legacy));

    const adapter = makeAdapter();
    adapter.loadGroups = vi.fn(async () => []);
    adapter.saveGroups = saveGroups;
    initPlatform(adapter);

    await useAccounts.getState().load();

    expect(useAccounts.getState().groups).toEqual(legacy);
    await vi.waitFor(() => expect(saveGroups).toHaveBeenCalledWith(legacy));
    await vi.waitFor(() => expect(localStorage.getItem("goose-2fa-groups")).toBeNull());
  });

  it("平台已有分组时覆盖旧 localStorage 脏数据", async () => {
    const platformGroups = [{ id: "cloud", name: "云端分组", order: 0, createdAt: 2 }];
    localStorage.setItem(
      "goose-2fa-groups",
      JSON.stringify([{ id: "legacy", name: "旧分组", order: 0, createdAt: 1 }]),
    );

    const adapter = makeAdapter();
    adapter.loadGroups = vi.fn(async () => platformGroups);
    adapter.saveGroups = vi.fn();
    initPlatform(adapter);

    await useAccounts.getState().load();

    expect(useAccounts.getState().groups).toEqual(platformGroups);
    expect(localStorage.getItem("goose-2fa-groups")).toBeNull();
  });
});
