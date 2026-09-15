import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { loadSafeVault, searchSafeAccounts, summarizeVault } from "./vault";

const SAFETY_NOTICE = "只返回脱敏账户元数据：绝不返回种子、otpauth URI 或动态验证码；服务也不提供写入、删除或生成验证码的工具。";

function asText(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function asError() {
  return { content: [{ type: "text" as const, text: "无法读取 2FA 备份文件。请检查 MCP 配置与备份格式。" }], isError: true };
}

export function createGoose2faMcpServer(backupPath = process.env.GOOSE_2FA_MCP_BACKUP_PATH) {
  const server = new McpServer({ name: "goose-2fa", version: "0.1.0" });

  server.registerResource(
    "safety",
    "goose2fa://safety",
    { title: "鹅的验证 MCP 安全边界", description: "服务的本地只读与脱敏约束", mimeType: "text/plain" },
    async () => ({ contents: [{ uri: "goose2fa://safety", mimeType: "text/plain", text: SAFETY_NOTICE }] }),
  );

  server.registerTool(
    "get_vault_summary",
    {
      title: "查看 2FA 保险库摘要",
      description: "读取导出备份并返回账户数、分组数和协议类型统计；不返回种子或验证码。",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      try {
        return asText({ ...summarizeVault(loadSafeVault(backupPath)), safety: SAFETY_NOTICE });
      } catch {
        return asError();
      }
    },
  );

  server.registerTool(
    "search_account_metadata",
    {
      title: "检索 2FA 账户元数据",
      description: "按账户名、发行方或分组检索脱敏元数据；不返回种子、otpauth URI 或验证码。",
      inputSchema: {
        query: z.string().max(200).default(""),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ query, limit }) => {
      try {
        const vault = loadSafeVault(backupPath);
        return asText({ accounts: searchSafeAccounts(vault, query, limit), safety: SAFETY_NOTICE });
      } catch {
        return asError();
      }
    },
  );

  return server;
}

async function main() {
  const server = createGoose2faMcpServer();
  await server.connect(new StdioServerTransport());
  console.error("[goose-2fa-mcp] stdio server ready; secrets and OTP codes are never exposed.");
}

const isMainModule = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMainModule) {
  void main().catch((error) => {
    console.error("[goose-2fa-mcp] failed to start:", error);
    process.exitCode = 1;
  });
}
