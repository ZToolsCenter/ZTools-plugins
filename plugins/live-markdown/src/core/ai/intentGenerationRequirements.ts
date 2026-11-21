import { resolveGenerationRequirements, type GenerationRequirements, type GenerationRequirementSkill } from "./generationRequirements";
import type { ValidatedIntent } from "./intentTypes";
import { isNegatedMention } from "./instructionConstraints";
import { maskQuotedInstruction, scanInstructionQuotes } from "./instructionLiteralEvidence";

import { isArtifactUsageQuestion } from "./artifactQuestion";
const RESPONSE_MEDIA_VERBS = "(?:举例|解释|说明|回答|回复|呈现|展示|演示|表达|illustrate|explain|answer|respond|present|display|show|demonstrate|an?\\s+example)";
const MEDIA = "(?<media>代码块|代码围栏|表格|latex(?:\\s*公式)?|公式|code\\s*(?:block|fence)|table|equation|formula)";
const RESPONSE_MEDIUM = new RegExp(`(?:请\\s*)?(?:用|使用|采用|以|use|using|as)\\s*(?:一个|一份|一张|an?\\s+)?(?:markdown\\s*)?${MEDIA}\\s*(?:(?:来|去|as|to)\\s*)?${RESPONSE_MEDIA_VERBS}`, "iu");
const PROVIDED_EXAMPLE = new RegExp(`(?:给出|提供|输出|provide|give)\\s*(?:一个|一份|一张|an?\\s+)?(?:markdown\\s*)?${MEDIA}[^\\r\\n。！？;；]{0,12}(?:示例|例子|举例|example)`, "iu");

function positiveMediumMatches(masked: string, quotes: ReturnType<typeof scanInstructionQuotes>): Array<{ match: RegExpExecArray; value: "table" | "math" | "code" }> {
  const matches: Array<{ match: RegExpExecArray; value: "table" | "math" | "code" }> = [];
  for (const pattern of [RESPONSE_MEDIUM, PROVIDED_EXAMPLE]) {
    const scanner = new RegExp(pattern.source, `${pattern.flags}g`);
    for (const match of masked.matchAll(scanner)) {
      const from = match.index ?? 0;
      const to = from + match[0].length;
      if (isNegatedMention(masked, from, to)) continue;
      const media = (match as RegExpExecArray).groups?.media;
      if (!media) continue;
      const value = /表格|\btable\b/iu.test(media) ? "table"
        : /latex|公式|equation|formula/iu.test(media) ? "math"
          : "code";
      matches.push({ match: match as RegExpExecArray, value });
    }
  }
  return matches.sort((left, right) => (left.match.index ?? 0) - (right.match.index ?? 0))
    .filter(({ match }) => {
      const from = match.index ?? 0;
      const to = from + match[0].length;
      return !quotes.some((quote) => from < quote.to + 1 && to > quote.from - 1);
    });
}

function answerMediumEvidence(masked: string, instruction: string): { artifact: GenerationRequirements["artifact"]; display: GenerationRequirements["display"] } | undefined {
  const matches = positiveMediumMatches(masked, scanInstructionQuotes(instruction));
  if (!matches.length) return undefined;
  const values = [...new Set(matches.map(({ value }) => value))];
  const evidence = matches.map(({ match }) => {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    return { from, to, raw: instruction.slice(from, to) };
  });
  return {
    artifact: values.length === 1
      ? { state: "explicit", value: values[0], evidence }
      : { state: "conflict", alternatives: values, evidence },
    display: { state: "unknown" }
  };
}

/** Applies format constraints after planning so discussed artifact names don't dictate answer format. */
export function resolveIntentGenerationRequirements(
  instruction: string,
  intent: ValidatedIntent,
  skill?: GenerationRequirementSkill
): GenerationRequirements {
  const semanticTask = intent.kind === "edit" || intent.kind === "answer"
    ? intent.content.mode === "generate" ? intent.content.task : "custom"
    : "custom";
  const requirements = resolveGenerationRequirements(instruction, semanticTask, skill);
  if (intent.kind !== "answer") return requirements;

  const quotes = scanInstructionQuotes(instruction);
  const masked = maskQuotedInstruction(instruction, quotes);
  const medium = answerMediumEvidence(masked, instruction);
  const discussedArtifact = isArtifactUsageQuestion(masked);
  return {
    ...requirements,
    artifact: discussedArtifact ? medium?.artifact ?? { state: "unknown" } : requirements.artifact,
    display: discussedArtifact ? medium?.display ?? { state: "unknown" } : requirements.display,
    // Action words such as “添加代码块” are part of the question, not content controls.
    contentInstruction: instruction
  };
}
