import type { InstructionSpan } from "./intentContract";
import type { AiOutputFormat } from "./aiOutputContract";

/** A normalized parameter whose original wording remains available for validation. */
export interface ArtifactField<T> {
  readonly value: T;
  readonly evidence: readonly InstructionSpan[];
}

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export interface ArtifactHeading {
  readonly level?: ArtifactField<HeadingLevel>;
  readonly text?: ArtifactField<string>;
}

interface ArtifactBase {
  readonly displaySource: boolean;
  readonly sourceDependent: boolean;
  /** Partial specifications must still use content generation rather than dropping extra requirements. */
  readonly composition?: "complete" | "partial";
  /** Conflicting or incomplete explicit parameters, never a guessed successful specification. */
  readonly issues: readonly string[];
}

export type ArtifactSpec = ArtifactBase & (
  | { readonly kind: "none" | "markdown" }
  | { readonly kind: "heading";
      /** Legacy first-heading alias. When `headings` exists, it must equal its first item. */
      readonly heading: ArtifactHeading;
      /** Complete ordered heading collection, including the legacy `heading` alias. */
      readonly headings?: readonly ArtifactHeading[] }
  | { readonly kind: "code"; readonly language?: ArtifactField<string>;
      readonly heading?: ArtifactHeading; readonly prefixHeading?: ArtifactHeading; readonly literalBody?: ArtifactField<string>;
      readonly jsonBody?: ArtifactField<unknown>; readonly functionName?: ArtifactField<string> }
  | { readonly kind: "table"; readonly columns?: readonly ArtifactField<string>[];
      readonly rows?: readonly (readonly ArtifactField<string>[])[] }
  | { readonly kind: "list"; readonly items?: readonly ArtifactField<string>[];
      readonly ordered: boolean; readonly count?: ArtifactField<number> }
  | { readonly kind: "math"; readonly equation?: ArtifactField<string>; readonly display: boolean }
  | { readonly kind: "mermaid"; readonly graph?: {
      readonly direction: "LR" | "TD";
      readonly nodes: readonly ArtifactField<string>[];
      readonly edges: readonly { readonly from: number; readonly to: number }[];
    }; readonly direction?: ArtifactField<"LR" | "TD"> }
);

function sameField<T>(left: ArtifactField<T> | undefined, right: ArtifactField<T> | undefined): boolean {
  if (!left || !right) return left === right;
  return Object.is(left.value, right.value) && left.evidence.length === right.evidence.length &&
    left.evidence.every((span, index) => {
      const other = right.evidence[index];
      return span.from === other.from && span.to === other.to && span.raw === other.raw;
    });
}

function sameHeading(left: ArtifactHeading, right: ArtifactHeading): boolean {
  return sameField(left.level, right.level) && sameField(left.text, right.text);
}

/** Returns the complete ordered heading set after verifying its legacy first-item alias. */
export function getArtifactHeadings(spec: Extract<ArtifactSpec, { kind: "heading" }>): readonly ArtifactHeading[] | undefined {
  if (!spec.headings) return [spec.heading];
  if (spec.headings.length < 2 || spec.headings.length > 8 || !sameHeading(spec.heading, spec.headings[0])) return undefined;
  return spec.headings;
}

export function artifactOutputFormat(spec: ArtifactSpec): AiOutputFormat {
  return spec.kind === "heading" || spec.kind === "list" ? "none" : spec.kind;
}

export function artifactFieldIsGrounded<T>(instruction: string, field: ArtifactField<T>): boolean {
  return field.evidence.length > 0 && field.evidence.every(({ from, to, raw }) =>
    Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to > from && to <= instruction.length &&
    instruction.slice(from, to) === raw);
}
