const MINIMUM_ZTOOLS_VERSION = [2, 4, 0] as const;

type ZToolsHostLike = {
  getAppVersion?: () => unknown;
};

export interface ZToolsHostCompatibility {
  mode: "browser-preview" | "supported" | "upgrade-required";
  version?: string;
  requiresUpgrade: boolean;
  reason: "browser-preview" | "supported" | "below-minimum" | "version-unavailable" | "version-invalid";
}

function parseVersion(input: unknown): { parts: number[]; prerelease: boolean } | null {
  if (typeof input !== "string") return null;
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?([+-][0-9A-Za-z.-]+)?$/u.exec(input.trim());
  if (!match) return null;
  const parts = [match[1], match[2], match[3] ?? "0"].map(part => Number.parseInt(part, 10));
  if (parts.some(part => !Number.isSafeInteger(part))) return null;
  return { parts, prerelease: Boolean(match[4]?.startsWith("-")) };
}

export function isBelowMinimumZToolsVersion(version: unknown): boolean {
  const parsed = parseVersion(version);
  if (!parsed) return false;
  for (let index = 0; index < MINIMUM_ZTOOLS_VERSION.length; index += 1) {
    const minimum = MINIMUM_ZTOOLS_VERSION[index];
    const actual = parsed.parts[index] ?? 0;
    if (actual === minimum) continue;
    return actual < minimum;
  }
  return parsed.prerelease;
}

export function detectZToolsHostCompatibility(ztools: ZToolsHostLike | undefined): ZToolsHostCompatibility {
  if (ztools === undefined) {
    return {
      mode: "browser-preview",
      requiresUpgrade: false,
      reason: "browser-preview",
    };
  }

  let value: unknown;
  try {
    if (typeof ztools.getAppVersion !== "function") {
      return {
        mode: "upgrade-required",
        requiresUpgrade: true,
        reason: "version-unavailable",
      };
    }
    value = ztools.getAppVersion();
  } catch {
    return {
      mode: "upgrade-required",
      requiresUpgrade: true,
      reason: "version-unavailable",
    };
  }

  const version = typeof value === "string" ? value.trim() : "";
  if (!parseVersion(version)) {
    return {
      mode: "upgrade-required",
      requiresUpgrade: true,
      reason: "version-invalid",
    };
  }
  if (isBelowMinimumZToolsVersion(version)) {
    return {
      mode: "upgrade-required",
      version,
      requiresUpgrade: true,
      reason: "below-minimum",
    };
  }
  return {
    mode: "supported",
    version,
    requiresUpgrade: false,
    reason: "supported",
  };
}

export function modelValue(model: { id?: string; value?: string }): string {
  return model.value || model.id || "";
}

export function modelLabel(model: { id?: string; value?: string; label?: string }): string {
  return model.label || model.value || model.id || "未命名模型";
}

export function modelProviderLabel(model: {
  provider?: string;
  providerId?: string;
  providerLabel?: string;
}): string {
  return model.providerLabel || model.provider || model.providerId || "";
}

export function reasoningEffortOptions(model: {
  reasoning?: { efforts?: Array<{ id?: string; label?: string }> };
  reasoningEfforts?: string[];
} | undefined): Array<{ id: string; label: string }> {
  const nested = model?.reasoning?.efforts
    ?.filter((effort): effort is { id: string; label?: string } => Boolean(effort?.id))
    .map(effort => ({ id: effort.id, label: effort.label || effort.id })) ?? [];
  if (nested.length) return nested;
  return (model?.reasoningEfforts ?? [])
    .filter(Boolean)
    .map(id => ({ id, label: id }));
}

export function defaultReasoningEffort(model: {
  reasoning?: { defaultEffort?: string };
  defaultEffort?: string;
} | undefined): string {
  return model?.reasoning?.defaultEffort || model?.defaultEffort || "";
}
