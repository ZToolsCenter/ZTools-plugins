import type { AiTaskAction } from "./aiTaskPrompts";

export interface AiAppendIntent {
  instruction: string;
  /** Only a quoted value or a single ASCII token is treated as exact text. */
  literal: string | null;
  requiresSplit?: true;
}

/** Recognizes a complete terminal-position command, never keywords inside prose. */
export function resolveAiAppendIntent(
  action: AiTaskAction,
  instruction: string | undefined,
  scope: "document" | "selection" | undefined
): AiAppendIntent | null {
  if (action !== "custom" || scope !== "document" || !instruction) return null;
  const command = instruction.trim();
  if (command.length > 2048 || /[\r\n]/.test(command)) return null;
  const chinese = /^(?:请|帮我)?(?:在)?(?:(?:当前)?(?:文件|文档|文章)的?)?(?:文末|末尾|底部|最后)(?:处)?(?:追加|添加|加上|加|插入|补充|写上)\s*[:：]?\s*(.+)$/u.exec(command);
  const english = /^(?:please\s+)?append\s+(.+?)\s+(?:at|to)\s+the\s+end(?:\s+of\s+(?:the\s+)?(?:document|file))?[.!]?$/i.exec(command);
  const payload = (chinese?.[1] ?? english?.[1])?.trim();
  if (!payload) return null;

  // Quotation must consume the entire payload. Text following it is a separate
  // instruction, so it must not silently become an append-only operation.
  const pairs: Array<[string, string]> = [["\"", "\""], ["'", "'"], ["“", "”"], ["‘", "’"]];
  for (const [open, close] of pairs) {
    if (!payload.startsWith(open)) continue;
    const end = payload.indexOf(close, open.length);
    if (end < 0) return { instruction: command, literal: null, requiresSplit: true };
    if (!/^[。.!！]?$/u.test(payload.slice(end + close.length).trim())) return { instruction: command, literal: null, requiresSplit: true };
    const literal = payload.slice(open.length, end);
    return literal.trim() ? { instruction: command, literal } : null;
  }

  // Preserve negative constraints on the old document. A recognized append
  // with other edits must fail closed, never fall back to rewriting the file.
  const operations = payload
    .replace(/(?:不要|不必|无需|不|勿)(?:再)?(?:修改|改动|删除|替换|重写|润色|校对|更改|影响|重复)(?:原文|正文|已有内容|现有内容|前文|全文|其他内容)/gu, "")
    .replace(/\b(?:do\s+not|don't|without)\s+(?:changing|change|editing|edit|removing|remove|deleting|delete|rewriting|rewrite)\s+(?:the\s+)?(?:original|existing|source)(?:\s+(?:text|document|content))?\b/gi, "")
    .trim().replace(/[，,]\s*$/, "");
  if (/[;；，,]/.test(operations) || /(?:然后|并且|同时|接着|顺手|顺便|顺带|另外|此外|之后|随后|但是|但把|但将|还要|还需|并把|并将|再把|再将)/u.test(operations) ||
    /(?:再|并|及)(?:删除|改写|修改|替换|移除|清空|合并|润色|校对|重写)/u.test(operations) ||
    /\b(?:then|also|and|but|additionally|plus)\b/i.test(operations)) {
    return { instruction: command, literal: null, requiresSplit: true };
  }
  const literal = /^[A-Za-z0-9][A-Za-z0-9_.!?-]{0,127}$/.test(payload) ? payload : null;
  return { instruction: command, literal };
}

/** A document-level append owns one new paragraph while preserving source bytes. */
export function prepareMarkdownAppend(source: string, text: string): string {
  if (!source) return text;
  const eol = source.includes("\r\n") ? "\r\n" : source.includes("\r") && !source.includes("\n") ? "\r" : "\n";
  const trailing = source.match(/(?:\r\n|\r|\n)*$/)?.[0].match(/\r\n|\r|\n/g)?.length ?? 0;
  const leading = text.match(/^(?:\r\n|\r|\n)*/)?.[0].match(/\r\n|\r|\n/g)?.length ?? 0;
  return eol.repeat(Math.max(0, 2 - trailing - leading)) + text;
}
