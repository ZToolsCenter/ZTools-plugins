export type ClipboardWindowRole = "primary" | "shelf" | "panel";

export function clipboardWindowRole(
  parameters: URLSearchParams,
): ClipboardWindowRole {
  if (parameters.get("shelf") === "1") return "shelf";
  if (parameters.has("panel")) return "panel";
  return "primary";
}

export function ownsClipboardHistoryMirror(
  role: ClipboardWindowRole,
): boolean {
  return role === "primary";
}
