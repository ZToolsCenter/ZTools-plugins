export const MINIMUM_ZTOOLS_VERSION = "2.4.0";

export function parseVersion(value: unknown): [number, number, number] | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^\s*v?(\d+)\.(\d+)(?:\.(\d+))?(?:[-+][0-9A-Za-z.-]+)?\s*$/);
  if (!match) return null;
  const parts = [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] as [number, number, number];
  return parts.every(Number.isSafeInteger) ? parts : null;
}

export function compareVersions(left: unknown, right: unknown): number | null {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  const leftPrerelease = typeof left === "string" && /^\s*v?\d+\.\d+(?:\.\d+)?-/.test(left);
  const rightPrerelease = typeof right === "string" && /^\s*v?\d+\.\d+(?:\.\d+)?-/.test(right);
  if (leftPrerelease !== rightPrerelease) return leftPrerelease ? -1 : 1;
  return 0;
}

export function hostCompatibility(ztools: { getAppVersion?: () => unknown } | undefined) {
  if (!ztools) return { version: "", supported: true };
  let getAppVersion: unknown;
  try { getAppVersion = ztools.getAppVersion; } catch { return { version: "", supported: false }; }
  if (typeof getAppVersion !== "function") return { version: "", supported: false };
  let version: unknown;
  try { version = getAppVersion.call(ztools); } catch { return { version: "", supported: false }; }
  const comparison = compareVersions(version, MINIMUM_ZTOOLS_VERSION);
  return {
    version: typeof version === "string" ? version : "",
    supported: comparison !== null && comparison >= 0
  };
}
