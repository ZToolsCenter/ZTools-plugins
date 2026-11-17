import { describe, expect, it } from "vitest";
import { BUILTIN_SKILLS, SkillsManager, SKILLS_STORAGE_KEY, type SkillsStorage } from "../../src/core/ai/skillsManager";
import type { AiSkill } from "../../src/types/typora";

class MemoryStorage implements SkillsStorage {
  data = new Map<string, string>();
  failRead = false;
  failWrite = false;
  getItem(key: string): string | null { if (this.failRead) throw new Error("read denied"); return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { if (this.failWrite) throw new Error("write denied"); this.data.set(key, value); }
}

const draft = (overrides: Partial<Omit<AiSkill, "id">> = {}): Omit<AiSkill, "id"> => ({
  name: "Release reviewer", description: "Review release notes", icon: "Sparkles", category: "writing",
  systemPrompt: "You review release notes carefully.",
  userPromptTemplate: "Review this source:\n\n{{content}}", ...overrides
});

describe("SkillsManager persistence and safety", () => {
  it("provides a general Markdown polish Skill alongside exactly one summary Skill", () => {
    const manager = new SkillsManager([], { storage: new MemoryStorage() });
    expect(manager.getSkillById("polish")?.category).toBe("writing");
    expect(manager.getSkillById("polish")?.userPromptTemplate).toContain("【当前分块】\n{{content}}");
    expect(manager.getSkillById("quick-summarize")?.category).toBe("summary");
    expect(manager.getAllSkills().filter((skill) => skill.category === "summary")).toHaveLength(1);
  });

  it("returns clone-safe entries and refuses to update or delete built-ins", () => {
    const manager = new SkillsManager([], { storage: new MemoryStorage() });
    const entries = manager.getAllEntries();
    entries[0].skill.name = "Changed outside manager";
    manager.getAllSkills()[0].systemPrompt = "changed";

    expect(manager.getSkillById(BUILTIN_SKILLS[0].id)?.name).toBe(BUILTIN_SKILLS[0].name);
    expect(() => manager.updateSkill(BUILTIN_SKILLS[0].id, draft())).toThrow(/内置技能不可覆盖/);
    expect(() => manager.deleteSkill(BUILTIN_SKILLS[0].id)).toThrow(/内置技能不可删除/);
  });

  it("clones built-ins into custom skills and restores create, update, and delete from injected storage", () => {
    const storage = new MemoryStorage();
    const manager = new SkillsManager([], { storage, idFactory: () => "same-id" });
    const first = manager.cloneSkill("academic-polish");
    const second = manager.cloneSkill("academic-polish");
    expect(first.id).not.toBe(second.id);
    expect(manager.getAllEntries().find((entry) => entry.skill.id === first.id)?.builtIn).toBe(false);
    manager.updateSkill(first.id, draft({ name: "Updated reviewer" }));

    const restored = new SkillsManager([], { storage });
    expect(restored.getSkillById(first.id)?.name).toBe("Updated reviewer");
    restored.deleteSkill(second.id);
    expect(new SkillsManager([], { storage }).getSkillById(second.id)).toBeUndefined();
    expect(storage.data.has(SKILLS_STORAGE_KEY)).toBe(true);
  });

  it("validates required fields and requires the content placeholder", () => {
    const manager = new SkillsManager([], { storage: new MemoryStorage() });
    expect(() => manager.createSkill(draft({ userPromptTemplate: "No insertion point" }))).toThrow(/必须包含 \{\{content\}\}/);
    expect(() => manager.createSkill(draft({ name: "  " }))).toThrow(/名称不能为空/);
    expect(() => manager.createSkill(draft({ category: "other" as AiSkill["category"] }))).toThrow(/有效的技能类别/);
  });

  it("inserts content literally, including replacement metacharacters and repeated placeholders", () => {
    const manager = new SkillsManager([], { storage: new MemoryStorage() });
    const skill = manager.createSkill(draft({ userPromptTemplate: "{{content}} | {{content}}" }));
    expect(manager.renderSkillPrompt(skill.id, "$& $1 $` $$").userPrompt).toBe("$& $1 $` $$ | $& $1 $` $$");
  });

  it("does not claim success or mutate memory if storage write fails", () => {
    const storage = new MemoryStorage();
    const manager = new SkillsManager([], { storage });
    storage.failWrite = true;
    expect(() => manager.createSkill(draft())).toThrow(/更改未保存/);
    expect(manager.getAllEntries().filter((entry) => !entry.builtIn)).toHaveLength(0);
  });

  it("recovers from damaged data and reports the recovery to the caller", () => {
    const storage = new MemoryStorage();
    storage.data.set(SKILLS_STORAGE_KEY, "{bad json");
    const manager = new SkillsManager([], { storage });
    expect(manager.getAllSkills().length).toBe(BUILTIN_SKILLS.length);
    expect(manager.getPersistenceIssue()).toMatch(/数据损坏/);
    expect(() => manager.createSkill(draft())).not.toThrow();
    expect(manager.getPersistenceIssue()).toBeNull();
  });

  it("skips invalid records and enforces the custom skill capacity", () => {
    const storage = new MemoryStorage();
    const manager = new SkillsManager([], { storage, maxCustomSkills: 1, idFactory: () => "one" });
    manager.createSkill(draft());
    expect(() => manager.createSkill(draft({ name: "Second" }))).toThrow(/最多只能保存 1 个/);

    const malformed = new MemoryStorage();
    malformed.data.set(SKILLS_STORAGE_KEY, JSON.stringify([{ id: "bad", name: "incomplete" }]));
    const recovered = new SkillsManager([], { storage: malformed });
    expect(recovered.getAllEntries().filter((entry) => !entry.builtIn)).toHaveLength(0);
    expect(recovered.getPersistenceIssue()).toMatch(/部分损坏/);
  });

  it("validates constructor and stored custom IDs while restoring valid legacy IDs", () => {
    const legacy: AiSkill = { id: "legacy-review-skill", ...draft() };
    const storage = new MemoryStorage();
    storage.data.set(SKILLS_STORAGE_KEY, JSON.stringify([
      legacy,
      { ...draft(), id: "polish" },
      { ...draft(), id: "invalid id" },
      { ...draft(), id: "x".repeat(81) }
    ]));
    const recovered = new SkillsManager([], { storage });
    expect(recovered.getSkillById("legacy-review-skill")?.name).toBe(legacy.name);
    expect(recovered.getSkillById("polish")?.name).toBe("Markdown 文稿润色");
    expect(recovered.getPersistenceIssue()).toMatch(/部分损坏/);

    const invalidConstructorSkill = { ...draft(), id: "summarize" } as AiSkill;
    expect(() => new SkillsManager([invalidConstructorSkill], { storage: new MemoryStorage() })).toThrow(/保留/);
    expect(() => new SkillsManager([legacy, legacy], { storage: new MemoryStorage() })).toThrow(/重复/);
    expect(() => new SkillsManager([legacy], { storage: new MemoryStorage(), maxCustomSkills: 0 })).toThrow(/容量上限/);
  });

  it("reports an unavailable storage adapter instead of falling back to memory-only success", () => {
    const manager = new SkillsManager([], { storage: null });
    expect(() => manager.createSkill(draft())).toThrow(/不支持本地技能存储/);
  });
});
