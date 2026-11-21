"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot, screenshotRoot } = require("./browser.cjs");
const { installLocalAiWorkflow } = require("./fixtures/local-ai-workflow.cjs");

async function assertCardFits(page, card, width, height) {
  await page.setViewportSize({ width, height });
  await card.scrollIntoViewIfNeeded();
  const cardBounds = await card.boundingBox();
  const actionBar = card.locator(".ty-ai-skills-card-actions");
  const actionBounds = await actionBar.boundingBox();
  assert.ok(cardBounds && actionBounds, `skill card and actions should render at ${width}x${height}`);
  assert.ok(actionBounds.x >= cardBounds.x - 1 && actionBounds.x + actionBounds.width <= cardBounds.x + cardBounds.width + 1, `actions should stay inside the card at ${width}x${height}`);
  const buttonBoxes = await actionBar.locator("button").evaluateAll((buttons) => buttons.map((button) => {
    const rect = button.getBoundingClientRect();
    return { x: rect.x, right: rect.right, centerY: rect.y + rect.height / 2 };
  }));
  assert.ok(buttonBoxes.length >= 3, "skill cards should expose their expected actions");
  assert.ok(buttonBoxes.every((box) => Math.abs(box.centerY - buttonBoxes[0].centerY) <= 3), `card actions should fit on a single row at ${width}x${height}: ${JSON.stringify(buttonBoxes)}`);
  assert.ok(buttonBoxes[0].x >= cardBounds.x - 1 && buttonBoxes.at(-1).right <= cardBounds.x + cardBounds.width + 1, `all action buttons should fit inside the card at ${width}x${height}`);
  const overflow = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }));
  assert.ok(overflow.document <= overflow.viewport + 1, `no horizontal overflow at ${width}x${height}: ${JSON.stringify(overflow)}`);
}

test("Skills UI persists CRUD, protects builtins and runs the saved prompt against the document", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const content = "Original document with $& literal characters.";
  try {
    await page.addInitScript(installLocalAiWorkflow, { configured: true, content });
    const openSkills = async () => {
      await page.locator('[data-testid="top-ai-copilot-btn"]').click();
      await page.getByRole("button", { name: "Skills", exact: true }).click();
    };
    await page.goto(pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
    await openSkills();
    assert.equal(await page.getByRole("heading", { name: "技能库", exact: true }).count(), 1, "the Skills tab should identify its library section");
    const createSkillButton = page.getByRole("button", { name: "新建技能", exact: true });
    assert.equal(await createSkillButton.evaluate((button) => getComputedStyle(button).whiteSpace), "nowrap", "the create button label should not wrap in the heading");
    const builtin = page.locator(".ty-ai-skills-card").filter({ hasText: "Mermaid 架构图生成" });
    assert.equal(await builtin.getByRole("button", { name: "删除", exact: true }).count(), 0);
    assert.equal(await builtin.getByRole("button", { name: "编辑", exact: true }).count(), 0);
    assert.equal(await builtin.getByRole("button", { name: "复制", exact: true }).count(), 1);
    assert.equal(await builtin.locator(".ty-ai-skills-card-icon[aria-hidden='true'] svg").count(), 1, "category icon should be present as decorative metadata");
    assert.equal(await builtin.locator(".ty-ai-skills-card-icon").getAttribute("aria-hidden"), "true", "decorative category icon should not add duplicate screen-reader content");
    await builtin.getByRole("button", { name: "复制", exact: true }).click();
    await page.getByRole("button", { name: "创建技能", exact: true }).waitFor();
    assert.match(await page.getByLabel("名称", { exact: true }).inputValue(), /副本/);
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("button", { name: "新建技能", exact: true }).click();
    await page.getByLabel("名称", { exact: true }).fill("验收写作技能");
    await page.getByLabel("说明", { exact: true }).fill("验证自定义提示词与全文处理。");
    await page.getByLabel("系统提示词", { exact: true }).fill("保持原意，按照验收规则润色。");
    await page.getByLabel("用户提示模板", { exact: true }).fill("不含正文占位符");
    await page.getByRole("button", { name: "创建技能", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "{{content}}" }).waitFor();
    await page.getByLabel("用户提示模板", { exact: true }).fill("验收指令：\n{{content}}\n正文结束。");
    await page.getByRole("button", { name: "创建技能", exact: true }).click();
    let custom = page.locator(".ty-ai-skills-card").filter({ hasText: "验收写作技能" });
    await custom.waitFor();
    const customSkillId = await page.evaluate(name => {
      const skills = JSON.parse(localStorage.getItem("typora.ai.skills.v1") || "[]");
      return skills.find(skill => skill.name === name)?.id ?? null;
    }, "验收写作技能");
    assert.ok(customSkillId, "the created skill should be observable in persistent storage before editing");
    await custom.getByRole("button", { name: "编辑", exact: true }).click();
    await page.getByLabel("名称", { exact: true }).fill("已修改的验收技能");
    await page.getByRole("button", { name: "保存修改", exact: true }).click();
    await page.waitForFunction(({ id, name }) => {
      try {
        const skills = JSON.parse(localStorage.getItem("typora.ai.skills.v1") || "[]");
        return skills.some(skill => skill.id === id && skill.name === name);
      } catch { return false; }
    }, { id: customSkillId, name: "已修改的验收技能" });
    const savedSkill = await page.evaluate(id => {
      const skills = JSON.parse(localStorage.getItem("typora.ai.skills.v1") || "[]");
      return skills.find(skill => skill.id === id) ?? null;
    }, customSkillId);
    assert.deepEqual({ name: savedSkill?.name, systemPrompt: savedSkill?.systemPrompt, userPromptTemplate: savedSkill?.userPromptTemplate }, {
      name: "已修改的验收技能", systemPrompt: "保持原意，按照验收规则润色。", userPromptTemplate: "验收指令：\n{{content}}\n正文结束。"
    }, "the edited skill fields should be present in persistent storage before reload");
    await page.reload();
    await openSkills();
    custom = page.locator(".ty-ai-skills-card").filter({ hasText: "已修改的验收技能" });
    await custom.waitFor();
    await custom.getByRole("button", { name: "运行", exact: true }).click();
    await page.waitForFunction(() => window.__workflow.requests.length === 1);
    const input = await page.evaluate(() => window.__workflow.requestInputs()[0]);
    assert.match(input.systemPrompt, /保持原意，按照验收规则润色/);
    assert.ok(input.prompt.includes(content), "saved prompt must receive complete document including literal replacement characters");
    assert.ok(input.prompt.startsWith("验收指令："));
    const sourceEnd = input.prompt.indexOf(content) + content.length;
    assert.ok(input.prompt.indexOf("\n正文结束。", sourceEnd) >= 0, "the saved template suffix should follow the complete source after reload");
    await page.evaluate(text => window.__workflow.resolve(0, text), content);
    await page.locator(".ty-ai-result").waitFor();
    assert.equal(await page.getByRole("button", { name: "助手", exact: true }).getAttribute("class"), "active");
    assert.equal(await page.locator(".ty-ai-error,.ty-ai-review").count(), 0, "an unchanged custom Skill result is not an error or an applicable edit");
    assert.match(await page.locator(".ty-ai-notice").innerText(), /文档保持不变/);
    assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1, "unchanged results never trigger a repair call");
    assert.equal(await page.locator(".ty-ai-result pre").textContent(), content, "the unchanged result preserves every source character");
    await page.getByTestId("top-viewmode-cycle-btn").evaluate(button => button.click());
    assert.equal(await page.locator("textarea.ty-source-textarea").inputValue(), content, "running an unchanged Skill leaves the document untouched");
    await page.getByRole("button", { name: "Skills", exact: true }).click();
    await custom.getByRole("button", { name: "删除", exact: true }).click();
    await page.getByRole("dialog", { name: "删除自定义技能？" }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "删除自定义技能？" }).waitFor({ state: "detached" });
    assert.equal(await custom.count(), 1, "Escape must cancel deletion");
    await custom.getByRole("button", { name: "删除", exact: true }).click();
    await page.getByRole("dialog", { name: "删除自定义技能？" }).getByRole("button", { name: "删除技能", exact: true }).click();
    await custom.waitFor({ state: "detached" });
    await page.waitForFunction(id => {
      try {
        const skills = JSON.parse(localStorage.getItem("typora.ai.skills.v1") || "[]");
        return !skills.some(skill => skill.id === id);
      } catch { return false; }
    }, customSkillId);
    await page.reload();
    await openSkills();
    assert.equal(await custom.count(), 0, "deletion must survive reload");
    await page.getByRole("button", { name: "新建技能", exact: true }).click();
    const longName = "A".repeat(48) + "中文".repeat(16);
    const longDescription = ("这是一段用于验证长文本布局、描述截断以及窄侧栏操作区边界的说明。".repeat(8)).slice(0, 240);
    assert.equal(longName.length, 80, "the stress name should cover the full 80-character validation limit");
    assert.equal(longDescription.length, 240, "the stress description should stay within the 240-character validation limit");
    await page.getByLabel("名称", { exact: true }).fill(longName);
    await page.getByLabel("说明", { exact: true }).fill(longDescription);
    await page.getByLabel("系统提示词", { exact: true }).fill("保持原文并执行边界布局验收。");
    await page.getByLabel("用户提示模板", { exact: true }).fill("处理正文：\n{{content}}");
    await page.getByRole("button", { name: "创建技能", exact: true }).click();
    const longCard = page.locator(".ty-ai-skills-card").filter({ has: page.locator(".ty-ai-skills-card-name", { hasText: longName }) });
    await longCard.waitFor();
    const longTitle = longCard.locator(".ty-ai-skills-card-name");
    assert.equal(await longTitle.innerText(), longName, "the complete skill name should remain available in the heading");
    assert.equal(await longTitle.getAttribute("title"), longName, "truncated visual titles should expose the complete name on hover");
    const description = longCard.locator(".ty-ai-skills-card-description");
    assert.equal(await description.getAttribute("title"), longDescription, "long descriptions should remain available in the title attribute");
    assert.equal(await description.evaluate((element) => getComputedStyle(element).webkitLineClamp), "2", "long skill descriptions should clamp to two visual lines");
    for (const viewport of [{ width: 320, height: 820 }, { width: 380, height: 820 }, { width: 900, height: 480 }]) {
      await page.setViewportSize(viewport);
      await longCard.scrollIntoViewIfNeeded();
      await longCard.getByRole("button", { name: "查看", exact: true }).click();
      const detail = page.getByRole("region", { name: "技能详情" });
      await detail.waitFor();
      assert.equal(await detail.getByRole("heading", { level: 2 }).innerText(), longName, "the detail heading should expose the complete long name");
      const detailOverflow = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }));
      assert.ok(detailOverflow.document <= detailOverflow.viewport + 1, `long detail heading should not cause horizontal overflow at ${viewport.width}px: ${JSON.stringify(detailOverflow)}`);
      await detail.getByRole("button", { name: "返回技能列表", exact: true }).click();
      await longCard.waitFor();
      await assertCardFits(page, longCard, viewport.width, viewport.height);
      assert.equal(await longCard.locator(".ty-ai-skills-card-name").innerText(), longName, "the full title should remain readable at narrow widths");
      assert.equal(await createSkillButton.evaluate((button) => getComputedStyle(button).whiteSpace), "nowrap", "the create button should stay on one line at narrow widths");
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await longCard.getByRole("button", { name: "删除", exact: true }).click();
    await page.getByRole("dialog", { name: "删除自定义技能？" }).getByRole("button", { name: "删除技能", exact: true }).click();
    await longCard.waitFor({ state: "detached" });
    await page.screenshot({ path: path.join(screenshotRoot, "skills-management-accepted.png") });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
