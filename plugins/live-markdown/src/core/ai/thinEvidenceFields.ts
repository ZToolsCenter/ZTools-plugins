import type { SummaryFactCandidate } from "./summaryFactLedger";

export type EvidenceFieldKey = "project" | "owner" | "budget" | "date" | "status" | "decision";

export interface EvidenceField {
  key: EvidenceFieldKey;
  label: string;
}

export interface EvidenceBinding {
  field: EvidenceField;
  value: string;
  subject?: string;
  sourceId: string;
}

export interface EvidenceQuestionAnalysis {
  fields: EvidenceField[];
  bindings: EvidenceBinding[];
  requestedSubjects: Array<{ key: string; label: string }>;
  relevantCandidates: SummaryFactCandidate[];
  missingFields: string[];
  warnings: string[];
  needsSelection: boolean;
}

const FIELD_RULES: ReadonlyArray<{ field: EvidenceField; question: RegExp; source: RegExp }> = [
  { field: { key: "project", label: "项目名" }, question: /项目(?:名称|名)|project\s+name/iu, source: /项目(?:名称|名)|project\s+name/iu },
  { field: { key: "owner", label: "负责人" }, question: /负责人|谁负责|owner|responsible/iu, source: /负责人|由[\p{L}\p{N}_-]{1,32}(?:负责|管理|维护|执行|交付)|owner|responsible/iu },
  { field: { key: "budget", label: "预算" }, question: /预算|经费|费用|金额|成本|budget|amount|cost/iu, source: /预算|经费|费用|金额|成本|budget|amount|cost/iu },
  { field: { key: "date", label: "日期" }, question: /日期|截止|时间|deadline|date/iu, source: /日期|截止|截至|发布|验收|时间|deadline|date/iu },
  { field: { key: "status", label: "当前状态" }, question: /状态|进度|是否完成|status|progress/iu, source: /状态|进度|status|progress/iu },
  { field: { key: "decision", label: "决定" }, question: /决定|决策|结论|decision|conclusion/iu, source: /决定|决策|结论|decision|conclusion/iu }
];

const ENTITY = String.raw`[\p{L}\p{N}][\p{L}\p{N}_-]{0,31}`;
const PERSON = String.raw`[\p{L}\p{N}][\p{L}\p{N}_-]{0,31}`;
const ASCII_ENTITY = String.raw`[A-Za-z][A-Za-z0-9_-]{0,31}`;
const BUDGET_LABEL = String.raw`(?:budget|amount|cost|预算|经费|费用|金额|成本)`;
const OWNER_LABEL = String.raw`(?:项目负责人|负责人|owner|responsible(?:\s+person)?)`;
const STATUS_LABEL = String.raw`(?:(?:当前|目前)?状态|status|progress)`;
const DIRECT_SUBJECT_LABEL = `(?:${BUDGET_LABEL}|${OWNER_LABEL}|${STATUS_LABEL})`;
const AMOUNT_VALUE = String.raw`\d+(?:[,.]\d+)*(?:\s*(?:%|％|元|万元|亿元|美元|人民币|USD|CNY|RMB|MB|GB|TB|ms|毫秒|秒|分钟|小时|天|人|项|次|件|台|份))`;
const DATE_VALUE = /(?:\b(?:19|20)\d{2}[-/.年]\s*\d{1,2}(?:[-/.月]\s*\d{1,2}日?)?|\b\d{1,2}月\d{1,2}日|\bQ[1-4]\s*20\d{2}\b)/iu;
const SUBJECT_STOPWORDS = new Set(["的", "该", "本", "其", "这", "此", "项目", "project", "projects", "name", "budget", "budgets", "amount", "cost", "费用", "经费", "金额", "成本", "负责人", "owner", "responsible", "date", "deadline", "status", "progress", "decision", "total", "overall", "annual", "current", "the", "your", "their", "and", "or", "both", "each", "two", "respectively", "for", "of", "is", "are", "what", "which", "who", "how", "much", "please", "tell", "me"]);
const SUBJECT_WORD = String.raw`(?!(?:${[...SUBJECT_STOPWORDS].sort((a, b) => b.length - a.length).join("|")})(?=$|\s|[:：=]|${DIRECT_SUBJECT_LABEL}))${ENTITY}`;
const SUBJECT_PHRASE = `${SUBJECT_WORD}(?:\\s+${SUBJECT_WORD}){0,3}`;
const PERSON_STOPWORDS = String.raw`(?:负责|管理|维护|执行|交付|跟进|项目|负责人|owner|responsible|status|progress|budget|amount|cost|is|for|of|the)`;
const PERSON_WORD = String.raw`(?!(?:${PERSON_STOPWORDS})(?=$|\s))${PERSON}`;
const PERSON_PHRASE = `${PERSON_WORD}(?:\\s+${PERSON_WORD}){0,2}`;
const PROJECT_VALUE_STOPWORDS = String.raw`(?:owner|responsible|status|progress|budget|amount|cost|负责人|状态|进度|预算|经费|费用|金额|成本)`;
const PROJECT_VALUE_WORD = String.raw`(?!(?:${PROJECT_VALUE_STOPWORDS})(?=$|\s))${ENTITY}`;
const PROJECT_VALUE_PHRASE = `${PROJECT_VALUE_WORD}(?:\\s+${PROJECT_VALUE_WORD}){0,4}`;
const QUESTION_FIELD_TERMS: Partial<Record<EvidenceFieldKey, string>> = {
  project: String.raw`(?:项目(?:名称|名)?|project\s+name)`,
  owner: String.raw`(?:负责人|谁负责|owner|responsible)`,
  budget: BUDGET_LABEL + "s?",
  date: String.raw`(?:日期|截止|时间|deadline|date)`,
  status: String.raw`(?:状态|进度|status|progress)`,
  decision: String.raw`(?:决定|决策|结论|decision|conclusion)`
};
const DECISION_LABEL_ASSERTION = /^\s*(?:(?:开篇|首段|第一段|中段|末段|尾段|最后|最终|本次|本项目|该项目|项目|阶段)\s*)?(?:决定|决策|结论)\s*(?:是|为|[:：])\s*(?!准|依据|参考|原则|标准|准则)(?=\S)|^\s*(?:(?:opening|first|middle|closing|final|project|section\s+\d+)\s+)?(?:decision|conclusion)\s*(?:is|:)\s*(?=\S)/iu;
const DECISION_ACTION_ASSERTION = /(?:决定|决策|选择)\s*(?:采用|选用|使用|迁移|保留|停止|启动|调整|延期|取消|推进|建设|改用|改为|维持|实施|发布|上线|下线|交付|采购|创建|结束|终止|继续|放弃|不再|暂缓|批准|拒绝|安排|设为|定为)|(?:decided|selected|adopted|concluded)\s+(?:to\s+\S+|that\s+\S+)|will\s+(?:use|migrate|keep|stop|start|adjust|delay|cancel|adopt|select|build|ship|continue|drop)\b/iu;
const NEGATED_DECISION = /(?:(?:没有|无|并无|尚无|暂无|未有|尚未|还未|未|未曾|未能|未作出|未形成|未确定|未决定|未确认|不确定|仍未)\s*(?:(?:新增|增加|添加|新的?|明确|正式|最终|作出|形成|做出|确认|的)\s*)*(?:决策|决定|结论|方案|采用|选用|使用)|(?:没有|尚未|还未|未|仍未)\s*决定\s*是否)/iu;

function normalizeSubject(subject: string): string { return subject.normalize("NFC").toLowerCase(); }

function addSubjectName(names: Map<string, string>, name: string | undefined): void {
  const trimmed = name?.trim();
  if (!trimmed || SUBJECT_STOPWORDS.has(normalizeSubject(trimmed))) return;
  const key = normalizeSubject(trimmed);
  if (!names.has(key)) names.set(key, trimmed);
}

function projectContext(candidate: SummaryFactCandidate): boolean {
  return candidate.sectionPath.some(({ text }) => /项目|\bproject\b/iu.test(text));
}

function subjectOwners(quote: string): Array<{ subject: string; value: string }> {
  const pattern = new RegExp(`(?:^|[\\s，,；;。:：])(${SUBJECT_PHRASE})\\s*由\\s*(${PERSON_PHRASE})\\s*(?:负责|管理|维护|执行|交付|跟进)`, "giu");
  return [...quote.matchAll(pattern)].map((match) => ({ subject: match[1], value: match[2] }));
}

function sourceSubjectNames(candidate: SummaryFactCandidate): string[] {
  const names = new Map<string, string>();
  for (const { subject } of subjectOwners(candidate.quote)) addSubjectName(names, subject);
  const directField = new RegExp(`(?<![\\p{L}\\p{N}_-])(${SUBJECT_PHRASE})(?:['’]s)?\\s*(?:项目\\s*)?(?:的\\s*)?${DIRECT_SUBJECT_LABEL}`, "giu");
  for (const match of candidate.quote.matchAll(directField)) addSubjectName(names, match[1]);
  return [...names.values()];
}

function questionSubjectHints(instruction: string, fields: readonly EvidenceField[]): Array<{ key: string; label: string }> {
  const terms = [...new Set(fields.map(({ key }) => QUESTION_FIELD_TERMS[key]).filter((term): term is string => Boolean(term)))];
  if (!terms.length) return [];
  const fieldTerm = `(?:${terms.sort((a, b) => b.length - a.length).join("|")})`;
  const connectors = String.raw`(?:and|&|,|、|和|与|及)`;
  const querySubjectWord = `(?!(?:${[...SUBJECT_STOPWORDS].sort((a, b) => b.length - a.length).join("|")})(?=$|\\s|['’]))${ASCII_ENTITY}`;
  const entityPhrase = `${querySubjectWord}(?:\\s+${querySubjectWord}){0,3}`;
  const entityList = `${entityPhrase}(?:\\s*${connectors}\\s*${entityPhrase})*`;
  const prefix = new RegExp(`(?<![A-Za-z0-9_-])(${entityList})(?:['’]s)?\\s*(?:(?:two|both|each|respectively|两个|两|各自|分别)\\s*)*(?:(?:project|projects|项目)\\s*)?(?:的\\s*)?${fieldTerm}(?![A-Za-z0-9_-])`, "giu");
  const suffix = new RegExp(`${fieldTerm}\\s+(?:for|of)\\s*(${entityList})(?![A-Za-z0-9_-])`, "giu");
  const subjects = new Map<string, { key: string; label: string }>();
  const listConnector = /\s*(?:and|&|,|、|和|与|及)\s*/iu;
  for (const match of [...instruction.matchAll(prefix), ...instruction.matchAll(suffix)]) {
    for (const label of match[1].split(listConnector).map((entity) => entity.trim()).filter(Boolean)) {
      if (SUBJECT_STOPWORDS.has(normalizeSubject(label))) continue;
      const key = normalizeSubject(label);
      if (!subjects.has(key)) subjects.set(key, { key, label });
    }
  }
  return [...subjects.values()];
}

function mentionedSubjects(instruction: string, candidates: readonly SummaryFactCandidate[], fields: readonly EvidenceField[]): Array<{ key: string; label: string }> {
  const explicit = questionSubjectHints(instruction, fields);
  if (explicit.length) return explicit;

  const names = new Map<string, string>();
  for (const candidate of candidates) for (const subject of sourceSubjectNames(candidate)) addSubjectName(names, subject);
  const normalizedInstruction = instruction.normalize("NFC").toLowerCase();
  const mentions: Array<{ key: string; label: string; from: number; to: number }> = [];
  for (const [key, label] of names) {
    let from = normalizedInstruction.indexOf(key);
    while (from !== -1) {
      const asciiEntity = /^[a-z0-9_-]+$/u.test(key);
      const before = normalizedInstruction[from - 1] ?? "";
      const after = normalizedInstruction[from + key.length] ?? "";
      const boundaryOk = !asciiEntity || (!/[a-z0-9_-]/u.test(before) && !/[a-z0-9_-]/u.test(after));
      if (boundaryOk) mentions.push({ key, label, from, to: from + key.length });
      from = normalizedInstruction.indexOf(key, from + Math.max(1, key.length));
    }
  }
  mentions.sort((a, b) => a.from - b.from || (b.to - b.from) - (a.to - a.from));
  const selected: typeof mentions = [];
  for (const mention of mentions) {
    if (selected.some((item) => mention.from < item.to && item.from < mention.to)) continue;
    if (!selected.some((item) => item.key === mention.key)) selected.push(mention);
  }
  return selected.map(({ key, label }) => ({ key, label }));
}

function extractBindings(candidate: SummaryFactCandidate, fields: readonly EvidenceField[]): EvidenceBinding[] {
  const quote = candidate.quote;
  const owners = subjectOwners(quote);
  const owner = owners[0];
  const possible: EvidenceBinding[] = [];
  const add = (key: EvidenceFieldKey, value: string | undefined, subject?: string) => {
    const field = fields.find((item) => item.key === key);
    if (field && value) possible.push({ field, value, ...(subject ? { subject } : {}), sourceId: candidate.id });
  };

  const projectLabel = new RegExp(`(?:项目(?:名称|名)|project\\s+name)\\s*(?:is|是|为|[:：])?\\s*(${PROJECT_VALUE_PHRASE})`, "iu").exec(quote);
  if (projectLabel) add("project", projectLabel[1]);
  else if (projectContext(candidate)) for (const relation of owners) add("project", relation.subject);

  for (const relation of owners) add("owner", relation.value, relation.subject);
  const namedOwnerPattern = new RegExp(`(?<![\\p{L}\\p{N}_-])(${SUBJECT_PHRASE})(?:['’]s)?\\s*(?:项目\\s*)?(?:的\\s*)?${OWNER_LABEL}\\s*(?:is|是|为|[:：])\\s*(${PERSON_PHRASE})`, "giu");
  const namedOwners = [...quote.matchAll(namedOwnerPattern)];
  for (const match of namedOwners) add("owner", match[2], match[1]);
  if (!namedOwners.length) {
    const labeledOwnerPattern = new RegExp(`${OWNER_LABEL}\\s*(?:is|是|为|[:：])\\s*(${PERSON_PHRASE})`, "iu");
    const labeledOwner = labeledOwnerPattern.exec(quote);
    if (labeledOwner) add("owner", labeledOwner[1], owner?.subject);
  }

  const budgetConnector = String.raw`(?:(?:也)?(?:为|是)|is|[:：=])`;
  const namedAmountPattern = new RegExp(`(?<![\\p{L}\\p{N}_-])(${SUBJECT_PHRASE})(?:['’]s)?\\s*(?:项目\\s*)?(?:的\\s*)?${BUDGET_LABEL}\\s*${budgetConnector}?\\s*(${AMOUNT_VALUE})`, "giu");
  const namedAmounts = [...quote.matchAll(namedAmountPattern)].filter((match) => !SUBJECT_STOPWORDS.has(normalizeSubject(match[1])));
  const namedAmountForPattern = new RegExp(`${BUDGET_LABEL}\\s+(?:for|of)\\s+(${SUBJECT_PHRASE})\\s*(?:is|[:=])?\\s*(${AMOUNT_VALUE})`, "giu");
  const namedAmountsFor = [...quote.matchAll(namedAmountForPattern)].filter((match) => !SUBJECT_STOPWORDS.has(normalizeSubject(match[1])));
  for (const match of [...namedAmounts, ...namedAmountsFor]) add("budget", match[2], match[1]);
  if (!namedAmounts.length && !namedAmountsFor.length) {
    const labeledAmountPattern = new RegExp(`${BUDGET_LABEL}\\s*${budgetConnector}?\\s*(${AMOUNT_VALUE})`, "giu");
    const labeledAmounts = [...quote.matchAll(labeledAmountPattern)];
    if (labeledAmounts.length === 1) add("budget", labeledAmounts[0][1], owners.length === 1 ? owners[0].subject : undefined);
  }
  if (!projectLabel && !owners.length && namedAmounts[0]?.[1] && projectContext(candidate)) add("project", namedAmounts[0][1]);

  const date = DATE_VALUE.exec(quote);
  if (date && /日期|截止|截至|发布|验收|时间|deadline|date/iu.test(quote)) {
    const labeled = new RegExp(`(?:^|[\\s，,；;。:：])(${ENTITY}?)(?:项目)?(?:的)?(?:验收截止日期|截止日期|发布日期|验收日期|日期|时间)`, "iu").exec(quote);
    add("date", date[0], labeled?.[1] || owner?.subject);
  }

  const namedStatusPattern = new RegExp(`(?<![\\p{L}\\p{N}_-])(${SUBJECT_PHRASE})(?:['’]s)?\\s*(?:项目\\s*)?(?:的\\s*)?${STATUS_LABEL}\\s*(?:is|为|是|[:：])\\s*([^，,。；;\\n]{1,64})`, "giu");
  const namedStatuses = [...quote.matchAll(namedStatusPattern)];
  for (const match of namedStatuses) add("status", match[2].trim(), match[1]);
  if (!namedStatuses.length) {
    const labeledStatusPattern = new RegExp(`${STATUS_LABEL}\\s*(?:is|为|是|[:：])\\s*([^，,。；;\\n]{1,64})`, "iu");
    const labeledStatus = labeledStatusPattern.exec(quote);
    if (labeledStatus) add("status", labeledStatus[1].trim(), owners.length === 1 ? owners[0].subject : undefined);
  }

  if (isAffirmativeRequiredDecision(candidate) && /决定|决策|结论|decision|conclusion/iu.test(quote)) {
    add("decision", quote, owner?.subject);
  }
  return possible;
}

export function isAffirmativeRequiredDecision(candidate: SummaryFactCandidate): boolean {
  if (!candidate.facets.includes("decision")) return false;
  return candidate.quote.split(/[,，;；。！？!?]|但是|但|不过|\s+but\s+/iu)
    .some((clause) => !NEGATED_DECISION.test(clause)
      && (DECISION_LABEL_ASSERTION.test(clause) || DECISION_ACTION_ASSERTION.test(clause)));
}

function sameSubjectConflict(bindings: readonly EvidenceBinding[]): boolean {
  const valuesBySubject = new Map<string, Set<string>>();
  for (const binding of bindings) {
    const subject = binding.subject ? normalizeSubject(binding.subject) : "\u0000unbound";
    const values = valuesBySubject.get(subject) ?? new Set<string>();
    values.add(binding.value);
    valuesBySubject.set(subject, values);
  }
  return [...valuesBySubject.values()].some((values) => values.size > 1);
}

export function analyzeEvidenceQuestion(instruction: string, candidates: readonly SummaryFactCandidate[]): EvidenceQuestionAnalysis {
  const fields = FIELD_RULES.filter(({ question }) => question.test(instruction)).map(({ field }) => field);
  const allBindings = candidates.flatMap((candidate) => extractBindings(candidate, fields));
  const requestedSubjects = mentionedSubjects(instruction, candidates, fields);
  const requestedKeys = new Set(requestedSubjects.map(({ key }) => key));
  const bindings = allBindings.filter(({ subject }) => !requestedKeys.size || Boolean(subject && requestedKeys.has(normalizeSubject(subject))));
  const missingFields: string[] = [];
  const warnings: string[] = [];
  const conflictByField = new Set<EvidenceFieldKey>();
  for (const field of fields) {
    if (requestedSubjects.length > 1) {
      for (const subject of requestedSubjects) {
        const subjectBindings = bindings.filter((binding) => binding.field.key === field.key && binding.subject && normalizeSubject(binding.subject) === subject.key);
        if (!subjectBindings.length || (field.key !== "decision" && sameSubjectConflict(subjectBindings))) {
          missingFields.push(`${field.label}（${subject.label}）`);
          if (subjectBindings.length) conflictByField.add(field.key);
        }
      }
    } else {
      const fieldBindings = bindings.filter((binding) => binding.field.key === field.key);
      if (!fieldBindings.length) missingFields.push(field.label);
      else if (field.key !== "decision" && sameSubjectConflict(fieldBindings)) {
        missingFields.push(field.label);
        conflictByField.add(field.key);
      }
    }
  }
  if (conflictByField.size) warnings.push("同一主体存在互相冲突的来源值；已保留原句并标记缺依据，没有替用户裁定。");

  const boundIds = new Set(bindings.map(({ sourceId }) => sourceId));
  const relevantCandidates = candidates.filter((candidate) => {
    if (requestedKeys.size) {
      const candidateNames = sourceSubjectNames(candidate).map(normalizeSubject);
      const candidateBindings = extractBindings(candidate, fields);
      const boundSubjects = candidateBindings.map(({ subject }) => subject && normalizeSubject(subject)).filter((subject): subject is string => Boolean(subject));
      if (candidateNames.length && !candidateNames.some((subject) => requestedKeys.has(subject))) return false;
      if (boundSubjects.length && !boundSubjects.some((subject) => requestedKeys.has(subject))) return false;
    }
    return boundIds.has(candidate.id) || fields.some((field) => {
      const rule = FIELD_RULES.find((item) => item.field.key === field.key)!;
      return rule.source.test(candidate.quote) || (field.key === "project" && projectContext(candidate) && sourceSubjectNames(candidate).length > 0);
    });
  });
  const hasUnboundRelevant = relevantCandidates.some((candidate) => !boundIds.has(candidate.id));
  const fieldsComplete = fields.length > 0 && missingFields.length === 0;
  return {
    fields, bindings, requestedSubjects, relevantCandidates, missingFields, warnings,
    needsSelection: fields.length === 0 || (!fieldsComplete && hasUnboundRelevant)
  };
}

export function renderEvidenceAnswer(
  analysis: EvidenceQuestionAnalysis,
  evidence: readonly SummaryFactCandidate[]
): string {
  if (!analysis.fields.length) {
    if (!evidence.length) return "未找到可核验的相关依据。";
    return `可核验原文片段：\n${evidence.map(({ quote }) => `- ${quote}`).join("\n")}`;
  }

  const lines = ["可核验字段："];
  for (const field of analysis.fields) {
    if (analysis.requestedSubjects.length) {
      for (const subject of analysis.requestedSubjects) {
        const values = analysis.bindings.filter(({ field: bindingField, subject: bindingSubject }) => bindingField.key === field.key && bindingSubject && normalizeSubject(bindingSubject) === subject.key);
        const missingLabel = analysis.requestedSubjects.length > 1 ? `${field.label}（${subject.label}）` : field.label;
        if (!values.length || analysis.missingFields.includes(missingLabel)) {
          lines.push(`- ${field.label}（${subject.label}）：已扫描材料未找到明确依据`);
          continue;
        }
        for (const { value, subject: sourceSubject } of values) lines.push(`- ${field.label}（${sourceSubject || subject.label}）：${value}`);
      }
      continue;
    }
    const values = analysis.bindings.filter(({ field: bindingField }) => bindingField.key === field.key);
    if (!values.length || analysis.missingFields.includes(field.label)) {
      lines.push(`- ${field.label}：已扫描材料未找到明确依据`);
      continue;
    }
    for (const { subject, value } of values) lines.push(`- ${field.label}${subject ? `（${subject}）` : ""}：${value}`);
  }
  if (evidence.length) lines.push("", "原文依据：", ...evidence.map(({ quote }) => `- ${quote}`));
  return lines.join("\n");
}
