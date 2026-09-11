interface LogEntry {
  timestamp: number;
  level: "error" | "warn" | "info";
  message: string;
  data?: unknown;
}

const LOG_KEY = "goose-2fa-logs";
const MAX_AGE = 30 * 60 * 1000; // 30 分钟
const MAX_ENTRIES = 200;

function readLogs(): LogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeLogs(logs: LogEntry[]): void {
  localStorage.setItem(LOG_KEY, JSON.stringify(logs));
}

/** 清理超过 30 分钟的日志条目 */
function pruneLogs(): void {
  const logs = readLogs();
  const cutoff = Date.now() - MAX_AGE;
  const pruned = logs.filter((l) => l.timestamp > cutoff);
  if (pruned.length > MAX_ENTRIES) {
    writeLogs(pruned.slice(-MAX_ENTRIES));
  } else {
    writeLogs(pruned);
  }
}

function addLog(level: LogEntry["level"], message: string, data?: unknown): void {
  const cutoff = Date.now() - MAX_AGE;
  const logs = readLogs().filter((entry) => entry.timestamp > cutoff);
  logs.push({ timestamp: Date.now(), level, message, data });
  if (logs.length > MAX_ENTRIES) {
    writeLogs(logs.slice(-MAX_ENTRIES));
  } else {
    writeLogs(logs);
  }
}

export const logger = {
  error: (message: string, data?: unknown) => {
    console.error(message, data);
    addLog("error", message, data);
  },
  warn: (message: string, data?: unknown) => {
    console.warn(message, data);
    addLog("warn", message, data);
  },
  info: (message: string, _data?: unknown) => {
    addLog("info", message);
  },
  getLogs: readLogs,
  prune: pruneLogs,
};

// 启动时清理一次过期日志
pruneLogs();
