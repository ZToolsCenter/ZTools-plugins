import type {
  AiFileReferenceAttrs,
  AiSkillCommandAttrs,
} from "@/components/editor/ai/composer/referenceLookup";

export type UserMessageSegment =
  | { type: "text"; text: string }
  | { type: "reference"; reference: AiFileReferenceAttrs; key: string }
  | { type: "skill"; skill: AiSkillCommandAttrs; key: string };

type SegmentNeedle =
  | {
      kind: "reference";
      reference: AiFileReferenceAttrs;
      needle: string;
    }
  | {
      kind: "skill";
      skill: AiSkillCommandAttrs;
      needle: string;
    };

/**
 * metadata.skills 为空时，从 displayText 扫 `/name` 生成 skill needles，
 * 让旧消息 / 纯文本手打 skill 也能显示 chip。
 */
export function inferSkillsFromDisplayText(
  text: string,
): AiSkillCommandAttrs[] {
  const re = /\/([a-z0-9][a-z0-9-]*)/gi;
  const seen = new Set<string>();
  const result: AiSkillCommandAttrs[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    // 保留原文大小写，保证 needle 与 displayText 的 indexOf 能命中
    const rawName = match[1];
    const key = rawName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ name: rawName });
  }
  return result;
}

/**
 * 把 displayText 里的 `@标题` / `/${name}` 拆成与输入框一致的内联 chip 片段。
 * 同位置优先更长 needle；@ 与 / 互不吞字符。
 * skills 为空时回退从文本扫 `/name`。
 */
export function buildUserMessageSegments(
  text: string,
  references: AiFileReferenceAttrs[],
  skills: AiSkillCommandAttrs[] = [],
): UserMessageSegment[] {
  if (!text) return [];

  const effectiveSkills =
    skills.length > 0 ? skills : inferSkillsFromDisplayText(text);

  const needles: SegmentNeedle[] = [
    ...references.map((reference) => ({
      kind: "reference" as const,
      reference,
      needle: `@${reference.titleSnapshot}`,
    })),
    ...effectiveSkills.map((skill) => ({
      kind: "skill" as const,
      skill,
      needle: `/${skill.name}`,
    })),
  ].filter((item) => item.needle.length > 1);

  if (needles.length === 0) return [{ type: "text", text }];

  const segments: UserMessageSegment[] = [];
  let cursor = 0;
  let refOccurrence = 0;
  let skillOccurrence = 0;

  while (cursor < text.length) {
    let match: {
      index: number;
      length: number;
      needle: SegmentNeedle;
    } | null = null;

    for (const item of needles) {
      const index = text.indexOf(item.needle, cursor);
      if (index === -1) continue;
      if (
        !match ||
        index < match.index ||
        (index === match.index && item.needle.length > match.length)
      ) {
        match = { index, length: item.needle.length, needle: item };
      }
    }

    if (!match) {
      segments.push({ type: "text", text: text.slice(cursor) });
      break;
    }

    if (match.index > cursor) {
      segments.push({ type: "text", text: text.slice(cursor, match.index) });
    }

    if (match.needle.kind === "reference") {
      segments.push({
        type: "reference",
        reference: match.needle.reference,
        key: `${match.needle.reference.pageId}-${refOccurrence++}`,
      });
    } else {
      segments.push({
        type: "skill",
        skill: match.needle.skill,
        key: `skill-${match.needle.skill.name}-${skillOccurrence++}`,
      });
    }
    cursor = match.index + match.length;
  }

  return segments;
}
