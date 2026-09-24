import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { PlatformProvider } from "@/platform/context";
import type { PlatformAdapter } from "@/platform/types";
import { initPlatform, useAccounts } from "@/stores/useAccounts";
import type { AccountData } from "@/lib/types";

const account: AccountData = {
  id: "account-1",
  name: "alice@example.com",
  issuer: "GitHub",
  secret: "JBSWY3DPEHPK3PXP",
  type: "totp",
  digits: 6,
  period: 30,
  counter: 0,
  algorithm: "SHA-1",
  createdAt: 1,
  groupId: null,
};

function makeAdapter(loadAccounts: PlatformAdapter["loadAccounts"]): PlatformAdapter {
  return {
    loadAccounts,
    saveAccounts: vi.fn(),
    loadGroups: vi.fn(async () => []),
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

function renderApp(adapter: PlatformAdapter) {
  initPlatform(adapter);
  return render(
    <PlatformProvider adapter={adapter}>
      <App />
    </PlatformProvider>,
  );
}

function enterPlugin(code: string, payload = "") {
  window.dispatchEvent(new CustomEvent("goose-2fa:plugin-enter", {
    detail: { code, type: "text", payload },
  }));
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  useAccounts.setState({
    accounts: [],
    trash: [],
    groups: [],
    searchQuery: "",
    showAddForm: false,
    showDataTransfer: false,
    showTrash: false,
    isDark: false,
    isThemeLocked: false,
    editMode: false,
    viewMode: "compact",
    selectedGroup: null,
    accentColor: "mono",
    loadStatus: "idle",
    loadError: null,
  });
});

describe("App 核心流程", () => {
  it("数据完成读取前保持门禁，读取后可进入账户详情", async () => {
    let resolveLoad!: (accounts: AccountData[]) => void;
    const pending = new Promise<AccountData[]>((resolve) => {
      resolveLoad = resolve;
    });
    renderApp(makeAdapter(() => pending));

    expect(screen.getByText("正在读取本地账户")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "验证码" })).not.toBeInTheDocument();

    await act(async () => resolveLoad([account]));
    expect(await screen.findByRole("heading", { name: "验证码" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "详情" }));
    expect(await screen.findByRole("button", { name: "返回" })).toBeInTheDocument();
    expect(screen.getByText("账户详情")).toBeInTheDocument();
    expect(screen.getAllByText(/alice@example\.com/)).toHaveLength(2);
    expect(screen.getByRole("combobox", { name: "移动到分组" })).toHaveTextContent("未分组");
    expect(screen.getAllByText("添加时间")).toHaveLength(1);
  });

  it("读取失败不会进入空仓库，重试后恢复", async () => {
    const loadAccounts = vi
      .fn<PlatformAdapter["loadAccounts"]>()
      .mockRejectedValueOnce(new Error("broken storage"))
      .mockResolvedValueOnce([]);
    renderApp(makeAdapter(loadAccounts));

    expect(await screen.findByRole("alert")).toHaveTextContent("已有数据不会被覆盖");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(await screen.findByRole("heading", { name: "验证码" })).toBeInTheDocument();
    expect(loadAccounts).toHaveBeenCalledTimes(2);
  });

  it("添加账户入口可到达且表单字段有可访问名称", async () => {
    renderApp(makeAdapter(() => []));
    await screen.findByRole("heading", { name: "验证码" });

    fireEvent.click(screen.getByRole("button", { name: "添加账户" }));
    expect(await screen.findByRole("heading", { name: "添加账户" })).toBeInTheDocument();
    const nameInput = screen.getByRole("textbox", { name: "账户名称" });
    const secretInput = screen.getByRole("textbox", { name: "密钥" });
    expect(nameInput).toBeInTheDocument();
    expect(secretInput).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(nameInput).toHaveAttribute("aria-invalid", "true");
    expect(secretInput).toHaveAttribute("aria-invalid", "false");
    expect(screen.getByRole("alert")).toHaveTextContent("请输入账户名称");

    fireEvent.change(nameInput, { target: { value: "GitHub" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(nameInput).toHaveAttribute("aria-invalid", "false");
    expect(secretInput).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("请输入密钥");
  });

  it("账户只按顶部分组筛选，不再按发行方生成可收起的二级分组", async () => {
    const openAiAccount: AccountData = {
      ...account,
      id: "account-2",
      issuer: "OpenAI",
      name: "bob@example.com",
    };
    renderApp(makeAdapter(() => [account, openAiAccount]));
    await screen.findByRole("heading", { name: "验证码" });

    expect(screen.getAllByRole("button", { name: "详情" })).toHaveLength(2);
    expect(screen.queryByText("收起")).not.toBeInTheDocument();
    expect(screen.queryByText("展开")).not.toBeInTheDocument();
    expect(screen.queryByText("OpenAI")).not.toBeInTheDocument();
  });

  it("从 2FA 主命令进入时不把命令名当作搜索词，并保留管理菜单", async () => {
    renderApp(makeAdapter(() => [account]));
    await screen.findByRole("heading", { name: "验证码" });

    act(() => useAccounts.getState().setSearchQuery("旧搜索"));
    act(() => enterPlugin("2fa", "2FA"));

    expect(await screen.findByRole("heading", { name: "验证码" })).toBeInTheDocument();
    expect(screen.queryByText(/没有账户匹配/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "菜单" })).toBeInTheDocument();
    expect(useAccounts.getState().searchQuery).toBe("");
  });

  it("只有快速取码命令进入快速模式，管理命令可返回主界面", async () => {
    const adapter = makeAdapter(() => [account]);
    adapter.setSubInput = vi.fn();
    adapter.removeSubInput = vi.fn();
    renderApp(adapter);
    await screen.findByRole("heading", { name: "验证码" });

    act(() => enterPlugin("quick", "2fa GitHub"));
    expect(await screen.findByRole("listbox", { name: "验证码账户" })).toBeInTheDocument();
    expect(adapter.setSubInput).toHaveBeenCalledWith(
      expect.any(Function),
      "搜索账户名、发行方或备注",
      "GitHub",
    );

    act(() => enterPlugin("manage", "管理鹅的验证"));
    expect(await screen.findByRole("heading", { name: "验证码" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "菜单" })).toBeInTheDocument();
    expect(adapter.removeSubInput).toHaveBeenCalled();
  });
});
