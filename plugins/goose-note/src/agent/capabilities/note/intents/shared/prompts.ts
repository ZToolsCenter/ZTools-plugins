import agentInstructions from "@/agent/AGENTS.md?raw";
import chatSkill from "@/agent/chat/SKILL.md?raw";
import createNooteSkill from "@/agent/createNoote/SKILL.md?raw";
import searchNotesSkill from "@/agent/searchNotes/SKILL.md?raw";
import updateNoteSkill from "@/agent/updateNote/SKILL.md?raw";
import visualSkill from "@/agent/visual/SKILL.md?raw";
import { getJsonRenderPromptFragment } from "@/agent/renderers/json-render-catalog";

export const JSON_RENDER_PROMPT_FRAGMENT = getJsonRenderPromptFragment();

export const NOTE_SEARCH_TOOLS_PROMPT = `${searchNotesSkill.trim()}

# 调用格式

- 搜索：<!--search:关键词-->
- 读取页面：<!--read:页面标题-->
- 读取段落：<!--read-section:页面标题#段落标题-->
- 每次只输出一个调用标记，然后等待结果。`;

export const DATAVIZ_SYSTEM_PROMPT = `${visualSkill.trim()}

# 渲染格式

- 数据图表输出合法的 \`\`\`echarts\` JSON 代码块。
- 交互内容输出 \`\`\`html\` 代码块。
- HTML 只写片段，不写文档外壳，不创建滚动容器。
- 不生成复制、下载或通知等宿主功能。`;

export const WORKSPACE_NOTE_SYSTEM_PROMPT = `${agentInstructions.trim()}

${chatSkill.trim()}`;

export const INLINE_NOTE_SYSTEM_PROMPT = `${agentInstructions.trim()}

${updateNoteSkill.trim()}

# 输出

- 只输出最终文本。
- 不解释，不添加前后缀或代码围栏。`;

export interface SystemPromptSignals {
  verdict?: "edit_current" | "create_new" | "chat_only";
  promptText: string;
  hasReference: boolean;
}

const DATAVIZ_KEYWORDS =
  /图|表|可视化|对比|趋势|占比|流程图|仪表盘|echarts|svg|统计|chart|viz/i;
const SEARCH_KEYWORDS =
  /其他笔记|别的笔记|之前写过|我的笔记里|搜索|查一下|找一下|检索/i;

export function buildWorkspaceSystemPrompt(signals: SystemPromptSignals): string {
  const parts = [agentInstructions.trim()];

  if (signals.verdict === "create_new") {
    parts.push(createNooteSkill.trim());
  } else if (signals.verdict === "edit_current") {
    parts.push(updateNoteSkill.trim());
  } else {
    parts.push(chatSkill.trim());
  }

  if (SEARCH_KEYWORDS.test(signals.promptText)) {
    parts.push(NOTE_SEARCH_TOOLS_PROMPT);
  }

  if (DATAVIZ_KEYWORDS.test(signals.promptText)) {
    parts.push(DATAVIZ_SYSTEM_PROMPT, JSON_RENDER_PROMPT_FRAGMENT);
  }

  return parts.join("\n\n");
}
