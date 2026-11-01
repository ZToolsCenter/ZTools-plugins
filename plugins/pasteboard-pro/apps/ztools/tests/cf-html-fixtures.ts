export type CfHtmlOptions = {
  context?: boolean; newline?: "\r\n" | "\n" | "\r"; before?: string; after?: string;
  sourceUrl?: string; extraHeader?: [string, string][]; duplicate?: string;
  selection?: boolean; blankSeparator?: boolean;
};
const pad = (n: number) => String(n).padStart(10, "0");
export function cfHtml(fragment = "<b>hello</b>", options: CfHtmlOptions = {}) {
  const nl = options.newline ?? "\r\n";
  const before = options.context === false ? "<!--StartFragment-->"
    : `<html><body>${options.before ?? ""}<!--StartFragment-->`;
  const after = options.context === false ? "<!--EndFragment-->"
    : `<!--EndFragment-->${options.after ?? ""}</body></html>`;
  const coreKeys = ["StartHTML", "EndHTML", "StartFragment", "EndFragment"];
  if (options.selection) coreKeys.push("StartSelection", "EndSelection");
  const header = (offsets: Record<string, number>) => {
    const lines = ["Version:1.0", ...coreKeys.map((key) => `${key}:${pad(offsets[key] ?? 0)}`)];
    if (options.sourceUrl !== undefined) lines.push(`SourceURL:${options.sourceUrl}`);
    for (const [key, value] of options.extraHeader ?? []) lines.push(`${key}:${value}`);
    if (options.duplicate !== undefined) lines.push(`${options.duplicate}:${pad(offsets[options.duplicate] ?? 0)}`);
    return lines.join(nl) + nl + (options.blankSeparator ? nl : "");
  };
  const initial = header({}); const headerLength = Buffer.byteLength(initial);
  const startFragment = headerLength + Buffer.byteLength(before);
  const endFragment = startFragment + Buffer.byteLength(fragment);
  const offsets = { StartHTML: headerLength, EndHTML: endFragment + Buffer.byteLength(after),
    StartFragment: startFragment, EndFragment: endFragment, StartSelection: startFragment, EndSelection: endFragment };
  let finalHeader = header(offsets);
  if (options.context === false) {
    finalHeader = finalHeader.replace(/StartHTML:[0-9]+/, "StartHTML:        -1")
      .replace(/EndHTML:[0-9]+/, "EndHTML:        -1");
  }
  return Buffer.from(finalHeader + before + fragment + after, "utf8");
}
export function replaceCfOffset(bytes: Uint8Array, key: string, value: string) {
  return Buffer.from(Buffer.from(bytes).toString("utf8").replace(new RegExp(`${key}:[^\\r\\n]*`), `${key}:${value}`));
}
