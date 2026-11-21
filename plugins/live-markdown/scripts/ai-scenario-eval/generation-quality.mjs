import { GFM, parser } from "@lezer/markdown";
import { evaluateMarkdownFormat } from "./generation-format.mjs";

const markdown = parser.configure(GFM);
const test = (pattern, value) => new RegExp(pattern, "iu").test(value);

/** Objective content/format rubric only; does not certify rendering or semantic completeness. */
export function evaluateGeneratedQuality(text, rubric, source = "") {
  if (!rubric) return { pass: null, reason: "No generation rubric applies." };
  if (typeof text !== "string" || !text.trim()) return { pass: false, reason: "No complete content result to assess.", failures: ["empty-output"] };
  const failures = [];
  if (text.includes("LOCAL_AI_")) failures.push("leaked-internal-protection-marker");
  for (const group of rubric.requiredGroups ?? []) {
    if (!group.some((pattern) => test(pattern, text))) failures.push(`missing-group:${JSON.stringify(group)}`);
  }
  for (const literal of rubric.requiredAll ?? []) {
    if (!text.includes(literal)) failures.push(`missing-bytes:${literal}`);
  }
  for (const pattern of rubric.forbiddenPatterns ?? []) {
    if (test(pattern, text)) failures.push(`forbidden:${pattern}`);
  }
  let last = -1;
  for (const token of rubric.ordered ?? []) {
    const index = text.indexOf(token);
    if (index < 0 || index <= last) failures.push(`missing-or-reordered:${token}`);
    last = index;
    if (index >= 0 && text.indexOf(token, index + token.length) >= 0) failures.push(`duplicated:${token}`);
  }
  if (rubric.maxCharacters && text.length > rubric.maxCharacters) failures.push("too-long");
  for (const match of text.matchAll(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?/gu)) {
    const normalized = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    if (rubric.allowedDates && !rubric.allowedDates.includes(normalized)) failures.push(`invented-date:${match[0]}`);
  }
  for (const amount of text.matchAll(/(\d+(?:\.\d+)?)\s*万(?:元)?/gu)) if (rubric.allowedAmounts && !rubric.allowedAmounts.includes(Number(amount[1]))) failures.push(`invented-amount:${amount[0]}`);
  const normalize = (value) => value.replace(/\s/gu, "");
  if (rubric.forbidFullSourceCopy && source.trim() && normalize(text).includes(normalize(source))) failures.push("duplicated-full-source");
  if (rubric.forbidSourceParagraphs && source.split(/\n\s*\n/u).some((paragraph) => paragraph.trim().length >= 30 && normalize(text).includes(normalize(paragraph)))) failures.push("duplicated-source-paragraph");
  const nodes = [];
  const cursor = markdown.parse(text).cursor();
  do { nodes.push({ name: cursor.name, from: cursor.from, to: cursor.to, raw: text.slice(cursor.from, cursor.to) }); } while (cursor.next());
  failures.push(...evaluateMarkdownFormat(text, rubric.markdownKind, nodes));
  return {
    pass: failures.length === 0,
    reason: failures.length ? failures.join("; ") : "Frozen objective content and Markdown-format rubric passed.",
    failures,
    semanticReview: "Independent human review is required for attribution, invented facts and usefulness beyond objective facts/format.",
    limits: "No generated code execution, Mermaid/LaTeX rendering, or native-host visual acceptance."
  };
}
