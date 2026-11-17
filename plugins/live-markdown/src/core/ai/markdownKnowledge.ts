/** Small reviewed reference data. It is not a substitute for analysing a user's document. */
const commonMark = "https://spec.commonmark.org/0.31.2/";
const levels: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
const englishLevels: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6 };

export interface MarkdownKnowledgeAnswer { text: string; source: string; topic: string; }

function headingLevel(instruction: string): number | undefined {
  const chinese = /([一二三四五六1-6])\s*级\s*标题|标题\s*([一二三四五六1-6])|\bH([1-6])\b/iu.exec(instruction);
  if (chinese) {
    const value = chinese[1] ?? chinese[2] ?? chinese[3];
    return levels[value] ?? Number(value);
  }
  const english = /\b(first|second|third|fourth|fifth|sixth|[1-6])(?:[- ]level|\s+level)?\s+heading\b|\bheading\s+(?:level\s+)?([1-6])\b/iu.exec(instruction);
  return english ? (englishLevels[english[1]?.toLowerCase()] ?? Number(english[1] ?? english[2])) : undefined;
}

/** Answers one syntax topic from data; callers must exclude source-dependent and formatted tasks. */
export function answerMarkdownKnowledge(instruction: string): MarkdownKnowledgeAnswer | undefined {
  if (!/\b(?:markdown|commonmark)\b/iu.test(instruction) || /标题栏|菜单|按钮|插件设置|供应商|API|接口|provider|menu|button/iu.test(instruction)) return undefined;
  const topics = [
    { id: "heading", matches: /标题|\bheadings?\b|\bheaders?\b/iu.test(instruction) },
    { id: "fence", matches: /代码块|代码围栏|\bfenced?\b|\bcode\s+blocks?\b/iu.test(instruction) },
    { id: "emphasis", matches: /加粗|粗体|斜体|\bbold\b|\bitalic\b|\bemphasis\b/iu.test(instruction) },
    { id: "link", matches: /链接|\blinks?\b/iu.test(instruction) },
    { id: "list", matches: /列表|清单|\blists?\b/iu.test(instruction) }
  ].filter(topic => topic.matches);
  if (topics.length !== 1) return undefined;
  const topic = topics[0].id;
  let text: string;
  let anchor: string;
  if (topic === "heading") {
    const level = headingLevel(instruction);
    const example = level ? `${"#".repeat(level)} 标题` : "# 一级标题\n## 二级标题\n### 三级标题";
    text = `${level ? `${level} 级标题使用 ${level} 个 #，后接空格和标题文字。` : "Markdown 的 ATX 标题使用 1–6 个 #，后接空格和标题文字；# 的数量就是标题级别。"}\n\n${example}`;
    anchor = "atx-headings";
  } else if (topic === "fence") {
    text = "围栏代码块用至少三个反引号或波浪线开始，结束围栏使用相同字符且长度不少于开始围栏。开始围栏后可以标注语言；内容作为代码原样显示。\n\n~~~~markdown\n```python\nprint(\"hello\")\n```\n~~~~";
    anchor = "fenced-code-blocks";
  } else if (topic === "emphasis") {
    text = "使用 **文字** 表示加粗，使用 *文字* 表示斜体。\n\n**加粗文字**\n*斜体文字*";
    anchor = "emphasis-and-strong-emphasis";
  } else if (topic === "link") {
    text = "行内链接使用 [链接文字](目标地址)。\n\n[CommonMark](https://commonmark.org/)";
    anchor = "links";
  } else {
    text = "无序列表可使用 -、+ 或 *；有序列表可使用数字加英文句点。列表标记与内容之间留空格。\n\n- 第一项\n- 第二项\n\n1. 第一项\n2. 第二项";
    anchor = "lists";
  }
  const source = `${commonMark}#${anchor}`;
  return { topic, source, text: `${text}\n\n依据：CommonMark 0.31.2\n${source}` };
}
