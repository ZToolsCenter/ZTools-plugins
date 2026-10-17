export const MINIMUM_ZTOOLS_VERSION = "2.4.0";
export const EDITABLE_SCREEN_CAPTURE_VERSION = "3.2.0";

export type ZToolsHostCompatibility = Readonly<{
  currentVersion?: string;
  minimumVersion: string;
  supported: boolean;
  supportsPluginData: boolean;
  supportsNativeFileDrag: boolean;
  supportsScreenCapture: boolean;
}>;

type VersionHost = Readonly<{
  getAppVersion?: () => unknown;
  getPath?: (name: string) => unknown;
  startDrag?: unknown;
  screenCapture?: unknown;
}>;

type VersionParts = Readonly<{
  core: readonly [number, number, number];
  prerelease: readonly string[];
}>;

function versionParts(value: string): VersionParts | undefined {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.exec(
    value.trim(),
  );
  if (match === null) return undefined;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)],
    prerelease: match[4]?.split(".") ?? [],
  };
}

function comparePrerelease(
  left: readonly string[],
  right: readonly string[],
): number {
  if (left.length === 0 || right.length === 0) {
    return left.length === right.length ? 0 : left.length === 0 ? 1 : -1;
  }
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === rightPart ? 0 : leftPart === undefined ? -1 : 1;
    }
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/u.test(leftPart);
    const rightNumeric = /^\d+$/u.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) - Number(rightPart);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}

export function compareZToolsVersions(left: string, right: string): number | undefined {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  if (leftParts === undefined || rightParts === undefined) return undefined;
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts.core[index]! - rightParts.core[index]!;
    if (difference !== 0) return difference;
  }
  return comparePrerelease(leftParts.prerelease, rightParts.prerelease);
}

export const compareVersions = compareZToolsVersions;

export function detectZToolsHostCompatibility(host: VersionHost): ZToolsHostCompatibility {
  let currentVersion: string | undefined;
  try {
    const value = host.getAppVersion?.();
    if (typeof value === "string" && value.trim().length > 0) {
      currentVersion = value.trim();
    }
  } catch {
    currentVersion = undefined;
  }
  const comparison =
    currentVersion === undefined
      ? undefined
      : compareZToolsVersions(currentVersion, MINIMUM_ZTOOLS_VERSION);
  const editableScreenCaptureComparison =
    currentVersion === undefined
      ? undefined
      : compareZToolsVersions(currentVersion, EDITABLE_SCREEN_CAPTURE_VERSION);
  let supportsPluginData = false;
  try {
    const pluginData = host.getPath?.("pluginData");
    supportsPluginData = typeof pluginData === "string" && pluginData.length > 0;
  } catch {
    supportsPluginData = false;
  }
  let supportsNativeFileDrag = false;
  try {
    supportsNativeFileDrag = typeof host.startDrag === "function";
  } catch {
    supportsNativeFileDrag = false;
  }
  let supportsScreenCapture = false;
  try {
    const screenCapture = host.screenCapture;
    supportsScreenCapture =
      editableScreenCaptureComparison !== undefined &&
      editableScreenCaptureComparison >= 0 &&
      typeof screenCapture === "function";
  } catch {
    supportsScreenCapture = false;
  }
  return {
    ...(currentVersion === undefined ? {} : { currentVersion }),
    minimumVersion: MINIMUM_ZTOOLS_VERSION,
    // A real host with no readable version is treated as unsupported. Browser
    // previews have no preload bridge and are handled separately in the UI.
    supported: comparison !== undefined && comparison >= 0,
    supportsPluginData,
    supportsNativeFileDrag,
    // ZTools 3.2 documents the editable capture contract as
    // screenCapture(callback, autoConfirm). Some 3.2.0 installations still
    // expose a one-argument wrapper even though the underlying host accepts
    // autoConfirm as an optional second argument. Function.length therefore
    // cannot be used as a capability signal; bounds remain optional at runtime.
    supportsScreenCapture,
  };
}

export const inspectHostCompatibility = detectZToolsHostCompatibility;
