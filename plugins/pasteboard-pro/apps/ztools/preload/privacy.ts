import type { ZToolsDocumentDatabase } from "./clipboard-store";

export type ClipboardContentRule = Readonly<{
  type: "literal" | "wildcard" | "regex";
  value: string;
  flags?: string;
}>;

export type ClipboardPrivacyRules = Readonly<{
  ignoredBundleIds: readonly string[];
  blockLikelySecrets: boolean;
  contentRules: readonly ClipboardContentRule[];
}>;

export type ClipboardPrivacyInput = Readonly<{
  sourceBundleId?: string;
  text?: string;
  transient?: boolean;
  confidential?: boolean;
}>;

export type CapturePauseState = Readonly<{
  paused: boolean;
  resumeAt?: string;
}>;

export type PrivacySettings = Readonly<{
  pause: CapturePauseState;
  rules: ClipboardPrivacyRules;
  retention: Readonly<{
    days: number;
    maxBlobBytes: number;
  }>;
  screenShareProtection: boolean;
}>;

export type RetentionItem = Readonly<{
  id: string;
  copiedAt: string;
  blobBytes: number;
  pinned: boolean;
  pinboardId?: string;
}>;

export type RetentionPolicy = Readonly<{
  days: number;
  maxBlobBytes: number;
  now?: Date | string | number;
}>;

export type RetentionPrunePlan = Readonly<{
  deletedIds: string[];
  remainingBlobBytes: number;
  overBudget: boolean;
}>;

export type ClipboardWriteContent = Readonly<{
  type: string;
  content: unknown;
}>;

export type DirectPasteTarget =
  | Readonly<{ type: "host"; hostItemId: string }>
  | Readonly<{ type: "content"; content: ClipboardWriteContent }>;

export interface ClipboardPasteHost {
  write(id: string, shouldPaste: boolean): Promise<void>;
  writeContent(
    input: ClipboardWriteContent,
    shouldPaste: boolean,
  ): Promise<void>;
}

export type DirectPasteResult =
  | Readonly<{ status: "pasted" }>
  | Readonly<{
      status: "accessibility_required";
      directPasteError: string;
    }>;

const MAX_RULE_LENGTH = 256;
const MAX_SCANNED_TEXT_LENGTH = 16_384;
const SECRET_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/iu,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\bgh[opsu]_[A-Za-z0-9]{30,}\b/u,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/u,
];
const PRIVACY_DOCUMENT_ID = "pasteboard-pro:settings:privacy";

export const defaultPrivacySettings: PrivacySettings = {
  pause: { paused: false },
  rules: {
    ignoredBundleIds: [
      "com.1password.1password",
      "com.bitwarden.desktop",
      "org.keepassxc.keepassxc",
    ],
    blockLikelySecrets: true,
    contentRules: [],
  },
  retention: {
    days: 90,
    maxBlobBytes: 1_073_741_824,
  },
  screenShareProtection: true,
};

function normalizedBundleId(value: string): string {
  return value.trim().toLowerCase();
}

function escapedRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function assertRuleLength(value: string): void {
  if (value.length === 0) {
    throw new RangeError("Privacy rules cannot be empty");
  }
  if (value.length > MAX_RULE_LENGTH) {
    throw new RangeError("Privacy rules cannot exceed 256 characters");
  }
}

function assertSafeRegex(pattern: string): void {
  assertRuleLength(pattern);
  if (
    /\([^)]*(?:\+|\*|\{\d+,?\d*\})[^)]*\)(?:\+|\*|\{)/u.test(pattern) ||
    /\.\*.*\.\*/u.test(pattern)
  ) {
    throw new RangeError("Potentially unsafe regular expression");
  }
}

function compileRule(rule: ClipboardContentRule): RegExp {
  assertRuleLength(rule.value);

  if (rule.type === "literal") {
    return new RegExp(escapedRegex(rule.value), "iu");
  }

  if (rule.type === "wildcard") {
    const pattern = escapedRegex(rule.value)
      .replaceAll("\\*", ".*")
      .replaceAll("\\?", ".");
    return new RegExp(`^${pattern}$`, "iu");
  }

  assertSafeRegex(rule.value);
  const flags = rule.flags ?? "";
  if (/[^imsu]/u.test(flags)) {
    throw new TypeError("Privacy regex flags may only contain i, m, s, or u");
  }
  return new RegExp(rule.value, [...new Set(`${flags}u`)].join(""));
}

export function shouldPersistClipboard(
  input: ClipboardPrivacyInput,
  rules: ClipboardPrivacyRules,
): boolean {
  if (input.transient === true || input.confidential === true) {
    return false;
  }

  if (
    input.sourceBundleId !== undefined &&
    rules.ignoredBundleIds
      .map(normalizedBundleId)
      .includes(normalizedBundleId(input.sourceBundleId))
  ) {
    return false;
  }

  if (input.text === undefined) {
    return true;
  }

  const text = input.text.slice(0, MAX_SCANNED_TEXT_LENGTH);
  if (
    rules.blockLikelySecrets &&
    SECRET_PATTERNS.some((pattern) => pattern.test(text))
  ) {
    return false;
  }

  return !rules.contentRules.some((rule) => compileRule(rule).test(text));
}

export function isCapturePaused(
  state: CapturePauseState,
  now: Date | string | number = Date.now(),
): boolean {
  if (!state.paused) {
    return false;
  }
  if (state.resumeAt === undefined) {
    return true;
  }

  const resumeAt = Date.parse(state.resumeAt);
  const nowMs = new Date(now).getTime();
  return !Number.isFinite(resumeAt) || !Number.isFinite(nowMs) || nowMs < resumeAt;
}

function validatedPolicy(policy: RetentionPolicy): Readonly<{
  cutoff: number;
  maxBlobBytes: number;
}> {
  if (!Number.isFinite(policy.days) || policy.days < 0) {
    throw new RangeError("Retention days must be finite and non-negative");
  }
  if (!Number.isSafeInteger(policy.maxBlobBytes) || policy.maxBlobBytes < 0) {
    throw new RangeError("Blob budget must be a non-negative safe integer");
  }

  const now = policy.now === undefined ? Date.now() : new Date(policy.now).getTime();
  if (!Number.isFinite(now)) {
    throw new RangeError("Retention clock is invalid");
  }
  return {
    cutoff: now - policy.days * 24 * 60 * 60 * 1_000,
    maxBlobBytes: policy.maxBlobBytes,
  };
}

function isProtected(item: RetentionItem): boolean {
  return item.pinned || item.pinboardId !== undefined;
}

function itemTimestamp(item: RetentionItem): number {
  const timestamp = Date.parse(item.copiedAt);
  if (!Number.isFinite(timestamp)) {
    throw new RangeError(`Retention item ${item.id} has an invalid copiedAt`);
  }
  if (!Number.isSafeInteger(item.blobBytes) || item.blobBytes < 0) {
    throw new RangeError(`Retention item ${item.id} has invalid blobBytes`);
  }
  return timestamp;
}

export function planRetentionPrune(
  items: readonly RetentionItem[],
  policy: RetentionPolicy,
): RetentionPrunePlan {
  const { cutoff, maxBlobBytes } = validatedPolicy(policy);
  const timestamps = new Map(
    items.map((item) => [item.id, itemTimestamp(item)] as const),
  );
  const deleted = new Set<string>();
  const deletedIds: string[] = [];
  const remove = (id: string): void => {
    if (!deleted.has(id)) {
      deleted.add(id);
      deletedIds.push(id);
    }
  };

  for (const item of [...items].sort(
    (left, right) => timestamps.get(left.id)! - timestamps.get(right.id)!,
  )) {
    if (!isProtected(item) && timestamps.get(item.id)! < cutoff) {
      remove(item.id);
    }
  }

  let remainingBlobBytes = items.reduce(
    (total, item) => total + (deleted.has(item.id) ? 0 : item.blobBytes),
    0,
  );

  const budgetCandidates = items
    .filter((item) => !deleted.has(item.id) && !isProtected(item))
    .sort((left, right) => timestamps.get(left.id)! - timestamps.get(right.id)!);

  for (const item of budgetCandidates) {
    if (remainingBlobBytes <= maxBlobBytes) {
      break;
    }
    remove(item.id);
    remainingBlobBytes -= item.blobBytes;
  }

  return {
    deletedIds,
    remainingBlobBytes,
    overBudget: remainingBlobBytes > maxBlobBytes,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function databaseStatus(error: unknown, status: number): boolean {
  return (
    isRecord(error) &&
    (error.status === status || error.statusCode === status)
  );
}

function parsedPrivacySettings(value: unknown): PrivacySettings | undefined {
  if (!isRecord(value) || !isRecord(value.settings)) {
    return undefined;
  }
  const settings = value.settings;
  if (!isRecord(settings.pause) || !isRecord(settings.rules)) {
    return undefined;
  }
  const pause = settings.pause;
  const rules = settings.rules;
  if (
    typeof pause.paused !== "boolean" ||
    !Array.isArray(rules.ignoredBundleIds) ||
    !rules.ignoredBundleIds.every((entry) => typeof entry === "string") ||
    typeof rules.blockLikelySecrets !== "boolean" ||
    !Array.isArray(rules.contentRules)
  ) {
    return undefined;
  }

  const contentRules: ClipboardContentRule[] = [];
  for (const candidate of rules.contentRules) {
    if (
      !isRecord(candidate) ||
      (candidate.type !== "literal" &&
        candidate.type !== "wildcard" &&
        candidate.type !== "regex") ||
      typeof candidate.value !== "string" ||
      (candidate.flags !== undefined && typeof candidate.flags !== "string")
    ) {
      return undefined;
    }
    contentRules.push({
      type: candidate.type,
      value: candidate.value,
      ...(candidate.flags === undefined ? {} : { flags: candidate.flags }),
    });
  }

  const retention = isRecord(settings.retention) ? settings.retention : undefined;
  const days = typeof retention?.days === "number" ? retention.days : undefined;
  const maxBlobBytes =
    typeof retention?.maxBlobBytes === "number"
      ? retention.maxBlobBytes
      : undefined;
  if (
    (days !== undefined && (!Number.isFinite(days) || !Number.isInteger(days) || days < 1)) ||
    (maxBlobBytes !== undefined &&
      (!Number.isSafeInteger(maxBlobBytes) || maxBlobBytes < 64 * 1_024 * 1_024)) ||
    (settings.screenShareProtection !== undefined &&
      typeof settings.screenShareProtection !== "boolean")
  ) {
    return undefined;
  }

  return {
    pause: {
      paused: pause.paused,
      ...(typeof pause.resumeAt === "string" ? { resumeAt: pause.resumeAt } : {}),
    },
    rules: {
      ignoredBundleIds: [...rules.ignoredBundleIds],
      blockLikelySecrets: rules.blockLikelySecrets,
      contentRules,
    },
    retention: {
      days: typeof days === "number" ? days : defaultPrivacySettings.retention.days,
      maxBlobBytes:
        typeof maxBlobBytes === "number"
          ? maxBlobBytes
          : defaultPrivacySettings.retention.maxBlobBytes,
    },
    screenShareProtection:
      typeof settings.screenShareProtection === "boolean"
        ? settings.screenShareProtection
        : defaultPrivacySettings.screenShareProtection,
  };
}

export class ZToolsPrivacySettingsStore {
  constructor(private readonly database: ZToolsDocumentDatabase) {}

  async get(): Promise<PrivacySettings> {
    try {
      const document = await this.database.get(PRIVACY_DOCUMENT_ID);
      return (
        parsedPrivacySettings(document) ??
        structuredClone(defaultPrivacySettings)
      );
    } catch (error) {
      if (databaseStatus(error, 404)) {
        return structuredClone(defaultPrivacySettings);
      }
      throw error;
    }
  }

  async put(settings: PrivacySettings): Promise<void> {
    // Compile every rule before persistence so invalid or unsafe regexes never
    // become a startup-time failure.
    for (const rule of settings.rules.contentRules) {
      compileRule(rule);
    }
    if (
      !Number.isInteger(settings.retention.days) ||
      settings.retention.days < 1 ||
      settings.retention.days > 3_650
    ) {
      throw new RangeError("Retention days must be between 1 and 3650");
    }
    if (
      !Number.isSafeInteger(settings.retention.maxBlobBytes) ||
      settings.retention.maxBlobBytes < 64 * 1_024 * 1_024 ||
      settings.retention.maxBlobBytes > 100 * 1_024 * 1_024 * 1_024
    ) {
      throw new RangeError("Blob budget must be between 64 MiB and 100 GiB");
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      let current: unknown;
      try {
        current = await this.database.get(PRIVACY_DOCUMENT_ID);
      } catch (error) {
        if (!databaseStatus(error, 404)) {
          throw error;
        }
      }
      const revision =
        isRecord(current) && typeof current._rev === "string"
          ? current._rev
          : undefined;
      try {
        await this.database.put({
          _id: PRIVACY_DOCUMENT_ID,
          ...(revision === undefined ? {} : { _rev: revision }),
          type: "pasteboard-pro-privacy-settings",
          settings: structuredClone(settings),
        });
        return;
      } catch (error) {
        if (!databaseStatus(error, 409) || attempt === 2) {
          throw error;
        }
      }
    }
  }
}

export async function performDirectPaste(
  target: DirectPasteTarget,
  host: ClipboardPasteHost,
): Promise<DirectPasteResult> {
  const write = async (shouldPaste: boolean): Promise<void> => {
    if (target.type === "host") {
      await host.write(target.hostItemId, shouldPaste);
    } else {
      await host.writeContent(target.content, shouldPaste);
    }
  };

  try {
    await write(true);
    return { status: "pasted" };
  } catch (directPasteError) {
    await write(false);
    return {
      status: "accessibility_required",
      directPasteError: errorMessage(directPasteError),
    };
  }
}
