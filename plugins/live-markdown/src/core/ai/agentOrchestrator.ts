import {
  AgentOrchestrationConfig,
  AgentRolePreset,
  AiProviderId,
  HarnessGateConfig
} from "../../types/typora";

export interface ProviderModelOption {
  id: string;
  name: string;
  description: string;
  provider: AiProviderId;
  recommended?: boolean;
}

export const LOCAL_AI_UI_VISIBLE = false;

export const PROVIDER_OPTIONS: Array<{ id: AiProviderId; name: string; description: string }> = [
  { id: "ztools", name: "当前宿主模型", description: "调用当前宿主已配置的供应商或自定义模型" }
];

// Model catalogs are provided at runtime by the host; do not advertise unverified IDs.
export const PRESET_MODELS: ProviderModelOption[] = [];

export const ROLE_PRESETS: AgentRolePreset[] = [
  {
    id: "general",
    name: "通用创作助手",
    description: "符合 GFM 规范的高质量写作与排版助手",
    icon: "Bot",
    systemPrompt: "你是一位高效的 Markdown 创作与排版助手。输出符合 GFM 规范的高质量文本，逻辑清晰，行文优美。"
  },
  {
    id: "academic-editor",
    name: "学术出版总编",
    description: "严密学术术语、客观论证、期刊级排版规范",
    icon: "GraduationCap",
    systemPrompt: "你是一位顶尖学术期刊审稿人与出版总编。请对用户的文档进行学术级润色，注重行文严谨、论证有力，精准使用专业术语，消灭口语化与模糊表述。保持客观，输出规范的 Markdown。"
  },
  {
    id: "principal-architect",
    name: "系统首席架构师",
    description: "大厂技术方案规范、2D Mermaid 拓扑设计、容灾预案",
    icon: "FileCode",
    systemPrompt: "你是一位顶尖软件系统首席架构师。擅长大型技术方案规范整理、高可用架构推演、接口契约设计与清晰的 2D Mermaid 流程图绘制。输出结构严整的大厂技术方案。"
  },
  {
    id: "creative-blogger",
    name: "资深科技作者",
    description: "通俗生动、叙事引人入胜、结构条理清晰",
    icon: "Sparkles",
    systemPrompt: "你是一位富有洞见的科技专栏作家。文笔通俗生动，比喻精妙，善于将深奥复杂的技术概念转化为引人入胜的叙事，排版清晰美观。"
  },
  {
    id: "strict-proofreader",
    name: "严格排版校对员",
    description: "中英文盘古之白规范、错别字零容忍、纯净直出",
    icon: "CheckCheck",
    systemPrompt: "你是一位专业的中英文文字校对专家。严格遵循中文排版盘古之白规范（在中英文与数字间自动增加一个半角空格）。禁止任何客套开场白，直接输出校对后的完整正文。"
  }
];

export const DEFAULT_ORCHESTRATION_CONFIG: AgentOrchestrationConfig = {
  provider: "ztools",
  model: "",
  providerConfigured: false,
  permissionLevel: "confirm", // confirm before writing back to document
  activeRoleId: "general",
  harnessGates: {
    syntaxHealing: true,
    panguSpacing: true,
    stripChitchat: true,
    securityLeakScan: true
  },
  mcpPermissions: {
    workspaceSearch: true,
    diagramTemplate: true,
    webFetch: false
  }
};

/**
 * Pangu Spacing Filter: Inserts whitespace between CJK and Half-width English/Digits
 */
export function applyPanguSpacing(text: string): string {
  if (!text) return text;
  // CJK and English/Digit
  let result = text.replace(/([一-龥])([a-zA-Z0-9])/g, "$1 $2");
  // English/Digit and CJK
  result = result.replace(/([a-zA-Z0-9])([一-龥])/g, "$1 $2");
  return result;
}

/**
 * Strip AI conversational prefixes / suffixes (e.g. "好的，以下是为您生成的...")
 */
export function stripAiChitchat(text: string): string {
  if (!text) return text;

  let cleaned = text;
  let changed = true;

  // Multi-pass prefix cleaning
  while (changed) {
    const next = cleaned
      .replace(/^(?:好的|当然|没问题|收到|遵命)[，,。\s]*/i, "")
      .replace(/^(?:根据|按照|应)您.*?(?:要求|指令|需求|内容)[，,。：:\n\s]*/i, "")
      .replace(/^(?:以下是|这是|为您).*?(?:内容|结果|方案|代码|文本|如下)[，,。：:\n\s]*/i, "");
    if (next === cleaned) changed = false;
    cleaned = next.trim();
  }

  // Trailing polite sentences cleaning
  cleaned = cleaned.replace(
    /\n*(?:希望(?:上述|以上|这些).*?(?:帮助|需求|到您)[！!。]?|(?:如果您还有其他问题|如有任何疑问).*?[！!。]?)\s*$/i,
    ""
  );

  return cleaned.trim();
}

/**
 * Syntax Self-Healing: Closes unclosed ``` or $$ or ~~ blocks
 */
export function healUnclosedMarkdownBlocks(text: string): string {
  if (!text) return text;
  let healed = text;

  // 1. Check unclosed fenced code blocks (```)
  const codeFenceMatches = healed.match(/(^|\n)```/g);
  if (codeFenceMatches && codeFenceMatches.length % 2 !== 0) {
    healed += "\n```";
  }

  // 2. Check unclosed math blocks ($$)
  const mathMatches = healed.match(/\$\$/g);
  if (mathMatches && mathMatches.length % 2 !== 0) {
    healed += "\n$$";
  }

  return healed;
}

/**
 * Scan for security leaks (API Keys, private tokens, passwords)
 */
export function scanSecurityLeaks(text: string): { hasLeaks: boolean; sanitized: string; warnings: string[] } {
  const warnings: string[] = [];
  let sanitized = text;

  // OpenAI / DeepSeek key pattern: sk-[a-zA-Z0-9]{20,}
  const keyPattern = /sk-[a-zA-Z0-9_-]{20,}/g;
  if (keyPattern.test(sanitized)) {
    warnings.push("检测到疑似泄露的 API Key 凭据，已自动进行脱敏打码保护");
    sanitized = sanitized.replace(keyPattern, (match) => `${match.slice(0, 5)}******${match.slice(-4)}`);
  }

  // Private key header pattern
  if (sanitized.includes("-----BEGIN PRIVATE KEY-----") || sanitized.includes("-----BEGIN RSA PRIVATE KEY-----")) {
    warnings.push("拦截到疑似私钥凭证泄漏");
    sanitized = sanitized.replace(/-----BEGIN[\s\S]+?-----END[^\n]+?-----/g, "[已拦截敏感私钥凭证]");
  }

  return {
    hasLeaks: warnings.length > 0,
    sanitized,
    warnings
  };
}

/**
 * Full Harness Quality Gate Pipeline Execution
 */
export function runHarnessQualityGates(
  rawText: string,
  gates: HarnessGateConfig
): {
  finalText: string;
  warnings: string[];
  appliedGates: string[];
} {
  let text = rawText;
  const warnings: string[] = [];
  const appliedGates: string[] = [];

  // 1. Strip chit-chat
  if (gates.stripChitchat) {
    const stripped = stripAiChitchat(text);
    if (stripped !== text) {
      appliedGates.push("纯净客套过滤");
      text = stripped;
    }
  }

  // 2. Pangu Spacing
  if (gates.panguSpacing) {
    const panguApplied = applyPanguSpacing(text);
    if (panguApplied !== text) {
      appliedGates.push("盘古排版之白");
      text = panguApplied;
    }
  }

  // 3. Syntax healing
  if (gates.syntaxHealing) {
    const healed = healUnclosedMarkdownBlocks(text);
    if (healed !== text) {
      appliedGates.push("Markdown 语法自愈");
      text = healed;
    }
  }

  // 4. Security leak scanning
  if (gates.securityLeakScan) {
    const secResult = scanSecurityLeaks(text);
    if (secResult.hasLeaks) {
      appliedGates.push("敏感凭证脱敏");
      warnings.push(...secResult.warnings);
      text = secResult.sanitized;
    }
  }

  return {
    finalText: text,
    warnings,
    appliedGates
  };
}

const STORAGE_KEY = "typora_agent_orchestration_config_v1";

export function loadOrchestrationConfig(): AgentOrchestrationConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_ORCHESTRATION_CONFIG,
        ...parsed,
        harnessGates: {
          ...DEFAULT_ORCHESTRATION_CONFIG.harnessGates,
          ...(parsed.harnessGates || {})
        },
        mcpPermissions: {
          ...DEFAULT_ORCHESTRATION_CONFIG.mcpPermissions,
          ...(parsed.mcpPermissions || {})
        }
      };
    }
  } catch {
    // ignore
  }
  return DEFAULT_ORCHESTRATION_CONFIG;
}

export function saveOrchestrationConfig(config: AgentOrchestrationConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // ignore
  }
}
