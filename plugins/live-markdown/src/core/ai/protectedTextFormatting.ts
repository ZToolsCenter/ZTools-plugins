import { applyPanguSpacing } from "./agentOrchestrator";

/** Formats generated prose and applies boundary spacing without ever changing protected bytes. */
export function applyPanguSpacingOutsideProtectedTokens(text: string, mask: string, protectedValues: string[]): string {
  const escapedMask = mask.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tokenPattern = new RegExp(`(${escapedMask}\\d+__)`, "g");
  const parts = text.split(tokenPattern);
  let output = "";
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (index % 2 === 0) {
      output += applyPanguSpacing(part);
      continue;
    }

    const valueIndex = Number(part.slice(mask.length, -2));
    const original = protectedValues[valueIndex] || "";
    const previous = Array.from(output).at(-1) || "";
    const first = Array.from(original)[0] || "";
    if (/[\u3400-\u9fff]/.test(previous) && /[a-zA-Z0-9]/.test(first) && !/\s/.test(previous)) output += " ";
    output += part;

    const nextPart = parts[index + 1] || "";
    const last = Array.from(original).at(-1) || "";
    const next = Array.from(nextPart)[0] || "";
    if (/[a-zA-Z0-9]/.test(last) && /[\u3400-\u9fff]/.test(next) && !/\s/.test(next)) output += " ";
  }

  const tokens = text.match(tokenPattern) ?? [];
  if (tokens.some((token) => output.split(token).length !== 2)) {
    throw new Error("格式整理改变了受保护区域标记，结果不可应用，请重试。");
  }
  return output;
}
