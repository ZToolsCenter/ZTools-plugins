import { isNegatedMention } from "./instructionConstraints";
import { maskQuotedInstruction, scanInstructionQuotes } from "./instructionLiteralEvidence";
import { hasExplicitSourceReusePermission } from "./sourceReusePolicy";
import type { ArtifactSpec } from "./artifactSpec";

const SOURCE_REFERENCES = /原文|本文|全文|这段(?:话|文字|内容|材料)|当前(?:文档|内容|选区|选择)|(?:这个|此|该|本)文档|文档(?:内容|中的)|文稿|文章|上下文|上文|前文|所选(?:内容|文本|片段|代码)|选中(?:的)?(?:内容|文本|片段|代码)|(?:本|这个|该|当前)项目|(?:上面|上述|现有|已有|原有|原|既有|此前|之前|当前)(?:的)?(?:接口|API|实现|代码|配置|函数|模块|字段(?:名)?|参数|变量|命名|schema|模式|类型|定义|结构|数据)|(?:上面|上述)(?:的)?(?:文档|内容)|(?:上述|上面|以上|这个|此|该|这些|那些)(?:的)?(?:功能|示例|例子|算法|方法|函数|接口|实现|设计|方案|内容|特性|行为|需求|结构|数据|程序|逻辑|流程)|\b(?:this|that|current|existing|original|previous|above|aforementioned|the)\s+(?:project|interface|api|implementation|code|configuration|document|text|selection|function|example|feature|algorithm|method|behavior|requirement|module|approach|field(?:\s+name)?|parameter|variable|naming|schema|type|definition|structure|data|article|content|source)\b|\b(?:this|our|the)\s+project\b|\b(?:current|selected)\s+(?:text|content|selection)\b|\b(?:its|their)\s+(?:contents?|text|body|details|information)\b|\b(?:source|fact)(?:\/fact)?[- ]bound\b/giu;
// Positional references identify where to insert, not what document content to read.
// Mask only the target span so nearby requests to summarize, read, or reuse content stay visible.
const DOCUMENT_TARGET_LOCATIONS = [
  /\b(?:at|to|near|in)\s+(?:(?:(?:the\s+)?(?:this|current)|the)\s+)?(?:document\s+(?:end|bottom|top|beginning|start)|(?:end|bottom|top|beginning|start)\s+of\s+(?:(?:(?:the\s+)?(?:this|current)|the)\s+)?document)\b/giu,
  /(?:(?:在|于|将|到|至|追加到|添加到|插入到|放到|写到)\s*)?(?:(?:当前|本|这(?:个|份)|该)\s*)?(?:本文档|这份文档|此文档|文档|文稿|文章|本文)(?:的)?\s*(?:末尾|结尾|底部|最后|尾部)/giu
];
const DOMAIN_SOURCE_FIELDS = "(?:engine|database|system|server|endpoint|environment|cluster|host|version|schema|table|column|field|region|account|platform|instance|connection|url|api|service|application|network|bucket|queue|topic|stream|warehouse|catalog|namespace)s?";
const DOMAIN_SOURCE_METADATA_PATTERNS = [
  new RegExp(`\\b(?:the\\s+)?(?:source\\s*(?:and|&|/)\\s*target|target\\s*(?:and|&|/)\\s*source)\\s+(?:database\\s+)?${DOMAIN_SOURCE_FIELDS}\\b`, "giu"),
  new RegExp(`\\b(?:the\\s+)?(?:source|target)\\s+(?:database\\s+)?${DOMAIN_SOURCE_FIELDS}\\b`, "giu"),
  /(?:源端|源|目标端|目标)(?:和|与|及|\/)(?:源端|源|目标端|目标)?(?:的)?(?:数据库|引擎|系统|服务器|端点|环境|集群|主机|版本|schema|表|字段|区域|账号|平台|实例|连接)/giu
];
const DOMAIN_SOURCE_BACKREFERENCE = /\b(?:above|below|earlier|previous(?:ly)?|preceding|prior)\b|\b(?:current|this|given|provided|original|the\s+original)\s+(?:document|text|section|plan|table|context|source)\b|原文|本文|全文|上文|前文|前述|上述|以上|下文|如下|前面|当前文档|当前文稿|本文档|上一节|前一节/iu;
const SOURCE_RELATIONS = /根据|基于|参考|参照|照着|依照|按照|结合|对照|引用|复用|重用|沿用|延续|承接|读取|查看|阅读|分析|理解|解释|抽取|提取|总结|概括|修改|改造|更新|扩展|接着|继续|\b(?:based\s+on|according\s+to|refer(?:ence)?|reuse|quote|cite|read|inspect|continue|extend|modify|update)\b/giu;
const BARE_DOCUMENT_CONSUMER = /\b(?:summari[sz]e|analy[sz]e|translate|总结|概括|分析|翻译)\s*$/iu;
const BARE_DOCUMENT_CONSUMER_AFTER = /^\s*(?:[,;:，；：]\s*)?(?:summari[sz]e|analy[sz]e|translate|总结|概括|分析|翻译)\s*[.!?。！？;；]*\s*$/iu;
const MARKDOWN_DOCUMENT_REFERENCE = /(?:这(?:个|段|份|篇)|整篇|本篇|当前|该|此)(?:的)?\s*Markdown(?:\s*(?:文档|文稿|文件))?|\b(?:this|current|given|provided)\s+markdown(?:\s+(?:document|file|text))?\b/giu;
// Unknown objects qualified as existing/original are dependencies too; omission
// must not depend on keeping a complete vocabulary of field, key or property names.
const QUALIFIED_SOURCE_OBJECT = /(?:已有|现有|原有|既有)(?:的)?[\p{L}\p{N}_-]{1,64}|\b(?:existing|original|previous|above|aforementioned)\s+[\p{L}\p{N}_-]{1,64}/giu;
const NEGATED_QUALIFIED_SOURCE_OBJECT = /(?:不要|请勿|勿|别|不(?:要|得)?|don['’]t|do\s+not|must\s+not|avoid)\s*(?:复用|重用|沿用|引用|使用|reuse|use|quote|cite)\s*(?:(?:the|this|that|原文|本文|全文|当前文档|当前内容|原有|原|已有|现有|既有|上面|上述|original|current|existing|previous|above|aforementioned)\s*)*(?:已有|现有|原有|既有|existing|original|previous|above|aforementioned)\s*(?:的\s*)?[\p{L}\p{N}_-]{1,64}/giu;
const NEGATED_SOURCE_OBJECT_REFERENCE = /(?:不要|请勿|勿|别|不(?:要|得)?|don't|do\s+not|must\s+not|avoid)\s*(?:复用|重用|沿用|引用|使用|reuse|use|quote|cite|carry\s+over)\s*(?:(?:原有|原|已有|现有|既有|当前|上面|上述|此前|之前|这段|这个|该|所述|the|existing|current|original|previous|above|this|that)\s*)*(?:的\s*)?(?:代码(?:块|片段)?|函数|配置|接口|字段(?:名)?|参数|变量|命名|schema|模式|function|code(?:\s+block|\s+snippet)?|configuration|interface|api|field(?:\s+name)?|parameter|variable|naming|schema)/giu;

const WRITE_PROTECTION_PATTERNS = [
  /(?:不(?:要|得)?(?:修改|改动|更改|改变|触碰|输出|复制|重复|改写)|不要改|勿(?:修改|改动|更改|改变|触碰|输出|复制|重复|改写|改)|do\s+not\s+(?:change|modify|edit|copy|repeat|rewrite)|don['’]t\s+(?:change|modify|edit|copy|repeat|rewrite))\s*(?:完整|完整地|原样)?\s*(?:原文|本文|全文|文稿|这段(?:话|文字|内容|材料)|当前文档|当前内容|原代码|原有代码|现有代码|已有代码|原配置|原有配置|现有配置|已有配置|既有实现|original\s+(?:text|content|document|source|code|configuration)|the\s+original\s+(?:text|content|document|source|code|configuration))/giu,
  /(?:原文|本文|全文|文稿|这段(?:话|文字|内容|材料)|当前文档|当前内容|原代码|原有代码|现有代码|已有代码|原配置|原有配置|现有配置|已有配置|既有实现|original\s+(?:text|content|document|source|code|configuration)|the\s+original\s+(?:text|content|document|source|code|configuration))\s*(?:保持|保留)?\s*(?:不变|原样|unchanged|intact|as\s+is)/giu,
  /(?:保留|保持|保护)\s*(?:(?:这个|当前|现有|已有|原有|既有|上面|上述)(?:的)?)?(?:代码|配置|实现|接口|API|项目|文档|文稿|内容|这段(?:话|文字|内容|材料))\s*(?:不变|原样)/giu,
  /\b(?:keep|preserve|leave)\s+(?:(?:the|this|current|existing|original|above)\s+)?(?:code|configuration|implementation|interface|api|project|document|text|source)\s+(?:unchanged|intact|as\s+is)\b/giu
];

function maskWriteProtection(instruction: string): string {
  let masked = instruction;
  for (const pattern of WRITE_PROTECTION_PATTERNS) {
    pattern.lastIndex = 0;
    masked = masked.replace(pattern, (match) => match.replace(/[^\r\n]/gu, " "));
  }
  return masked;
}

function isUnnegatedBareDocumentConsumerAt(instruction: string, offset: number, length: number): boolean {
  const clauseStart = Math.max(
    instruction.lastIndexOf(".", offset - 1), instruction.lastIndexOf("!", offset - 1), instruction.lastIndexOf("?", offset - 1),
    instruction.lastIndexOf("。", offset - 1), instruction.lastIndexOf("！", offset - 1), instruction.lastIndexOf("？", offset - 1),
    instruction.lastIndexOf(";", offset - 1), instruction.lastIndexOf("\n", offset - 1)
  ) + 1;
  const afterOffset = offset + length;
  const afterTail = instruction.slice(afterOffset);
  const clauseEnd = afterTail.search(/[.!?。！？;\n]/u);
  const before = instruction.slice(clauseStart, offset);
  const after = clauseEnd < 0 ? afterTail : afterTail.slice(0, clauseEnd + 1);
  const beforeMatch = BARE_DOCUMENT_CONSUMER.exec(before);
  if (beforeMatch && /^[\s.!?。！？;；]*$/u.test(after)) {
    const from = clauseStart + (beforeMatch.index ?? 0);
    return !isNegatedWithinSentence(instruction, from, from + beforeMatch[0].trimEnd().length);
  }
  const afterMatch = BARE_DOCUMENT_CONSUMER_AFTER.exec(after);
  if (!afterMatch) return false;
  const action = /(?:summari[sz]e|analy[sz]e|translate|总结|概括|分析|翻译)/iu.exec(afterMatch[0]);
  if (!action) return false;
  const from = offset + length + (action.index ?? 0);
  return !isNegatedWithinSentence(instruction, from, from + action[0].length);
}

function maskDocumentTargetLocation(instruction: string): string {
  let masked = instruction;
  for (const pattern of DOCUMENT_TARGET_LOCATIONS) {
    pattern.lastIndex = 0;
    masked = masked.replace(pattern, match => match.replace(/[^\r\n]/gu, " "));
  }
  return masked;
}

function hasUnnegatedBareDocumentConsumerTarget(instruction: string): boolean {
  for (const pattern of DOCUMENT_TARGET_LOCATIONS) {
    pattern.lastIndex = 0;
    for (const match of instruction.matchAll(pattern)) {
      if (isUnnegatedBareDocumentConsumerAt(instruction, match.index ?? 0, match[0].length)) return true;
    }
  }
  return false;
}

function maskDomainSourceMetadata(instruction: string): string {
  let masked = instruction;
  const mask = (match: string, offset: number, original: string) => {
    const prefix = original.slice(Math.max(0, offset - 24), offset);
    if (/\b(?:current|this|that|selected|given|provided)\s*$/iu.test(prefix)) return match;
    const clauseStart = Math.max(
      original.lastIndexOf(".", offset - 1), original.lastIndexOf("!", offset - 1), original.lastIndexOf("?", offset - 1),
      original.lastIndexOf("。", offset - 1), original.lastIndexOf("！", offset - 1), original.lastIndexOf("？", offset - 1),
      original.lastIndexOf(";", offset - 1), original.lastIndexOf("\n", offset - 1)
    ) + 1;
    const afterMatch = original.slice(offset + match.length, offset + match.length + 160);
    const clauseEnd = afterMatch.search(/[.!?。！？;\n]/u);
    const suffix = clauseEnd < 0 ? afterMatch : afterMatch.slice(0, clauseEnd);
    const context = `${original.slice(clauseStart, offset)}${match}${suffix}`;
    if (DOMAIN_SOURCE_BACKREFERENCE.test(context)) return match;
    return match.replace(/[^\r\n]/gu, " ");
  };
  for (const pattern of DOMAIN_SOURCE_METADATA_PATTERNS) {
    pattern.lastIndex = 0;
    masked = masked.replace(pattern, mask);
  }
  return masked;
}

function isNegatedWithinSentence(source: string, from: number, to: number): boolean {
  // The shared helper recognizes Chinese punctuation but not ASCII .?!; normalize
  // those one-code-unit separators locally so an earlier English negation cannot leak.
  const sentenceBoundaries = source.replace(/[.!?]/gu, (boundary) => boundary === "." ? "。" : boundary === "!" ? "！" : "？");
  return isNegatedMention(sentenceBoundaries, from, to);
}

function containsUnnegatedPattern(source: string, pattern: RegExp): boolean {
  pattern.lastIndex = 0;
  for (const match of source.matchAll(pattern)) {
    const from = match.index ?? 0;
    if (!isNegatedWithinSentence(source, from, from + match[0].length)) return true;
  }
  return false;
}

function requiresSourceContext(instruction: string, includeUnqualifiedRelations = true): boolean {
  const quotedMasked = maskQuotedInstruction(instruction, scanInstructionQuotes(instruction));
  const writeProtected = maskWriteProtection(quotedMasked);
  if (hasUnnegatedBareDocumentConsumerTarget(writeProtected)) return true;
  const masked = maskDocumentTargetLocation(maskDomainSourceMetadata(writeProtected));
  NEGATED_QUALIFIED_SOURCE_OBJECT.lastIndex = 0;
  if (NEGATED_QUALIFIED_SOURCE_OBJECT.test(masked)) return true;
  NEGATED_SOURCE_OBJECT_REFERENCE.lastIndex = 0;
  if (NEGATED_SOURCE_OBJECT_REFERENCE.test(masked)) return true;
  if (containsUnnegatedPattern(masked, QUALIFIED_SOURCE_OBJECT)) return true;
  if (containsUnnegatedPattern(masked, SOURCE_REFERENCES)) return true;
  if (containsUnnegatedPattern(masked, MARKDOWN_DOCUMENT_REFERENCE)) return true;
  return includeUnqualifiedRelations && containsUnnegatedPattern(masked, SOURCE_RELATIONS);
}

export interface ArtifactGenerationContextInput {
  instruction: string;
  artifact: string;
  operation: string;
  target: string;
  dependency: "document" | "selection" | "cursor";
}

export interface TaskGenerationContextInput {
  instruction: string;
  spec: ArtifactSpec;
  effect: "edit" | "answer";
  task?: string;
  operation?: string;
  target?: string;
  dependency?: "document" | "selection" | "cursor";
}

/** Shared evidence check for the direct path; this does not classify output format. */
export function isTaskSourceReferenced(instruction: string, effect: "answer" | "edit"): boolean {
  return hasExplicitSourceReusePermission(instruction) || requiresSourceContext(instruction, effect !== "answer");
}

const SELF_CONTAINED_ARTIFACTS: ReadonlySet<ArtifactSpec["kind"]> = new Set([
  "heading", "code", "table", "list", "math", "mermaid"
]);

/** Decides whether generation can omit the document text without changing its target or permissions. */
export function shouldOmitTaskGenerationSource(input: TaskGenerationContextInput): boolean {
  if (input.effect === "answer") {
    if (input.task !== "custom" || input.spec.issues.length > 0) return false;
    const sourceReference = requiresSourceContext(input.instruction, false);
    return !hasExplicitSourceReusePermission(input.instruction)
      && !sourceReference
      && input.dependency !== "selection"
      && input.dependency !== "cursor";
  }

  if (input.spec.sourceDependent || input.spec.issues.length > 0) return false;
  const sourceReference = requiresSourceContext(input.instruction);
  if (hasExplicitSourceReusePermission(input.instruction) || sourceReference) return false;

  return input.operation === "insert"
    && input.target === "document_end"
    && input.dependency === "document"
    && SELF_CONTAINED_ARTIFACTS.has(input.spec.kind);
}

/** Keeps the source available to the generator except for self-contained EOF code insertions. */
export function shouldOmitArtifactGenerationSource(input: ArtifactGenerationContextInput): boolean {
  if (input.artifact !== "code" || input.operation !== "insert" || input.target !== "document_end" || input.dependency !== "document") {
    return false;
  }
  if (hasExplicitSourceReusePermission(input.instruction) || requiresSourceContext(input.instruction)) return false;
  return true;
}
