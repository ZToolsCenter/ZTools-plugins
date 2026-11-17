import type { GenerationRequirements } from "./generationRequirements";
import type { ArtifactSpec } from "./artifactSpec";
import { getArtifactHeadings } from "./artifactSpec";
import { stringifyArtifactJsonPayload } from "./artifactJsonPayload";
import {
  renderCodePayload,
  renderHeadingPayload,
  renderMathPayload,
  renderMermaidPayload,
  renderTablePayload
} from "./artifactRenderer";

export type ArtifactFillPayload =
  | { readonly kind: "code"; readonly body: string }
  | { readonly kind: "json"; readonly value: unknown }
  | { readonly kind: "table"; readonly rows: readonly (readonly string[])[] }
  | { readonly kind: "math"; readonly equation: string }
  | { readonly kind: "mermaid"; readonly nodes: readonly string[]; readonly edges: readonly { readonly from: number; readonly to: number }[] }
  | { readonly kind: "sections"; readonly bodies: Readonly<Record<string, string>> }
  | { readonly kind: "heading_body"; readonly body: string };

/** Renders generated data into fixed Markdown structure without claiming source evidence for that data. */
export function renderArtifactPayload(
  spec: ArtifactSpec,
  requirements: GenerationRequirements,
  payload: ArtifactFillPayload
): string | undefined {
  if (payload.kind === "sections") {
    const headings = spec.kind === "heading" && spec.headings
      ? getArtifactHeadings(spec)?.map(({ level, text }) => ({ text: text?.value ?? "", level: level?.value ?? 2 })) ?? []
      : requirements.requiredHeadings.map(({ text }) => ({ text, level: 2 as const }));
    const labels = headings.map(({ text }) => text);
    if (!headings.length || labels.some(text => !safeHeading(text)) || new Set(labels).size !== labels.length ||
        Object.keys(payload.bodies).length !== headings.length ||
        labels.some(text => typeof payload.bodies[text] !== "string" || !payload.bodies[text].trim())) return undefined;
    const rendered = headings.map(({ text, level }) => `${renderHeadingPayload(level, text)}\n\n${payload.bodies[text].trim()}`);
    return rendered.every(Boolean) ? rendered.join("\n\n") : undefined;
  }

  if (payload.kind === "heading_body") {
    if (spec.kind !== "heading" || typeof payload.body !== "string" || !payload.body.trim()) return undefined;
    if (spec.headings && spec.headings.length > 1) return undefined;
    const heading = spec.heading.level && spec.heading.text
      ? renderHeadingPayload(spec.heading.level.value, spec.heading.text.value) : undefined;
    return heading ? `${heading}\n\n${payload.body.trim()}` : undefined;
  }

  if (payload.kind === "code") {
    return spec.kind === "code" ? renderCodePayload(spec, payload.body) : undefined;
  }
  if (payload.kind === "json") {
    if (spec.kind !== "code" || spec.language?.value.toLowerCase() !== "json" || spec.jsonBody || spec.literalBody ||
        spec.heading || spec.functionName) return undefined;
    const body = stringifyArtifactJsonPayload(payload.value);
    return body === undefined ? undefined : renderCodePayload(spec, body);
  }
  if (payload.kind === "table") {
    return spec.kind === "table" && spec.columns?.length
      ? renderTablePayload(spec.columns.map(({ value }) => value), payload.rows) : undefined;
  }
  if (payload.kind === "math") {
    return spec.kind === "math" ? renderMathPayload(payload.equation, spec.display) : undefined;
  }
  if (payload.kind === "mermaid") {
    if (spec.kind !== "mermaid") return undefined;
    const direction = spec.graph?.direction ?? spec.direction?.value ?? "TD";
    return renderMermaidPayload(direction, payload.nodes, payload.edges);
  }
  return undefined;
}

function safeHeading(value: string): boolean {
  return value.trim().length > 0 && value.length <= 64 && !/[\r\n]/u.test(value);
}
