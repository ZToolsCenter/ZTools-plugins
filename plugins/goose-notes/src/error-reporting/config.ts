export const GOOSE_NOTE_PROJECT = "goose-note";

export type ResolvedErrorReporting = {
  enabled: boolean;
  environment: string;
  dsn: string | null;
};

function readProjectEntry(value: unknown): { enabled?: boolean; dsn: string | null } {
  if (typeof value === "string" && value.trim()) {
    return { dsn: value.trim() };
  }
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const dsn = typeof rec.dsn === "string" && rec.dsn.trim() ? rec.dsn.trim() : null;
    return { enabled: rec.enabled === true, dsn };
  }
  return { dsn: null };
}

/**
 * 解析 ~/.config/goose/error-reporting.json。
 * 兼容两种形状：
 * - 顶层 enabled + projects[id] = string DSN
 * - projects[id] = { enabled, dsn }
 * 缺字段 / enabled 非 true / 无 DSN → 不上报。不在仓库里写死公网地址。
 */
export function resolveErrorReportingConfig(
  raw: unknown,
  project: string = GOOSE_NOTE_PROJECT,
): ResolvedErrorReporting {
  if (!raw || typeof raw !== "object") {
    return { enabled: false, environment: "dev", dsn: null };
  }
  const obj = raw as Record<string, unknown>;
  const environment =
    typeof obj.environment === "string" && obj.environment.trim()
      ? obj.environment.trim()
      : "dev";
  const projects = obj.projects;
  const entry =
    projects && typeof projects === "object"
      ? readProjectEntry((projects as Record<string, unknown>)[project])
      : { dsn: null };
  const enabled =
    typeof entry.enabled === "boolean" ? entry.enabled : obj.enabled === true;
  return { enabled, environment, dsn: entry.dsn };
}

export function shouldReportErrors(config: ResolvedErrorReporting): boolean {
  return config.enabled && Boolean(config.dsn);
}
