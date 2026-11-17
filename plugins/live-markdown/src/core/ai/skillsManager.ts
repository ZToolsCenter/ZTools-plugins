import type { AiSkill } from "../../types/typora";
import { cloneSkill, validateSkill, type AiSkillDraft } from "./skillValidation";

const builtinCatalog: AiSkill[] = [
  {
    id: "mermaid-architect", name: "Mermaid 架构图生成", description: "将文本描述或当前方案转换为标准 Mermaid 2D 流程图或架构图", icon: "Workflow", category: "diagram",
    systemPrompt: "你是一位顶尖的软件系统架构师。请将用户提供的内容转换为标准的 Mermaid 语法代码块。只输出带有 ```mermaid 标记的代码块，不要输出任何多余的废话。",
    userPromptTemplate: "请根据以下方案或内容，设计一个结构清晰、分支合理的 Mermaid 架构图或时序图：\n\n```markdown\n{{content}}\n```"
  },
  {
    id: "academic-polish", name: "学术论文规范润色", description: "提升学术严谨性，规范专业术语，优化句式连贯性与论证力度", icon: "GraduationCap", category: "academic",
    systemPrompt: "你是一位顶尖学术期刊审稿人。请对用户提供的段落进行学术级润色，保持客观、严谨，使用精准的技术术语，消除口语化表达。",
    userPromptTemplate: "请对以下 Markdown 内容进行学术级润色，保留原意但大幅提升表达质量：\n\n```markdown\n{{content}}\n```"
  },
  {
    id: "polish", name: "Markdown 文稿润色", description: "改善普通文稿的清晰度与流畅度，同时保留原意、事实和 Markdown 结构", icon: "WandSparkles", category: "writing",
    systemPrompt: "你是一位专业中文编辑。润色表达，使语言清晰、自然、简洁；保留作者原意、事实、语气与 Markdown 结构，不添加标题或未经提供的信息。",
    userPromptTemplate: "请润色以下 Markdown 正文，只改善表达清晰度和流畅度，保留原意、事实和格式。\n\n【当前分块】\n{{content}}"
  },
  {
    id: "tech-spec", name: "技术方案规范整理", description: "按照大型技术团队标准规范整理技术方案（背景、目标、架构、风险）", icon: "FileCode", category: "writing",
    systemPrompt: "你是一位资深技术专家。请将用户的内容整理成符合大厂标准的技术方案文档，包含：一、背景与现状，二、设计目标，三、核心架构设计，四、风险与降级预案。",
    userPromptTemplate: "请将以下草稿整理为规范的大型技术方案文档：\n\n```markdown\n{{content}}\n```"
  },
  {
    id: "quick-summarize", name: "要点总结与 TL;DR", description: "提取文档核心要点、主要结论与关键行动项（Action Items）", icon: "ListChecks", category: "summary",
    systemPrompt: "你是一位极度高效的高级参谋。请对用户文档进行结构化总结，输出：1. TL;DR 概要；2. 核心观点（最多3点）；3. 关键 Action Items。",
    userPromptTemplate: "请总结以下文档内容，提炼核心结论与执行项：\n\n```markdown\n{{content}}\n```"
  },
  {
    id: "content-expand", name: "段落深度扩写", description: "围绕核心论点补充论据、实现细节、对比分析与应用场景", icon: "Maximize2", category: "writing",
    systemPrompt: "你是一位富有洞见的作家与工程师。请在保持原有主题和结构的基础上，对指定内容进行富有深度的扩写，补充技术细节和论据。",
    userPromptTemplate: "请对以下内容进行深度扩写与充实：\n\n```markdown\n{{content}}\n```"
  },
  {
    id: "typo-proofread", name: "排版与错别字校对", description: "修正错别字、标点符号、中英文混排空格（盘古之白）与语法瑕疵", icon: "CheckCheck", category: "writing",
    systemPrompt: "你是一位专业的中英文文字校对专家。请检查拼写、语病与格式排版，严格遵循中文排版规范（在中英文与数字间自动增加一个半角空格）。直接输出校对后的完整正文。",
    userPromptTemplate: "请校对以下 Markdown 内容并规范排版：\n\n```markdown\n{{content}}\n```"
  }
];

export const BUILTIN_SKILLS: readonly AiSkill[] = Object.freeze(builtinCatalog.map((skill) => Object.freeze(skill)));

export interface SkillsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface AiSkillEntry {
  skill: AiSkill;
  builtIn: boolean;
}

export interface SkillsManagerOptions {
  storage?: SkillsStorage | null;
  maxCustomSkills?: number;
  idFactory?: () => string;
}

export const SKILLS_STORAGE_KEY = "typora.ai.skills.v1";
export const DEFAULT_MAX_CUSTOM_SKILLS = 30;
const MAX_STORAGE_CHARACTERS = 200_000;
const builtinIds = new Set(BUILTIN_SKILLS.map((skill) => skill.id));
const reservedActionIds = new Set(["continue", "polish", "expand", "summarize", "translate", "proofread", "diagram", "custom"]);

function assertCustomId(id: unknown, used: Set<string>): asserts id is string {
  if (typeof id !== "string" || id.length > 80 || !/^[a-z0-9][a-z0-9_-]*$/.test(id)) {
    throw new Error("技能 ID 格式无效，必须为 1–80 位小写字母、数字、短横线或下划线。");
  }
  if (builtinIds.has(id) || reservedActionIds.has(id)) throw new Error(`技能 ID「${id}」为内置或快捷操作保留，不能使用。`);
  if (used.has(id)) throw new Error(`技能 ID「${id}」重复。`);
}

function browserStorage(): SkillsStorage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; }
  catch { return null; }
}

function defaultIdToken(): string {
  if (globalThis.crypto?.getRandomValues) {
    return Array.from(globalThis.crypto.getRandomValues(new Uint32Array(2)), (part) => part.toString(36)).join("");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function uniqueId(name: string, used: Set<string>, token: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "skill";
  const base = `custom-${slug}-${token.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "new"}`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}

export class SkillsManager {
  private customSkills: AiSkill[] = [];
  private readonly storage: SkillsStorage | null;
  private readonly maxCustomSkills: number;
  private readonly idFactory: () => string;
  private persistenceIssue: string | null = null;

  constructor(customSkills: AiSkill[] = [], options: SkillsManagerOptions = {}) {
    this.storage = options.storage === undefined ? browserStorage() : options.storage;
    this.maxCustomSkills = options.maxCustomSkills ?? DEFAULT_MAX_CUSTOM_SKILLS;
    this.idFactory = options.idFactory ?? defaultIdToken;
    const initialSkills = this.validateInitialSkills(customSkills);
    this.customSkills = this.readStoredSkills();
    if (initialSkills.length && this.customSkills.length === 0) this.customSkills = initialSkills;
  }

  public getAllSkills(): AiSkill[] {
    return [...BUILTIN_SKILLS, ...this.customSkills].map(cloneSkill);
  }

  public getAllEntries(): AiSkillEntry[] {
    return [
      ...BUILTIN_SKILLS.map((skill) => ({ skill: cloneSkill(skill), builtIn: true })),
      ...this.customSkills.map((skill) => ({ skill: cloneSkill(skill), builtIn: false }))
    ];
  }

  public getSkillById(id: string): AiSkill | undefined {
    const skill = this.findSkill(id);
    return skill ? cloneSkill(skill) : undefined;
  }

  public getPersistenceIssue(): string | null { return this.persistenceIssue; }
  public getMaxCustomSkills(): number { return this.maxCustomSkills; }

  public createSkill(draft: AiSkillDraft): AiSkill {
    if (this.customSkills.length >= this.maxCustomSkills) throw new Error(`最多只能保存 ${this.maxCustomSkills} 个自定义技能。`);
    const normalized = validateSkill(draft);
    const used = new Set([...builtinIds, ...this.customSkills.map((skill) => skill.id)]);
    const skill = { ...normalized, id: uniqueId(normalized.name, used, this.idFactory()) };
    this.persist([...this.customSkills, skill]);
    this.customSkills = [...this.customSkills, skill];
    return cloneSkill(skill);
  }

  public cloneSkill(id: string, name?: string): AiSkill {
    const source = this.findSkill(id);
    if (!source) throw new Error("找不到要复制的技能。");
    return this.createSkill({ ...source, name: name?.trim() || `${source.name}（副本）` });
  }

  public updateSkill(id: string, draft: AiSkillDraft): AiSkill {
    const index = this.customSkills.findIndex((skill) => skill.id === id);
    if (index < 0) throw new Error(builtinIds.has(id) ? "内置技能不可覆盖。" : "找不到要编辑的自定义技能。");
    const skill = { ...validateSkill(draft), id };
    const next = this.customSkills.map((item, itemIndex) => itemIndex === index ? skill : item);
    this.persist(next);
    this.customSkills = next;
    return cloneSkill(skill);
  }

  public deleteSkill(id: string): void {
    if (builtinIds.has(id)) throw new Error("内置技能不可删除。");
    const next = this.customSkills.filter((skill) => skill.id !== id);
    if (next.length === this.customSkills.length) throw new Error("找不到要删除的自定义技能。");
    this.persist(next);
    this.customSkills = next;
  }

  public renderSkillPrompt(skillId: string, content: string, extraInstruction?: string): { systemPrompt: string; userPrompt: string } {
    const skill = this.findSkill(skillId);
    if (!skill) throw new Error(`Skill with id "${skillId}" not found`);
    const userPrompt = skill.userPromptTemplate.replace(/\{\{content\}\}/g, () => content);
    return { systemPrompt: skill.systemPrompt, userPrompt: extraInstruction ? `${userPrompt}\n\n补充要求：${extraInstruction}` : userPrompt };
  }

  private findSkill(id: string): AiSkill | undefined {
    return BUILTIN_SKILLS.find((skill) => skill.id === id) ?? this.customSkills.find((skill) => skill.id === id);
  }

  private validateInitialSkills(skills: AiSkill[]): AiSkill[] {
    if (skills.length > this.maxCustomSkills) throw new Error(`初始化技能超过容量上限 ${this.maxCustomSkills}。`);
    const used = new Set([...builtinIds, ...reservedActionIds]);
    return skills.map((item) => {
      assertCustomId(item?.id, used);
      const normalized = { ...validateSkill(item), id: item.id };
      used.add(normalized.id);
      return normalized;
    });
  }

  private readStoredSkills(): AiSkill[] {
    if (!this.storage) return [];
    let raw: string | null;
    try { raw = this.storage.getItem(SKILLS_STORAGE_KEY); }
    catch { this.persistenceIssue = "无法读取技能存储；内置技能仍可使用，请检查宿主存储权限。"; return []; }
    if (!raw) return [];
    if (raw.length > MAX_STORAGE_CHARACTERS) {
      this.persistenceIssue = "自定义技能存储超出安全容量，已仅加载内置技能。";
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error("技能数据格式无效");
      const valid: AiSkill[] = [];
      const ids = new Set([...builtinIds, ...reservedActionIds]);
      let skipped = false;
      for (const item of parsed) {
        try {
          if (!item || typeof item !== "object") throw new Error("invalid record");
          assertCustomId(item.id, ids);
          const normalized = { ...validateSkill(item), id: item.id };
          ids.add(normalized.id);
          valid.push(normalized);
        } catch { skipped = true; }
      }
      if (valid.length > this.maxCustomSkills) {
        this.persistenceIssue = `已恢复前 ${this.maxCustomSkills} 个自定义技能；其余条目超过容量上限。`;
        return valid.slice(0, this.maxCustomSkills);
      }
      if (skipped) this.persistenceIssue = "部分损坏或重复的技能数据已跳过，其余技能已恢复。";
      return valid;
    } catch {
      this.persistenceIssue = "自定义技能数据损坏，已安全回退到内置技能；创建或保存自定义技能后可重建存储。";
      return [];
    }
  }

  private persist(skills: AiSkill[]): void {
    if (!this.storage) throw new Error("当前环境不支持本地技能存储，未保存任何更改。");
    const serialized = JSON.stringify(skills);
    if (serialized.length > MAX_STORAGE_CHARACTERS) throw new Error("技能内容超出本地存储容量，请缩短提示词后重试。");
    try { this.storage.setItem(SKILLS_STORAGE_KEY, serialized); }
    catch (error) {
      const detail = error instanceof Error && error.name === "QuotaExceededError" ? "本地存储空间不足" : "本地存储写入失败";
      throw new Error(`${detail}，更改未保存。请检查存储空间或权限后重试。`);
    }
    this.persistenceIssue = null;
  }
}
