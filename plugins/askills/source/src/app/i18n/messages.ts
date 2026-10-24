import english from "./en.json" with { type: "json" };
import chinese from "./zh-CN.json" with { type: "json" };
import type { Locale } from "../../lib/ipc/types";

export type Parameters = Record<string, string | number>;
export function translate(
  source: string,
  locale: Locale,
  parameters: Parameters = {},
): string {
  // Chinese overrides use the product's skill/skills terminology. Resolve the
  // message before interpolation so user names, paths and documents stay intact.
  const catalog = locale === "en" ? english : chinese;
  const message = Object.prototype.hasOwnProperty.call(catalog, source)
    ? (catalog as Record<string, string>)[source]
    : source;
  // One pass keeps names and paths containing braces literal.
  return message.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(parameters, name)
      ? String(parameters[name])
      : placeholder,
  );
}
