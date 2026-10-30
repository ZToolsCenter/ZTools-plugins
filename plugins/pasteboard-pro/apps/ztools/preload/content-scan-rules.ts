import { RE2JS } from "re2js";

type ScanContentRuleV2 = Readonly<{
  type: "literal" | "wildcard" | "regex";
  value: string;
  flags?: string;
}>;

type ScanPolicyRulesV2 = Readonly<{
  blockLikelySecrets: boolean;
  contentRules: readonly ScanContentRuleV2[];
}>;

type TextMatcher = Readonly<{ test(value: string): boolean }>;

export type CompiledScanPolicyV2 = Readonly<{
  matches(value: string): boolean;
}>;

const MAX_RULE_LENGTH = 256;
const MAX_RULE_COUNT = 32;

// Keep these patterns aligned with privacy.ts. They are compiled by RE2JS only
// when the worker compiles a validated policy; user supplied patterns never use
// JavaScript's backtracking RegExp engine.
const LIKELY_SECRET_PATTERNS: readonly Readonly<{
  pattern: string;
  flags: string;
}>[] = [
  { pattern: String.raw`\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b`, flags: "iu" },
  { pattern: String.raw`\bAKIA[0-9A-Z]{16}\b`, flags: "u" },
  {
    pattern: String.raw`-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----`,
    flags: "u",
  },
  { pattern: String.raw`\bgh[opsu]_[A-Za-z0-9]{30,}\b`, flags: "u" },
  {
    pattern: String.raw`\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b`,
    flags: "u",
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compileRegex(pattern: string, flags: string): TextMatcher | undefined {
  if (pattern.length === 0 || pattern.length > MAX_RULE_LENGTH || flags.length > 4) {
    return undefined;
  }

  const allowed = new Set(["i", "m", "s", "u"]);
  const seen = new Set<string>();
  for (const flag of flags) {
    if (!allowed.has(flag) || seen.has(flag)) return undefined;
    seen.add(flag);
  }

  let re2Flags = 0;
  if (seen.has("i")) re2Flags |= RE2JS.CASE_INSENSITIVE;
  if (seen.has("m")) re2Flags |= RE2JS.MULTILINE;
  if (seen.has("s")) re2Flags |= RE2JS.DOTALL;

  try {
    return RE2JS.compile(pattern, re2Flags);
  } catch {
    // Never retain or forward a compiler error that could include policy data.
    return undefined;
  }
}

function collapseAdjacentStars(pattern: string): string {
  let result = "";
  let previousWasStar = false;
  for (const character of pattern) {
    if (character === "*") {
      if (previousWasStar) continue;
      previousWasStar = true;
    } else {
      previousWasStar = false;
    }
    result += character;
  }
  return result;
}

function wildcardMatches(pattern: string, input: string): boolean {
  const patternCharacters = [...pattern.toLowerCase()];
  const inputCharacters = [...input.toLowerCase()];
  let patternIndex = 0;
  let inputIndex = 0;
  let starIndex = -1;
  let starInputIndex = 0;

  while (inputIndex < inputCharacters.length) {
    const character = patternCharacters[patternIndex];
    if (
      character === "?" ||
      (character !== undefined && character === inputCharacters[inputIndex])
    ) {
      patternIndex += 1;
      inputIndex += 1;
      continue;
    }
    if (character === "*") {
      starIndex = patternIndex;
      starInputIndex = inputIndex;
      patternIndex += 1;
      continue;
    }
    if (starIndex >= 0) {
      patternIndex = starIndex + 1;
      starInputIndex += 1;
      inputIndex = starInputIndex;
      continue;
    }
    return false;
  }

  while (patternCharacters[patternIndex] === "*") patternIndex += 1;
  return patternIndex === patternCharacters.length;
}

function compileUserRule(value: unknown): TextMatcher | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.value !== "string" ||
    value.value.length === 0 ||
    value.value.length > MAX_RULE_LENGTH
  ) {
    return undefined;
  }

  if (value.type === "literal") {
    const literal = value.value.toLowerCase();
    return { test: (input) => input.toLowerCase().includes(literal) };
  }

  if (value.type === "wildcard") {
    const pattern = collapseAdjacentStars(value.value);
    return { test: (input) => wildcardMatches(pattern, input) };
  }

  if (value.type === "regex") {
    if (value.flags !== undefined && typeof value.flags !== "string") {
      return undefined;
    }
    return compileRegex(value.value, value.flags ?? "");
  }

  return undefined;
}

/**
 * Compile bounded V1-compatible rules for a worker thread. An undefined result
 * means the policy is invalid or unsupported and the caller must report every
 * requested scope as not-scanned.
 */
export function compileScanPolicyV2(
  policy: ScanPolicyRulesV2 | unknown,
): CompiledScanPolicyV2 | undefined {
  if (
    !isRecord(policy) ||
    typeof policy.blockLikelySecrets !== "boolean" ||
    !Array.isArray(policy.contentRules) ||
    policy.contentRules.length > MAX_RULE_COUNT
  ) {
    return undefined;
  }

  const matchers: TextMatcher[] = [];
  if (policy.blockLikelySecrets) {
    for (const secret of LIKELY_SECRET_PATTERNS) {
      const matcher = compileRegex(secret.pattern, secret.flags);
      if (matcher === undefined) return undefined;
      matchers.push(matcher);
    }
  }

  for (const rule of policy.contentRules) {
    const matcher = compileUserRule(rule);
    if (matcher === undefined) return undefined;
    matchers.push(matcher);
  }

  return {
    matches(value) {
      return matchers.some((matcher) => matcher.test(value));
    },
  };
}
