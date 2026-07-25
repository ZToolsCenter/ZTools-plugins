# MCP compatibility note

This plugin does not ship a second JSON-RPC proxy process.

- Recommended: ZTools loads `preload/services.cjs`, registers `office_document`, and exposes it through the host HTTP MCP service.
- Compatibility mode: configure the resolved OfficeCLI binary directly with `args: ["mcp"]`.

Keeping both paths on the same OfficeCLI runtime avoids an extra resident process and a redundant JSON-RPC hop.
