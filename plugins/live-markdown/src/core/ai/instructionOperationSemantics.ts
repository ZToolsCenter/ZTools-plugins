export interface InstructionOperationSpan {
  operation: "insert" | "replace_exact" | "rewrite";
  from: number;
  to: number;
}

const CONNECTED_ACTION = /(?:然后|接着|并且|同时|再|以及|并|\band\s+then\b|\bthen\b|\balso\b|\band\b)/giu;
const SELECTION_SCOPE = /(?:当前)?(?:选区|选中(?:的)?(?:内容|文字|文本|部分)|所选(?:内容|文字|文本|部分)|\bselected\s+(?:text|content|range)\b|\bselection\b)/iu;
const LOCAL_REFINEMENT = /(?:只|仅)(?:把|将|改|修正|更正).{0,24}(?:替换(?:成|为)?|改成|改为|修正|更正)|(?:其余|其他|其它).{0,12}(?:字|文字|内容|部分)?(?:不变|保持(?:原样)?)/iu;

/** Treats one narrow correction inside the selected rewrite as detail, while preserving connected edits. */
export function isSelectionScopedEditRefinement(masked: string, operations: readonly InstructionOperationSpan[]): boolean {
  if (operations.length !== 2 || !SELECTION_SCOPE.test(masked) || !LOCAL_REFINEMENT.test(masked)) return false;
  const kinds = new Set(operations.map(({ operation }) => operation));
  if (kinds.size !== 2 || !kinds.has("rewrite") || !kinds.has("replace_exact")) return false;

  const [first, second] = [...operations].sort((left, right) => left.from - right.from);
  CONNECTED_ACTION.lastIndex = 0;
  return ![...masked.slice(first.to, second.from).matchAll(CONNECTED_ACTION)].length;
}
