"use strict";

const STORAGE_KEY = "live_markdown_mcp_servers_v1";

function loadMcpConfig() {
  const storage = getStorage();
  if (!storage) return [];
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null || raw === undefined || raw === "") return [];
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!Array.isArray(parsed)) throw new Error("Saved MCP configuration is corrupt; export or remove its storage key before retrying");
  return parsed;
}

function saveMcpConfig(config) {
  const storage = getStorage();
  if (!storage) throw new Error("This host does not provide persistent storage for MCP server configuration");
  const serialized = JSON.stringify(config);
  storage.setItem(STORAGE_KEY, serialized);
  const stored = storage.getItem(STORAGE_KEY);
  if (typeof stored !== "string" || stored !== serialized) throw new Error("MCP configuration could not be verified after saving");
}

function getStorage() {
  const ztools = typeof window !== "undefined" ? window.ztools : null;
  if (ztools?.dbStorage && typeof ztools.dbStorage.getItem === "function" && typeof ztools.dbStorage.setItem === "function") return ztools.dbStorage;
  if (typeof localStorage !== "undefined" && typeof localStorage.getItem === "function" && typeof localStorage.setItem === "function") return localStorage;
  return null;
}

module.exports = { STORAGE_KEY, loadMcpConfig, saveMcpConfig };
