import type { ClipboardContentRule } from "../preload/privacy";

export function lines(values: readonly string[]): string {
  return values.join("\n");
}

export function parseLines(value: string): string[] {
  return [...new Set(value.split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean))];
}

export function serializeContentRules(rules: readonly ClipboardContentRule[]): string {
  return rules
    .map((rule) => `${rule.type}:${rule.value}${rule.type === "regex" && rule.flags ? `/${rule.flags}` : ""}`)
    .join("\n");
}

export function parseContentRules(value: string): ClipboardContentRule[] {
  return parseLines(value).map((line) => {
    const separator = line.indexOf(":");
    const type = separator > 0 ? line.slice(0, separator).toLowerCase() : "literal";
    let pattern = separator > 0 ? line.slice(separator + 1).trim() : line;
    if (type === "regex") {
      const flagsMatch = pattern.match(/^(.*)\/([imsu]+)$/u);
      if (flagsMatch !== null) {
        pattern = flagsMatch[1] ?? "";
        const flags = flagsMatch[2];
        return flags === undefined
          ? { type: "regex", value: pattern }
          : { type: "regex", value: pattern, flags };
      }
      return { type: "regex", value: pattern };
    }
    if (type === "wildcard") {
      return { type: "wildcard", value: pattern };
    }
    return { type: "literal", value: pattern };
  });
}
