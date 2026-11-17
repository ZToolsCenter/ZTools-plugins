export interface SlashCommandLineTransaction {
  from: number;
  to: number;
  insert: string;
  cursor: number;
}

/**
 * Replaces the active source line with a standalone TOC paragraph while
 * retaining any prose on either side as separate paragraphs.
 */
export function buildTocSlashCommandTransaction(
  lineFrom: number,
  lineText: string,
  replaceFrom: number,
  replaceTo: number
): SlashCommandLineTransaction {
  const prefix = lineText.slice(0, replaceFrom - lineFrom);
  const suffix = lineText.slice(replaceTo - lineFrom);
  const leading = prefix.length > 0 ? `${prefix}\n\n` : "";
  const trailing = suffix.length > 0 ? `\n${suffix}` : "";
  const insert = `${leading}[toc]\n${trailing}`;
  const cursor = lineFrom + leading.length + "[toc]\n".length;

  return {
    from: lineFrom,
    to: lineFrom + lineText.length,
    insert,
    cursor
  };
}
