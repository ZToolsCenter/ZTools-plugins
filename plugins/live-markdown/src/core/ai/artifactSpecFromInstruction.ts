import type { ArtifactSpec } from "./artifactSpec";
import type { GenerationRequirements } from "./generationRequirements";
import {
  isArtifactSourceDependent,
  parseArtifactInstructionFields
} from "./artifactInstructionFields";
import { maskQuotedInstruction, scanInstructionQuotes } from "./instructionLiteralEvidence";
import { isArtifactUsageQuestion } from "./artifactQuestion";
import { resolveArtifactHeadingList } from "./artifactHeadingListEvidence";

export interface ArtifactSpecResolutionContext {
  effect: "edit" | "answer";
  operation?: string;
}

type ArtifactKind = ArtifactSpec["kind"];

const OUTPUT_FORMAT = [
  /(?:请)?(?:用|使用|采用|以|按)\s*(?:(?:Markdown|JSON|Python|JavaScript|TypeScript|Mermaid)\s*)?(?:代码块|代码围栏|表格|清单|列表|标题|公式|流程图|格式)(?:来)?(?:回答|输出|返回|展示|呈现|组织|列出)/iu,
  /(?:回答|回复|输出|返回|展示|呈现)(?:时)?\s*(?:使用|采用|为|成|以)?\s*(?:Markdown|JSON|Python|JavaScript|TypeScript|Mermaid|代码块|表格|清单|列表|标题|公式|流程图)(?:格式|代码块|表格|清单|列表|标题|公式|流程图)?/iu,
  /\b(?:answer|respond|reply|output|return|present|format)\b[^.!?。！？;；\n]{0,40}\b(?:in|as|using|with)\b[^.!?。！？;；\n]{0,24}\b(?:markdown|json|python|javascript|typescript|mermaid|code(?:\s+block)?|table|list|heading|formula|math|flowchart)\b/iu,
  /\b(?:use|format)\b[^.!?。！？;；\n]{0,28}\b(?:markdown|json|code(?:\s+block)?|table|list|heading|formula|math|mermaid)\b[^.!?。！？;；\n]{0,18}\b(?:answer|response|output)\b/iu
];

function hasExplicitOutputFormat(masked: string): boolean {
  return OUTPUT_FORMAT.some(pattern => pattern.test(masked));
}

function outputRequestedKind(masked: string): ArtifactKind | undefined {
  if (/(?:\bJSON\b|\bcode\s*(?:block|fence)\b|代码块|代码围栏)/iu.test(masked)) return "code";
  if (/(?:\btable\b|表格)/iu.test(masked)) return "table";
  if (/(?:\b(?:math|equation|formula)\b|公式)/iu.test(masked)) return "math";
  if (/(?:\bmermaid\b|流程图|架构图)/iu.test(masked)) return "mermaid";
  if (/(?:\blist\b|\bchecklist\b|清单|列表)/iu.test(masked)) return "list";
  if (/(?:\bheading\b|\btitle\b|\bH[1-6]\b|标题)/iu.test(masked)) return "heading";
  if (/\bmarkdown\b/iu.test(masked)) return "markdown";
  return undefined;
}

function requirementKind(requirements: GenerationRequirements): ArtifactKind | undefined {
  if (requirements.artifact.state !== "explicit") return undefined;
  return requirements.artifact.value;
}

function structureOnlyKind(masked: string, context: ArtifactSpecResolutionContext, outputFormat: boolean): ArtifactKind | undefined {
  const headingRequested = /(?:\b(?:h\s*[1-6]|heading\s*(?:level\s*)?[1-6]|level\s*[1-6](?:\s+heading)?)\b|[一二三四五六1-6]\s*级\s*标题|标题\s*[一二三四五六1-6])/iu.test(masked);
  const listRequested = /(?:清单|列表|bullet\s+list|ordered\s+list|unordered\s+list)/iu.test(masked);
  const structureAllowed = outputFormat || (context.effect === "edit" && context.operation === "insert");
  if (!structureAllowed) return undefined;
  if (headingRequested && /(?:代码(?:块|围栏)|\bcode\s*(?:block|fence)\b)/iu.test(masked) && /\b(?:markdown|md)\b/iu.test(masked)) return "code";
  if (headingRequested) return "heading";
  if (listRequested) return "list";
  return undefined;
}

function baseIssues(requirements: GenerationRequirements): string[] {
  const issues: string[] = [];
  if (requirements.artifact.state === "conflict" || requirements.artifact.state === "ambiguous") issues.push("conflicting_artifact_types");
  if (requirements.display.state === "conflict" || requirements.display.state === "ambiguous") issues.push("conflicting_display_modes");
  return issues;
}

/** Resolves only explicit artifact parameters, retaining exact UTF-16 evidence for each field. */
export function resolveArtifactSpec(
  instruction: string,
  requirements: GenerationRequirements,
  context: ArtifactSpecResolutionContext
): ArtifactSpec {
  const masked = maskQuotedInstruction(instruction, scanInstructionQuotes(instruction));
  const outputFormat = hasExplicitOutputFormat(masked) || !isArtifactUsageQuestion(masked) && requirements.artifact.state === "explicit" &&
    /生成|创建|整理成|转换|\b(?:create|generate|produce|convert)\b/iu.test(masked);
  const issues = baseIssues(requirements);
  const sourceDependent = isArtifactSourceDependent(instruction);
  const displaySource = requirements.display.state === "explicit" && requirements.display.value === "source";
  const orderedHeadingList = resolveArtifactHeadingList(instruction);

  // A question about how an artifact works does not request an artifact-shaped answer by itself.
  if (context.effect === "answer" && !outputFormat) {
    return { kind: "none", displaySource, sourceDependent, issues };
  }
  if (issues.includes("conflicting_artifact_types")) {
    return { kind: "none", displaySource, sourceDependent, issues };
  }

  const kind = requirementKind(requirements) ??
    (context.effect === "answer" && outputFormat ? outputRequestedKind(masked) : undefined) ??
    structureOnlyKind(masked, context, outputFormat) ??
    (orderedHeadingList.recognized && orderedHeadingList.onlyHeadings ? "heading" : undefined) ?? "none";
  if (kind === "none" || kind === "markdown") return { kind, displaySource, sourceDependent, issues };

  const parsed = parseArtifactInstructionFields(instruction, requirements, kind, sourceDependent);
  const headingList = kind === "heading" ? orderedHeadingList : undefined;
  const headingIssues = headingList?.issues ?? [];
  const shared = {
    displaySource,
    sourceDependent,
    composition: headingList?.recognized && headingList.onlyHeadings && !headingIssues.length && !sourceDependent
      ? "complete" as const : parsed.composition,
    issues: [...issues, ...parsed.issues, ...headingIssues]
  } as const;

  if (kind === "heading") {
    const heading = headingList?.headings[0] ?? parsed.heading ?? {};
    const headings = headingList?.recognized && (headingList.headings.length > 1 || headingIssues.length > 0)
      ? headingList.headings : undefined;
    return { ...shared, kind, heading, ...(headings ? { headings } : {}) };
  }
  if (kind === "code") {
    return {
      ...shared,
      kind,
      language: parsed.language,
      heading: parsed.heading,
      prefixHeading: parsed.prefixHeading,
      literalBody: parsed.literalBody,
      jsonBody: parsed.jsonBody,
      functionName: parsed.functionName
    };
  }
  if (kind === "table") return { ...shared, kind, columns: parsed.columns, rows: parsed.rows };
  if (kind === "list") return { ...shared, kind, ordered: parsed.ordered ?? false, count: parsed.count, items: parsed.items };
  if (kind === "math") return { ...shared, kind, display: parsed.display ?? false, equation: parsed.equation };
  return { ...shared, kind: "mermaid", graph: parsed.graph, direction: parsed.graphDirection };
}
