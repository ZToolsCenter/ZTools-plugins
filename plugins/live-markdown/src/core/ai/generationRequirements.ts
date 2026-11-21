import type { InstructionConstraint, InstructionSpan } from "./intentContract";
import { deriveInstructionContract, isNegatedMention } from "./instructionConstraints";
import { maskQuotedInstruction, scanInstructionQuotes } from "./instructionLiteralEvidence";
import { hasSameAnchorSequentialArtifacts } from "./intentCompoundPolicy";
import { isExplanatoryTextAboutCode } from "./generatedCodeTask";
import type { IntentTask } from "./intentTypes";
import { resolveArtifactHeadingList } from "./artifactHeadingListEvidence";

export type GenerationArtifact = "markdown" | "table" | "code" | "math" | "mermaid";
export type GenerationDisplay = "rendered" | "source";
export type FactPolicy = "preserve" | "source_bound" | "allow_suggestions";

export interface GenerationRequirementSkill {
  category?: string;
  systemPrompt?: string;
}

export interface GenerationRequirements {
  artifact: InstructionConstraint<GenerationArtifact>;
  display: InstructionConstraint<GenerationDisplay>;
  factPolicy: FactPolicy;
  requiredHeadings: Array<{ text: string; evidence: InstructionSpan[] }>;
  constraints: Array<{ text: string; kind: "preserve" | "forbid" | "require"; evidence: InstructionSpan[] }>;
  /** Content-only text with evidenced action/position controls removed. */
  contentInstruction: string;
}

interface EvidenceMatch extends InstructionSpan {
  value: string;
}

function findMatches(source: string, pattern: RegExp, value: string): EvidenceMatch[] {
  pattern.lastIndex = 0;
  return [...source.matchAll(pattern)].flatMap((match) => {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (isNegatedMention(source, from, to)) return [];
    return [{ value, from, to, raw: source.slice(from, to) }];
  });
}

function constraintFromMatches<T extends string>(matches: EvidenceMatch[]): InstructionConstraint<T> {
  if (!matches.length) return { state: "unknown" };
  const values = [...new Set(matches.map(({ value }) => value))] as T[];
  const evidence = matches.map(({ from, to, raw }) => ({ from, to, raw }));
  return values.length === 1 ? { state: "explicit", value: values[0], evidence } : { state: "conflict", alternatives: values, evidence };
}

function artifactConstraint(instruction: string, masked: string): InstructionConstraint<GenerationArtifact> {
  const patterns: Array<[GenerationArtifact, RegExp]> = [
    ["table", /Markdown\s*表格|表格|\btable\b/giu],
    ["code", /代码块|代码围栏|源代码|代码|函数|\b(?:code|function|json)\b|\b(?:python|javascript|typescript)\b/giu],
    ["math", /方程式|公式|LaTeX|KaTeX|\bmath(?:ematical)?\b|\bequation\b/giu],
    ["mermaid", /Mermaid|流程图|架构图|\bdiagram\b/giu]
  ];
  const protection = /保留|保持|保护|原样保留|完整保留|不要修改|不要改变|不得修改|不得改变|keep|preserve|retain|protect|leave\s+(?:it|them)\s+as\s+is/giu;
  const production = /生成|创建|制作|输出|编写|撰写|绘制|画出|新增|追加|添加|增加|插入|写入|放入|实现|定义|提供|给出|展示|显示|使用|采用|用|加|转成|转换成|转换为|整理成|整理为|表达|create|generate|produce|write|draw|render|make|output|append|insert|add|implement|define|provide|display|use|using|convert\s+to|as\s+(?:a|an)\b/giu;
  const positivelyRequested = (from: number, to: number, value: GenerationArtifact): boolean => {
    const clauseStart = Math.max(masked.lastIndexOf("。", from), masked.lastIndexOf("！", from), masked.lastIndexOf("？", from), masked.lastIndexOf(";", from), masked.lastIndexOf("；", from), masked.lastIndexOf("\n", from)) + 1;
    const clauseEndCandidates = ["。", "！", "？", ";", "；", "\n"].map((delimiter) => masked.indexOf(delimiter, to)).filter((index) => index >= 0);
    const clauseEnd = clauseEndCandidates.length ? Math.min(...clauseEndCandidates) : masked.length;
    const clause = masked.slice(clauseStart, clauseEnd);
    const localFrom = from - clauseStart;
    const before = clause.slice(0, localFrom);
    protection.lastIndex = 0;
    production.lastIndex = 0;
    const protectiveMatches = [...before.matchAll(protection)];
    const productionMatches = [...before.matchAll(production)];
    const latestProtection = protectiveMatches.at(-1)?.index ?? -1;
    const latestProduction = productionMatches.at(-1)?.index ?? -1;
    if (latestProtection > latestProduction) return false;
    if (latestProduction < 0) return false;
    // A Mermaid code fence is the container syntax for the Mermaid artifact.
    // It does not add a second, conflicting request for a general code artifact.
    if (value === "code" && /(?:mermaid|流程图|架构图|\bdiagram\b)[^。！？；;\n]{0,32}(?:代码围栏|代码块|code\s*fence)/iu.test(clause)) return false;
    return true;
  };
  const matches = patterns.flatMap(([value, pattern]) => findMatches(masked, pattern, value))
    .filter(({ from, value }) => value !== "code" || !isExplanatoryTextAboutCode(masked, from))
    .filter(({ from, to, value }) => positivelyRequested(from, to, value as GenerationArtifact))
    .map(({ value, from, to }) => ({
    value,
    from,
    to,
    raw: instruction.slice(from, to)
  }));
  if (hasSameAnchorSequentialArtifacts(masked) && matches.some(({ value }) => value !== matches[0]?.value)) {
    return { state: "unknown" };
  }
  return constraintFromMatches<GenerationArtifact>(matches);
}

function displayConstraint(instruction: string, masked: string): InstructionConstraint<GenerationDisplay> {
  const matches = [
    ...findMatches(masked, /(?:以\s*)?Markdown\s*源码(?:模式|格式|展示|显示)?|源码模式|源码格式|源码展示|原始\s*Markdown|\b(?:markdown\s+source|raw\s+markdown|source\s+mode)\b/giu, "source"),
    ...findMatches(masked, /(?:实时)?预览(?:模式|显示|效果)?|渲染(?:模式|显示|效果)?|\b(?:rendered\s+view|preview\s+mode)\b/giu, "rendered")
  ].map(({ value, from, to }) => ({ value, from, to, raw: instruction.slice(from, to) }));
  return constraintFromMatches<GenerationDisplay>(matches);
}

function headingRequirements(instruction: string, masked: string, semanticTask?: IntentTask): GenerationRequirements["requiredHeadings"] {
  const explicitList = resolveArtifactHeadingList(instruction);
  if (explicitList.recognized) {
    return explicitList.headings.flatMap(({ text }) => text
      ? [{ text: text.value, evidence: [...text.evidence] }] : []);
  }
  const patterns = [
    /(?:使用|包含|采用|包括)\s*([^。！？；;\n]{1,120}?)\s*(?:[0-9一二三四五六七八九十]+\s*个?\s*)?(?:Markdown\s*)?标题/giu,
    /(?:按顺序\s*)?(?:用|使用|采用)\s*(?:Markdown\s*)?(?:小标题|章节标题|headings?|sections?)\s*(?:为|是|[:：])?\s*([^。！？；;\n]{1,120}?)\s*(?:按顺序\s*)?(?:组织|安排|排列|依次组织|organize|organise|structure)/giu
  ];
  const result: GenerationRequirements["requiredHeadings"] = [];
  for (const pattern of patterns) {
    for (const match of masked.matchAll(pattern)) {
      const from = match.index ?? 0;
      const rawList = match[1].replace(/(?:[0-9一二三四五六七八九十]+\s*个?\s*)?Markdown\s*$/iu, "");
      const listOffset = from + match[0].indexOf(match[1]);
      const separator = /(?:[、，,]|\s+and\s+|(?<=\S)(?:和|及)(?=\S))/giu;
      const values: Array<{ text: string; from: number; to: number }> = [];
      let cursor = 0;
      for (const delimiter of rawList.matchAll(separator)) {
        const segment = rawList.slice(cursor, delimiter.index ?? cursor);
        const leading = segment.length - segment.trimStart().length;
        const trailing = segment.trimEnd().length;
        const token = segment.trim().replace(/^[“‘「『"']|[”’」』"']$/gu, "");
        if (!token) { values.length = 0; break; }
        values.push({ text: token, from: listOffset + cursor + leading, to: listOffset + cursor + trailing });
        cursor = (delimiter.index ?? cursor) + delimiter[0].length;
      }
      if (values.length || cursor) {
        const segment = rawList.slice(cursor);
        const leading = segment.length - segment.trimStart().length;
        const trailing = segment.trimEnd().length;
        const token = segment.trim().replace(/^[“‘「『"']|[”’」』"']$/gu, "");
        if (token) values.push({ text: token, from: listOffset + cursor + leading, to: listOffset + cursor + trailing });
        else values.length = 0;
      } else {
        const token = rawList.trim().replace(/^[“‘「『"']|[”’」』"']$/gu, "");
        if (token) {
          const leading = rawList.length - rawList.trimStart().length;
          values.push({ text: token, from: listOffset + leading, to: listOffset + leading + token.length });
        }
      }
      if (!values.length || values.length > 8 || values.some(({ text }) => text.length > 64 || /[\r\n#`<>]/u.test(text))) continue;
      for (const value of values) {
        if (!result.some((item) => item.text === value.text)) {
          const raw = instruction.slice(value.from, value.to);
          result.push({ text: value.text, evidence: [{ from: value.from, to: value.to, raw }] });
        }
      }
    }
  }
  // In explicit technical-spec tasks, a short enumerated canonical section list
  // is itself a heading contract even when the user omits the word "标题".
  // Keep this gated by task and vocabulary so summary fields are not mistaken
  // for document headings.
  if (!result.length && semanticTask === "tech-spec") {
    const canonical = "(?:目标|方案|风险|背景|架构|实施计划|步骤|结论|测试|验证|回滚|监控|安全|成本)";
    const implicit = new RegExp(`(?:包含|包括)\\s*(${canonical}(?:\\s*[、，,和及]\\s*${canonical}){1,5})`, "gu");
    for (const match of masked.matchAll(implicit)) {
      const from = match.index ?? 0;
      const names = match[1].split(/[、，,和及]/u).map((name) => name.trim()).filter(Boolean);
      const evidence = [{ from, to: from + match[0].length, raw: instruction.slice(from, from + match[0].length) }];
      for (const name of names) if (!result.some((item) => item.text === name)) result.push({ text: name, evidence });
    }
  }
  return result;
}

function constraintRequirements(instruction: string, masked: string): GenerationRequirements["constraints"] {
  const rules: Array<{ kind: "preserve" | "forbid" | "require"; pattern: RegExp }> = [
    { kind: "preserve", pattern: /(?:严格基于|只依据|仅依据|根据|沿用|保留)[^。！？；;\n]{1,64}(?:原文|上下文|本文|事实|约束)[^。！？；;\n]*/giu },
    { kind: "forbid", pattern: /(?:不要|不得|不准|禁止|避免|不允许|不能)[^。！？；;\n]{1,72}/giu },
    { kind: "require", pattern: /(?:必须|务必|确保|包含|包括|列出|保留|至少)[^。！？；;\n]{1,72}/giu }
  ];
  const result: GenerationRequirements["constraints"] = [];
  for (const { kind, pattern } of rules) {
    for (const match of masked.matchAll(pattern)) {
      const from = match.index ?? 0;
      const to = from + match[0].length;
      if (isNegatedMention(masked, from, to)) continue;
      const text = instruction.slice(from, to);
      if (!result.some((item) => item.kind === kind && item.text === text)) {
        result.push({ text, kind, evidence: [{ from, to, raw: text }] });
      }
    }
  }
  return result.sort((left, right) => left.evidence[0].from - right.evidence[0].from);
}

function isNestedContentAction(
  masked: string,
  action: InstructionSpan,
  artifactEvidence: InstructionSpan[]
): boolean {
  const markerPattern = /里面|内部|其中|(?:代码(?:块)?|函数|表格|图表|公式|段落)(?:里|中|内|内部)|\b(?:inside|within|containing|in\s+(?:the\s+)?(?:code|function|block|table|diagram|formula|paragraph))\b/giu;
  const markers = [...masked.slice(0, action.from).matchAll(markerPattern)];
  const marker = markers.at(-1);
  if (!marker) return false;
  const markerFrom = marker.index ?? 0;
  const markerTo = markerFrom + marker[0].length;
  if (!artifactEvidence.some(({ to }) => to <= markerFrom)) return false;
  return !/[。！？；;\n]/u.test(masked.slice(markerTo, action.from));
}

function inferredFactPolicy(
  masked: string,
  semanticTask?: IntentTask,
  skill?: GenerationRequirementSkill
): FactPolicy {
  const suggests = /建议|提出.{0,12}(?:检查|行动|方案)|下一步|行动项|recommend|suggest|next\s+step/iu.test(masked);
  if (suggests || semanticTask === "continue" || /continue|suggest|recommend/iu.test(skill?.category ?? "")) return "allow_suggestions";
  if (["summarize", "tech-spec", "diagram"].includes(semanticTask ?? "") || /summary|summar|tech.?spec|diagram|table/iu.test(skill?.category ?? "")) return "source_bound";
  return "preserve";
}

function contentControlSpans(instruction: string, masked: string, artifact: InstructionConstraint<GenerationArtifact>): InstructionSpan[] {
  const contract = deriveInstructionContract(instruction);
  // Ambiguous or conflicting edit verbs describe more than one user action.
  // Keep their complete wording so stripping one action's target cannot erase
  // the content of another action (for example, the "全文" in "润色全文").
  const preserveCompoundInstruction = contract.operation.state === "ambiguous" || contract.operation.state === "conflict";
  const spans: InstructionSpan[] = [];
  if (!preserveCompoundInstruction && contract.target.state === "explicit") spans.push(...contract.target.evidence);
  if (!preserveCompoundInstruction && contract.operation.state === "explicit") {
    const artifactEvidence = [
      ...(contract.layout.state === "explicit" ? contract.layout.evidence : []),
      ...(artifact.state === "explicit" ? artifact.evidence : [])
    ];
    spans.push(...contract.operation.evidence.filter((action) => !isNestedContentAction(masked, action, artifactEvidence)));
  }
  if (!preserveCompoundInstruction && contract.layout.state === "explicit") {
    // A code block/fence is both the layout signal and the requested output
    // format. Keep it in the content brief instead of stripping it as a control.
    spans.push(...contract.layout.evidence.filter(({ raw }) => !/(?:代码块|代码围栏|\bcode\s*(?:block|fence)\b)/iu.test(raw)));
  }

  const controlPatterns = [
    /(?:在|于|到)\s*(?:全文|整篇|全篇|通篇|文档|文章|文件)?\s*(?:的)?(?:文末|末尾|末端|底部|底端|结尾|最后|正文开头|开头)/giu,
    /(?:生成|创建|制作|输出|编写|撰写|绘制|画出|create|generate|produce|write)\s*(?=(?:一个|一份|一张|一段|Markdown\s*)?(?:表格|代码|函数|公式|技术方案|Mermaid|流程图|架构图|段落|\btable\b|\bcode\b|\bfunction\b|\bequation\b))/giu
  ];
  if (!preserveCompoundInstruction) {
    for (const pattern of controlPatterns) {
      for (const match of masked.matchAll(pattern)) {
        const from = match.index ?? 0;
        const to = from + match[0].length;
        if (!isNegatedMention(masked, from, to)) spans.push({ from, to, raw: instruction.slice(from, to) });
      }
    }
  }
  // Remove classifier words that only belong to the editor action ("add one
  // Python code block"), while retaining the artifact and its format.
  const insertionVerbs = new Set(["追加", "添加", "增加", "新增", "新建", "插入", "加入", "写入", "放入", "加上", "加", "补上", "append", "insert", "add", "write"]);
  const actionWithClassifier = spans.filter(({ raw }) => insertionVerbs.has(raw.toLowerCase()));
  for (const action of actionWithClassifier) {
    const suffix = masked.slice(action.to);
    const classifier = /^\s*(?:一个|一份|一张|个|份|张)\s*(?=(?:(?:Markdown\s*(?:的\s*)?)?(?:Python\s*)?(?:代码块|代码围栏|表格|函数|公式|Mermaid|流程图|架构图|段落|\b(?:table|code\s*(?:block|fence)|function|equation)\b)))/iu.exec(suffix);
    if (!classifier) continue;
    const to = action.to + classifier[0].length;
    spans.push({ from: action.from, to, raw: instruction.slice(action.from, to) });
  }
  return spans.filter((item, index, all) =>
    all.findIndex((other) => other.from === item.from && other.to === item.to) === index);
}

function removeEvidenceSpans(instruction: string, spans: InstructionSpan[]): string {
  const quotes = scanInstructionQuotes(instruction);
  const ranges = spans
    .filter(({ from, to, raw }) =>
      from >= 0 && to <= instruction.length && to >= from && instruction.slice(from, to) === raw &&
      !quotes.some((quote) => from < quote.to + 1 && to > quote.from - 1))
    .map(({ from, to }) => ({ from, to }))
    .sort((left, right) => left.from - right.from || left.to - right.to);
  let result = "";
  let cursor = 0;
  for (const range of ranges) {
    if (range.to <= cursor) continue;
    if (range.from > cursor) result += instruction.slice(cursor, range.from);
    cursor = Math.max(cursor, range.to);
  }
  result += instruction.slice(cursor);
  return result.replace(/^[\s，,。；;：:]+|[\s，,。；;：:]+$/gu, "");
}

/** Resolves format and factual constraints from unquoted instruction evidence and explicit task defaults. */
export function resolveGenerationRequirements(
  instruction: string,
  semanticTask?: IntentTask,
  skill?: GenerationRequirementSkill
): GenerationRequirements {
  const quotes = scanInstructionQuotes(instruction);
  const masked = maskQuotedInstruction(instruction, quotes);
  const sourceBound = /严格基于|只依据|仅依据|仅使用原文|不要添加新事实|不得新增事实|source[- ]bound|facts?\s+only\s+from\s+(?:the\s+)?source/iu.test(masked);
  const suggestions = /建议|提出.{0,12}(?:检查|行动|方案)|下一步|行动项|recommend|suggest|next\s+step/iu.test(masked);
  const preserve = /不改变事实|保留原文事实|数字和日期保持|preserve\s+facts/iu.test(masked);
  const factPolicy = sourceBound ? "source_bound" : suggestions ? "allow_suggestions" : preserve ? "preserve" : inferredFactPolicy(masked, semanticTask, skill);
  const artifact = artifactConstraint(instruction, masked);
  return {
    artifact,
    display: displayConstraint(instruction, masked),
    factPolicy,
    requiredHeadings: headingRequirements(instruction, masked, semanticTask),
    constraints: constraintRequirements(instruction, masked),
    contentInstruction: removeEvidenceSpans(instruction, contentControlSpans(instruction, masked, artifact))
  };
}
