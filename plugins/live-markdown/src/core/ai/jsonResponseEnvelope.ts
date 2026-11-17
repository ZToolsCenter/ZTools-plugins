/** Removes one whole-response JSON transport fence, never searches for or repairs JSON. */
export function unwrapJsonResponseEnvelope(response: string): string {
  const source = response.trim();
  if (!source.startsWith("```")) return source;
  const open = /^```(?:json)?[ \t]*\r?\n/iu.exec(source);
  const close = /\r?\n```[ \t]*$/u.exec(source);
  if (!open || !close || close.index < open[0].length) {
    throw new SyntaxError("Incomplete or ambiguous JSON response envelope.");
  }
  const inner = source.slice(open[0].length, close.index).trim();
  if (!inner.startsWith("{") && !inner.startsWith("[")) {
    throw new SyntaxError("Incomplete or ambiguous JSON response envelope.");
  }
  return inner;
}
