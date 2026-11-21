export const GROUNDED_ACTIONS = ["核对", "复核", "验证", "演练", "记录"] as const;
export type GroundedAction = typeof GROUNDED_ACTIONS[number];

export interface GroundedActionEntry {
  action: GroundedAction;
  quote: string;
}

const ACTION_TEMPLATES: Record<GroundedAction, string> = {
  "核对": "将该事项拆成检查点，逐项核对前置条件、实际结果与完成证据，并记录未满足项。",
  "复核": "对照原定要求复查当前结果，标出不一致处并记录处理结论。",
  "验证": "先检查该事项的前置条件，再验证实际结果是否满足要求，保留结果证据并记录异常。",
  "演练": "准备与该事项对应的检查输入，执行相关演练，记录观察结果及发现的问题。",
  "记录": "记录该事项的检查范围、执行证据和结果，并标记未完成或待确认项。"
};

const ACTION_FACT_FACETS: Record<GroundedAction, readonly string[]> = {
  "核对": [],
  "复核": [],
  "验证": [],
  "演练": ["action"],
  "记录": []
};
const EXERCISABLE_OPERATION = /(?:演练|测试|实测|试运行|执行|运行|恢复|回滚|迁移|部署|发布|安装|启动|构建|检查|验证|实施|交付)/u;
const SOURCE_ACTION = /(?:核对|检查|确认|安排|执行|完成|交付|实施|开发|部署|迁移|修复|发布|验证|复核|测试|演练|记录|保留|准备|回滚|恢复|备份|构建|启动|安装|更新|审核|审查|评估|跟进|整理|确保|提交|审批|选择|关闭|删除|新增|调整|设计|实现|提供|处理|运行|复查|核验|审计|\b(?:check|verify|run|deploy|release|restore|backup|test|record|confirm|prepare|execute|rehearse|inspect)\b)/giu;
const SOURCE_OBLIGATION = /(?:下一步|后续|接下来|待办|行动项|必须|务必|应该|应当|应|需要|需|计划|建议|须|将|\b(?:must|should|need\s+to|will|todo|to-do)\b)/giu;
const REQUIRED_SOURCE_OBLIGATION = /(?:下一步|后续|接下来|待办|行动项|必须|务必|应该|应当|应|需要|需|须|\b(?:must|should|need\s+to|todo|to-do)\b)/giu;
const NEGATED_OBLIGATION = /(?:不\s*(?:需要|必|应|该|能|建议)|无需|无须|不用|不必|不应|未必|不得|不要|不可|不能|禁止|严禁|非必须|\b(?:must\s+not|should\s+not|need\s+not|do\s+not|don't|cannot|never)\b)/iu;
const COMPLETED_ACTION_PREDICATE = /^\s*(?:(?:已经|已|早已)\s*(?:完成|结束|完毕)|(?:完成|结束|完毕)(?:了)?)(?=\s*(?:[，,；;。.!！?？]|$))/u;
const MAX_CITATION_POINTS = 32;

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/gu, "\n");
}

function comparableCitationText(value: string): string {
  return normalizeLineEndings(value).replace(/\s+/gu, " ").trim();
}

function escapeMarkdownText(value: string): string {
  return value.replace(/([\\`*_{}\[\]()#+.!|>~])/gu, "\\$1");
}

function codePoints(value: string): string[] {
  return Array.from(value);
}

function sourceActionExcerpt(quote: string): string | undefined {
  const normalized = comparableCitationText(quote);
  const actions = [...normalized.matchAll(SOURCE_ACTION)];
  if (!actions.length) return undefined;

  const obligations = [...normalized.matchAll(SOURCE_OBLIGATION)];
  const actionAfterObligation = actions.find((action) => obligations.some((obligation) => {
    const distance = (action.index ?? 0) - ((obligation.index ?? 0) + obligation[0].length);
    return distance >= 0 && distance <= 12;
  }));
  if (!actionAfterObligation) return undefined;
  const start = actionAfterObligation.index ?? 0;
  const tail = normalized.slice(start).replace(/[。.!！?？;；]+$/u, "").trim();
  const points = codePoints(tail);
  if (points.length <= 1) return undefined;
  if (points.length <= MAX_CITATION_POINTS) return tail;
  return `${points.slice(0, MAX_CITATION_POINTS - 1).join("").replace(/[A-Za-z0-9]+$/u, "").trimEnd()}…`;
}

function actionClauseStart(source: string, actionIndex: number): number {
  const prefix = source.slice(0, actionIndex);
  let start = 0;
  for (const separator of prefix.matchAll(/[，,；;。.!！?？\n]|但|但是|不过|然而/gu)) {
    start = (separator.index ?? 0) + separator[0].length;
  }
  return start;
}

function isNegatedAction(source: string, actionIndex: number): boolean {
  return NEGATED_OBLIGATION.test(source.slice(actionClauseStart(source, actionIndex), actionIndex));
}

function isCompletedAction(source: string, action: RegExpMatchArray): boolean {
  const actionStart = action.index ?? 0;
  const actionEnd = actionStart + action[0].length;
  const completedPrefix = source.slice(Math.max(0, actionStart - 6), actionStart);
  const isCompletionPredicate = /^(?:完成|结束|完毕)$/u.test(action[0])
    && /(?:已经|已|早已)\s*$/u.test(completedPrefix);
  return isCompletionPredicate || COMPLETED_ACTION_PREDICATE.test(source.slice(actionEnd));
}

/** Marks only explicit, pending source duties; negative or completed statements stay as background evidence. */
export function isExplicitPendingActionFact(quote: string): boolean {
  const normalized = comparableCitationText(quote);
  const actions = [...normalized.matchAll(SOURCE_ACTION)];
  const obligations = [...normalized.matchAll(REQUIRED_SOURCE_OBLIGATION)];
  return actions.some((action) => obligations.some((obligation) => {
    const actionIndex = action.index ?? 0;
    const distance = actionIndex - ((obligation.index ?? 0) + obligation[0].length);
    return distance >= 0 && distance <= 24
      && !isNegatedAction(normalized, actionIndex)
      && !isCompletedAction(normalized, action);
  }));
}

function citationExcerpt(quote: string, sourceFacts: readonly string[]): string {
  const normalized = comparableCitationText(quote);
  const points = codePoints(normalized);
  const comparableFacts = sourceFacts.map(comparableCitationText);
  const actionExcerpt = sourceActionExcerpt(normalized);
  const actionExcerptText = actionExcerpt?.replace(/…$/u, "");
  if (actionExcerpt && actionExcerpt !== normalized && actionExcerptText
    && comparableFacts.filter((fact) => fact.includes(actionExcerptText)).length === 1) {
    return actionExcerpt;
  }

  const maxPrefix = Math.min(MAX_CITATION_POINTS - 1, Math.max(0, points.length - 1));
  const startLength = Math.min(8, maxPrefix, Math.max(1, Math.floor(points.length * 0.65)));
  for (let length = startLength; length <= maxPrefix; length += 1) {
    const prefix = points.slice(0, length).join("").replace(/[A-Za-z0-9]+$/u, "").trimEnd();
    if (!prefix) continue;
    const matches = comparableFacts.filter((fact) => fact.startsWith(prefix));
    if (matches.length === 1 && matches[0] === normalized) {
      return `${prefix}${length < points.length ? "…" : ""}`;
    }
  }
  for (let length = Math.min(6, points.length); length <= Math.min(24, points.length); length += 1) {
    for (let offset = 0; offset + length <= points.length; offset += 1) {
      const excerpt = points.slice(offset, offset + length).join("");
      const matches = comparableFacts.filter((fact) => fact.includes(excerpt));
      if (matches.length === 1 && matches[0] === normalized) return `…${excerpt}…`;
    }
  }
  return `来源事实 ${sourceFacts.findIndex((fact) => comparableCitationText(fact) === normalized) + 1}`;
}

function actionLine(action: GroundedAction): string {
  return `- 建议${action}：${ACTION_TEMPLATES[action]}`;
}

/** Returns the fixed actions available for a source fact's classifier facets. */
export function groundedActionsForFacets(facets: readonly string[], quote = ""): GroundedAction[] {
  return GROUNDED_ACTIONS.filter((action) => ACTION_FACT_FACETS[action].length === 0
    || supportsGroundedAction(action, facets, quote));
}

export function supportsGroundedAction(action: GroundedAction, facets: readonly string[], quote = ""): boolean {
  if (ACTION_FACT_FACETS[action].length === 0) return true;
  return ACTION_FACT_FACETS[action].some((facet) => facets.includes(facet)) && EXERCISABLE_OPERATION.test(quote);
}

/** Renders a bounded checklist and one unique, compact source excerpt for each selected fact. */
export function renderGroundedActionList(entries: readonly GroundedActionEntry[]): string {
  const sourceFacts = [...new Set(entries.map(({ quote }) => normalizeLineEndings(quote)))];
  return entries.map(({ action, quote }) => {
    const excerpt = escapeMarkdownText(citationExcerpt(quote, sourceFacts));
    return `${actionLine(action)}\n依据摘录：${excerpt}`;
  }).join("\n\n");
}

/** Verifies the same fixed checklist template and compact citation emitted by the renderer. */
export function readGroundedActionFacts(text: string, sourceFacts: readonly string[]): string[] | null {
  if (!text.trim() || !sourceFacts.length) return null;
  const facts = [...new Set(sourceFacts.map(normalizeLineEndings))];
  const blocks = normalizeLineEndings(text).split(/\n\n+/u);
  const used: string[] = [];
  const valid = blocks.every((block) => {
    const lines = block.split("\n");
    if (lines.length !== 2 || !GROUNDED_ACTIONS.some((action) => lines[0] === actionLine(action)) || !lines[1].startsWith("依据摘录：")) return false;
    const citation = lines[1].slice("依据摘录：".length).replace(/\\([\\`*_{}\[\]()#+.!|>~])/gu, "$1");
    const matches = facts.filter((fact) => citationExcerpt(fact, facts) === citation);
    if (matches.length !== 1) return false;
    used.push(matches[0]);
    return true;
  });
  if (!valid || new Set(used).size !== used.length || used.length !== facts.length || facts.some((fact) => !used.includes(fact))) return null;
  return used;
}

export function isGroundedActionList(text: string, sourceFacts: readonly string[]): boolean {
  return readGroundedActionFacts(text, sourceFacts) !== null;
}
