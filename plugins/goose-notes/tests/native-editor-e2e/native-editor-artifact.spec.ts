import { expect, test, type Page } from "playwright/test";

type HostMessage = {
  version: number;
  type: string;
  requestID: string;
  pageID: string;
  revision: number;
  markdown?: string;
  hasChanges?: boolean;
  message?: string;
};

type EditorDraft = {
  version: 1;
  requestID: string;
  pageID: string;
  revision: number;
  baseRevision: number;
  title: string;
  markdown: string;
  hasChanges: boolean;
};

type EditorPage = {
  version: 1;
  requestID: string;
  pageID: string;
  revision: number;
  generation: number;
  title: string;
  markdown: string;
  appearance: "light" | "dark";
  editorFont: "sans" | "serif" | "mono";
  editorFontSize: number;
  fullWidth: boolean;
  reduceMotion: boolean;
  increaseContrast: boolean;
};

type SaveAcknowledgement = {
  version: 1;
  requestID: string;
  pageID: string;
  revision: number;
  status: "saved" | "conflict" | "failed";
  message?: string;
};

type NativeEditorTestWindow = Window & {
  __nativeEditorHost: { messages: HostMessage[] };
  __nativeEditorFlush?: Promise<EditorDraft>;
  __nativeEditorFlushSettled?: boolean;
  gooseEditor: {
    receivePage(page: EditorPage): Promise<void> | void;
    receiveAcknowledgement(acknowledgement: SaveAcknowledgement): void;
    updatePreferences(preferences: EditorPage): void;
    dispatchCommand(command: {
      version: 1;
      requestID: string;
      pageID: string;
      revision: number;
      name:
        | "bold"
        | "italic"
        | "underline"
        | "strike"
        | "code"
        | "alignLeft"
        | "alignCenter"
        | "alignRight"
        | "clearFormatting"
        | "find"
        | "findNext"
        | "findPrevious";
    }): void;
    flushAndGetDraft(envelope: {
      version: 1;
      requestID: string;
      pageID: string;
      revision: number;
    }): Promise<EditorDraft>;
  };
  webkit: {
    messageHandlers: {
      gooseNotes: {
        postMessage(message: HostMessage): void;
      };
    };
  };
  __gooseBridgeContext?: { pageID: string; revision: number };
};

let sequence = 0;

function requestID(prefix: string) {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

function pagePayload(
  markdown: string,
  overrides: Partial<EditorPage> = {},
): EditorPage {
  const generation = overrides.generation ?? 1;
  return {
    version: 1,
    requestID: requestID("receive-page"),
    pageID: "file:///tmp/native-editor-flow.md",
    revision: 1,
    generation,
    title: "native-editor-flow.md",
    markdown,
    appearance: "light",
    editorFont: "sans",
    editorFontSize: 16,
    fullWidth: false,
    reduceMotion: false,
    increaseContrast: false,
    ...overrides,
  };
}

function envelope(pageID: string, revision: number) {
  return {
    version: 1 as const,
    requestID: requestID("flush"),
    pageID,
    revision,
  };
}

async function hostMessages(page: Page, type?: string) {
  return await page.evaluate((messageType) => {
    const messages = (window as unknown as NativeEditorTestWindow).__nativeEditorHost.messages;
    return messageType ? messages.filter((message) => message.type === messageType) : messages;
  }, type);
}

async function waitForHostMessage(page: Page, type: string, minimumCount = 1) {
  await expect.poll(async () => (await hostMessages(page, type)).length).toBeGreaterThanOrEqual(
    minimumCount,
  );
  const messages = await hostMessages(page, type);
  return messages[messages.length - 1];
}

async function receivePage(page: Page, payload: EditorPage) {
  await page.evaluate(async (nextPage) => {
    await (window as unknown as NativeEditorTestWindow).gooseEditor.receivePage(nextPage);
  }, payload);
  await expect(page.getByTestId("editor-surface")).toHaveAttribute("data-loading", "false");
}

async function flush(page: Page, pageID: string, revision: number) {
  return await page.evaluate(
    async (bridgeEnvelope) =>
      await (window as unknown as NativeEditorTestWindow).gooseEditor.flushAndGetDraft(bridgeEnvelope),
    envelope(pageID, revision),
  );
}

async function acknowledge(page: Page, acknowledgement: SaveAcknowledgement) {
  await page.evaluate((ack) => {
    (window as unknown as NativeEditorTestWindow).gooseEditor.receiveAcknowledgement(ack);
  }, acknowledgement);
}

async function blockEditor(page: Page) {
  const editor = page.getByRole("textbox").first();
  await expect(editor).toBeVisible();
  return editor;
}

test.describe("native-editor build artifact bridge flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const host = { messages: [] as HostMessage[] };
      const nativeWindow = window as unknown as NativeEditorTestWindow;
      nativeWindow.__nativeEditorHost = host;
      nativeWindow.webkit = {
        messageHandlers: {
          gooseNotes: {
            postMessage(message) {
              host.messages.push(structuredClone(message));
            },
          },
        },
      };
    });
    await page.goto("/index.html");
    await waitForHostMessage(page, "ready");
  });

  test("posts one valid ready envelope from the production artifact", async ({ page }) => {
    const readyMessages = await hostMessages(page, "ready");
    expect(readyMessages).toHaveLength(1);
    expect(readyMessages[0]).toMatchObject({
      version: 1,
      type: "ready",
      pageID: "",
      revision: 0,
    });
    expect(readyMessages[0].requestID).toBeTruthy();
    await expect(page.getByLabel("未打开文件")).toContainText(
      "新建或打开 Markdown 文件开始写作",
    );
  });

  test("原生 AI 入口只请求原生工作区面板，不发起网络请求", async ({ page }) => {
    await receivePage(page, pagePayload("\n"));
    const editor = await blockEditor(page);
    await editor.fill("/");
    await expect(page.getByText("生成", { exact: true })).toBeVisible();
    await page.getByText("生成", { exact: true }).click();
    expect((await hostMessages(page)).filter((message) => message.type === "aiWorkspaceEntry")).toHaveLength(1);

    await editor.fill("");
    await editor.press("Space");
    expect((await hostMessages(page)).filter((message) => message.type === "aiWorkspaceEntry")).toHaveLength(2);
    expect((await hostMessages(page)).filter((message) => message.type === "aiRequest")).toHaveLength(0);
  });

  test("finishes a repair gate commit even when requestAnimationFrame is suspended", async ({ page }) => {
    const payload = pagePayload("> [!NOTE]\n> 后台窗口也要完成装载。\n");
    const state = await page.evaluate(async (nextPage) => {
      const nativeWindow = window as unknown as NativeEditorTestWindow;
      const originalRequestAnimationFrame = window.requestAnimationFrame;
      window.requestAnimationFrame = () => 1;
      try {
        await Promise.race([
          Promise.resolve(nativeWindow.gooseEditor.receivePage(nextPage)),
          new Promise<never>((_, reject) => {
            window.setTimeout(() => reject(new Error("页面提交超时")), 1_000);
          }),
        ]);
        const root = document.querySelector<HTMLElement>(".native-editor-root");
        return {
          mode: root?.dataset.editorMode,
          loading: root?.dataset.loading,
          hasGate: Boolean(document.querySelector('[data-testid="format-repair-gate"]')),
        };
      } finally {
        window.requestAnimationFrame = originalRequestAnimationFrame;
      }
    }, payload);

    expect(state).toEqual({
      mode: "repair-required",
      loading: "false",
      hasGate: true,
    });
  });

  test("renders normal blocks and flushes untouched Markdown byte-for-byte", async ({ page }) => {
    const markdown = "# 标题\r\n\r\n正文\r\n\r\n- 第一项\r\n- 第二项\r\n\r\n";
    const payload = pagePayload(markdown);
    await receivePage(page, payload);

    await expect(page.getByRole("heading", { name: "标题" })).toBeVisible();
    await expect(page.getByText("正文", { exact: true })).toBeVisible();
    await expect(page.getByText("第一项", { exact: true })).toBeVisible();

    const editor = await blockEditor(page);
    await editor.focus();
    const focusStyle = await editor.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        ringShadow: style.getPropertyValue("--tw-ring-shadow").trim(),
      };
    });
    expect(focusStyle.outlineStyle).toBe("none");
    expect(focusStyle.outlineWidth).toBe("0px");
    expect(focusStyle.ringShadow).toContain("#0000");

    const draft = await flush(page, payload.pageID, payload.revision);
    expect(draft).toMatchObject({
      pageID: payload.pageID,
      revision: payload.revision,
      baseRevision: payload.revision,
      markdown,
      hasChanges: false,
    });
  });

  test("keeps toggle headings and dividers as the same block types after save and reload", async ({
    page,
  }) => {
    const payload = pagePayload("");
    await receivePage(page, payload);
    const editor = await blockEditor(page);
    await editor.fill("/");

    const toggleHeadingItem = page.getByRole("button", { name: /折叠一级标题/ });
    await expect(toggleHeadingItem).toBeVisible();
    await toggleHeadingItem.click();
    await page.keyboard.type("可折叠章节");

    const draft = await flush(page, payload.pageID, payload.revision);
    expect(draft.hasChanges).toBe(true);
    expect(draft.markdown).toContain("<details>");
    expect(draft.markdown).toContain("goose-note:native-toggle-heading=");
    expect(draft.markdown).toContain("可折叠章节");

    await receivePage(page, pagePayload(`${draft.markdown}\n\n---`, {
      generation: 2,
      revision: 2,
    }));

    const heading = page.getByRole("heading", { name: "可折叠章节" });
    await expect(heading).toBeVisible();
    await expect(
      heading.locator("xpath=ancestor::*[contains(@class, 'bn-block-content')][1]")
        .locator(".bn-toggle-wrapper"),
    ).toHaveCount(1);
    await expect(
      page.locator('.bn-block-content[data-content-type="divider"]'),
    ).toHaveCount(1);

    const settled = await flush(page, payload.pageID, 2);
    expect(settled.markdown).toBe(`${draft.markdown}\n\n---`);
    expect(settled.hasChanges).toBe(false);
  });

  test("ships every editor-only slash block in the production artifact", async ({ page }) => {
    const payload = pagePayload("");
    await receivePage(page, payload);
    const editor = await blockEditor(page);
    await editor.fill("/");

    for (const title of [
      "一级标题",
      "二级标题",
      "三级标题",
      "折叠一级标题",
      "折叠二级标题",
      "折叠三级标题",
      "待办事项",
      "无序列表",
      "有序列表",
      "折叠列表",
      "引用",
      "标注",
      "分隔线",
      "表格",
      "代码块",
      "数学公式",
      "Mermaid 图表",
      "图片",
      "视频",
      "文件",
    ]) {
      await expect(page.getByRole("button", { name: new RegExp(`^${title}`) })).toHaveCount(1);
    }
    await expect(page.getByRole("button", { name: /生成/ })).toHaveCount(1);
  });

  test("preserves native block alignment metadata without exposing the marker", async ({ page }) => {
    const markdown = "<!-- goose-note:native-block-props=%7B%22textAlignment%22%3A%22center%22%7D -->居中段落";
    const payload = pagePayload(markdown);
    await receivePage(page, payload);

    const paragraph = page.locator('.bn-block-content[data-content-type="paragraph"]');
    await expect(paragraph).toHaveCount(1);
    await expect(paragraph).toHaveCSS("text-align", "center");
    await expect(await blockEditor(page)).toContainText("居中段落");
    await expect(await blockEditor(page)).not.toContainText("goose-note:native-block-props");

    const draft = await flush(page, payload.pageID, payload.revision);
    expect(draft.markdown).toBe(markdown);
    expect(draft.hasChanges).toBe(false);
  });

  test("applies bridged editor font size with clamping", async ({ page }) => {
    const payload = pagePayload("字号桥接");
    await receivePage(page, payload);

    await page.evaluate((preferences) => {
      (window as unknown as NativeEditorTestWindow).gooseEditor.updatePreferences(preferences);
    }, { ...payload, requestID: requestID("preferences"), editorFontSize: 21 });

    await expect(page.getByTestId("editor-surface")).toHaveAttribute("data-font-size", "21");
    await expect(await blockEditor(page)).toHaveCSS("font-size", "21px");
    const variables = await page.evaluate(() => ({
      size: document.documentElement.style.getPropertyValue("--editor-font-size"),
      scale: document.documentElement.style.getPropertyValue("--editor-scale"),
    }));
    expect(variables).toEqual({ size: "21px", scale: "1.3125" });

    await page.evaluate((preferences) => {
      (window as unknown as NativeEditorTestWindow).gooseEditor.updatePreferences(preferences);
    }, { ...payload, requestID: requestID("preferences"), editorFontSize: 100 });
    await expect(page.getByTestId("editor-surface")).toHaveAttribute("data-font-size", "24");
  });

  test("opens and navigates the shared find bar through native commands", async ({ page }) => {
    const payload = pagePayload("命中\n\n其他文字\n\n命中");
    await receivePage(page, payload);

    const command = (name: "find" | "findNext" | "findPrevious") => page.evaluate(
      (commandName) => {
        const nativeWindow = window as unknown as NativeEditorTestWindow;
        nativeWindow.gooseEditor.dispatchCommand({
          version: 1,
          requestID: "find-command",
          pageID: nativeWindow.__gooseBridgeContext!.pageID,
          revision: nativeWindow.__gooseBridgeContext!.revision,
          name: commandName,
        });
      },
      name,
    );

    await command("find");
    const findInput = page.getByPlaceholder("页内查找");
    await expect(findInput).toBeVisible();
    await findInput.fill("命中");
    await expect(page.getByText("1/2", { exact: true })).toBeVisible();

    await command("findNext");
    await expect(page.getByText("2/2", { exact: true })).toBeVisible();
    await command("findPrevious");
    await expect(page.getByText("1/2", { exact: true })).toBeVisible();
  });

  test("applies native formatting commands to the live selection and clears them", async ({ page }) => {
    const payload = pagePayload("格式命令");
    await receivePage(page, payload);
    const editor = await blockEditor(page);
    const command = (
      name:
        | "bold"
        | "italic"
        | "underline"
        | "strike"
        | "code"
        | "alignCenter"
        | "clearFormatting",
    ) =>
      page.evaluate((commandName) => {
        const nativeWindow = window as unknown as NativeEditorTestWindow;
        nativeWindow.gooseEditor.dispatchCommand({
          version: 1,
          requestID: `format-${commandName}`,
          pageID: nativeWindow.__gooseBridgeContext!.pageID,
          revision: nativeWindow.__gooseBridgeContext!.revision,
          name: commandName,
        });
      }, name);

    await editor.evaluate((element) => {
      const text = element.querySelector<HTMLElement>("p");
      const range = document.createRange();
      range.selectNodeContents(text!);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });

    const expectedTags: Record<"bold" | "italic" | "underline" | "strike" | "code", string> = {
      bold: "strong",
      italic: "em",
      underline: "u",
      strike: "s",
      code: "code",
    };
    for (const [name, tag] of Object.entries(expectedTags) as Array<
      [keyof typeof expectedTags, string]
    >) {
      await command(name);
      await expect(editor.locator(tag)).toHaveCount(1);
    }

    await command("alignCenter");
    await command("clearFormatting");
    await expect(editor.locator("strong, em, u, s, code")).toHaveCount(0);
    // BlockNote 将默认的 left 对齐渲染为 CSS logical value `start`。
    await expect(editor.locator("p").first()).toHaveCSS("text-align", "start");
  });

  test("aligns selected blocks and falls back to the cursor block", async ({ page }) => {
    const payload = pagePayload("第一段\n\n第二段");
    await receivePage(page, payload);
    const editor = await blockEditor(page);
    const command = (name: "alignLeft" | "alignCenter" | "alignRight") => page.evaluate(
      (commandName) => {
        const nativeWindow = window as unknown as NativeEditorTestWindow;
        nativeWindow.gooseEditor.dispatchCommand({
          version: 1,
          requestID: `align-${commandName}`,
          pageID: nativeWindow.__gooseBridgeContext!.pageID,
          revision: nativeWindow.__gooseBridgeContext!.revision,
          name: commandName,
        });
      },
      name,
    );

    await editor.evaluate((element) => {
      const paragraphs = element.querySelectorAll("p");
      const range = document.createRange();
      range.setStartBefore(paragraphs[0]);
      range.setEndAfter(paragraphs[1]);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await command("alignCenter");
    await expect(editor.locator("p").nth(0)).toHaveCSS("text-align", "center");
    await expect(editor.locator("p").nth(1)).toHaveCSS("text-align", "center");

    await editor.locator("p").nth(1).click();
    await command("alignRight");
    await expect(editor.locator("p").nth(0)).toHaveCSS("text-align", "center");
    await expect(editor.locator("p").nth(1)).toHaveCSS("text-align", "right");
  });

  test("waits for the editor to mount when the host flushes in the same turn as receivePage", async ({
    page,
  }) => {
    const markdown = "# 同步装载\n\n正文";
    const payload = pagePayload(markdown);
    const draft = await page.evaluate(async ({ nextPage, flushEnvelope }) => {
      const nativeWindow = window as unknown as NativeEditorTestWindow;
      const receiving = Promise.resolve(nativeWindow.gooseEditor.receivePage(nextPage));
      const flushing = nativeWindow.gooseEditor.flushAndGetDraft(flushEnvelope);
      const [, result] = await Promise.all([receiving, flushing]);
      return result;
    }, {
      nextPage: payload,
      flushEnvelope: envelope(payload.pageID, payload.revision),
    });

    expect(draft).toMatchObject({
      pageID: payload.pageID,
      revision: payload.revision,
      markdown,
      hasChanges: false,
    });
    await expect(page.getByRole("heading", { name: "同步装载" })).toBeVisible();
  });

  test("never flushes the previously mounted editor while a replacement page is committing", async ({
    page,
  }) => {
    const first = pagePayload("旧编辑器内容", {
      generation: 1,
      pageID: "file:///tmp/mounted-first.md",
    });
    const second = pagePayload("替换后的内容", {
      generation: 2,
      pageID: "file:///tmp/mounted-second.md",
    });
    await receivePage(page, first);
    await expect(await blockEditor(page)).toContainText("旧编辑器内容");

    const draft = await page.evaluate(async ({ nextPage, flushEnvelope }) => {
      const bridge = (window as unknown as NativeEditorTestWindow).gooseEditor;
      const receiving = Promise.resolve(bridge.receivePage(nextPage));
      const flushing = bridge.flushAndGetDraft(flushEnvelope);
      const [, result] = await Promise.all([receiving, flushing]);
      return result;
    }, {
      nextPage: second,
      flushEnvelope: envelope(second.pageID, second.revision),
    });

    expect(draft).toMatchObject({
      pageID: second.pageID,
      markdown: "替换后的内容",
      hasChanges: false,
    });
    await expect(await blockEditor(page)).toContainText("替换后的内容");
    await expect(page.getByText("旧编辑器内容", { exact: true })).toHaveCount(0);
  });

  test("waits for repaired blocks to mount when the host flushes immediately after confirmation", async ({
    page,
  }) => {
    const markdown = "> [!NOTE]\n> 立即刷新也必须安全。\n";
    const payload = pagePayload(markdown);
    await receivePage(page, payload);
    const tokenBefore = Number(await page.getByTestId("editor-surface")
      .getAttribute("data-page-load-token"));

    const draft = await page.evaluate(async (flushEnvelope) => {
      const gate = document.querySelector<HTMLElement>('[data-testid="format-repair-gate"]');
      const button = Array.from(gate?.querySelectorAll("button") ?? [])
        .find((candidate) => candidate.textContent?.trim() === "加载并修复格式");
      if (!(button instanceof HTMLButtonElement)) throw new Error("未找到格式修复按钮");
      button.click();
      button.click();
      return await (window as unknown as NativeEditorTestWindow).gooseEditor
        .flushAndGetDraft(flushEnvelope);
    }, envelope(payload.pageID, payload.revision));

    expect(draft.markdown).toContain("立即刷新也必须安全。");
    expect(draft.markdown).not.toContain("[!NOTE]");
    expect(draft.markdown).toContain("[!INFO]");
    expect(draft.hasChanges).toBe(true);
    expect(Number(await page.getByTestId("editor-surface")
      .getAttribute("data-page-load-token"))).toBe(tokenBefore + 1);
    await expect(page.getByTestId("format-repair-gate")).toHaveCount(0);
    await expect(await blockEditor(page)).toContainText("立即刷新也必须安全。");
  });

  test("keeps protected Markdown untouched until repair is confirmed, then saves a stable block format", async ({
    page,
  }) => {
    const markdown = "> [!NOTE]\r\n> 这段内容必须保留原始语义。\r\n";
    const payload = pagePayload(markdown);
    await receivePage(page, payload);

    const gate = page.getByTestId("format-repair-gate");
    await expect(gate).toBeVisible();
    await expect(gate).toContainText("此文件需要先整理格式");
    await expect(page.getByTestId("editor-document")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Markdown 源码" })).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);

    const repairButton = gate.getByRole("button", { name: "加载并修复格式" });
    await expect(repairButton).toBeFocused();
    const repairButtonStyle = await repairButton.evaluate((element) => {
      element.focus();
      const style = getComputedStyle(element);
      return {
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        ringShadow: style.getPropertyValue("--tw-ring-shadow").trim(),
      };
    });
    expect(repairButtonStyle.outlineStyle).toBe("none");
    expect(repairButtonStyle.outlineWidth).toBe("0px");
    expect(repairButtonStyle.ringShadow).toContain("#0000");

    await page.waitForTimeout(500);
    expect(await hostMessages(page, "dirty")).toHaveLength(0);
    expect(await hostMessages(page, "change")).toHaveLength(0);

    const draft = await flush(page, payload.pageID, payload.revision);
    expect(draft.markdown).toBe(markdown);
    expect(draft.hasChanges).toBe(false);

    await gate.getByRole("button", { name: "保持原文" }).click();
    await expect(gate).toContainText("已保持原文");
    expect(await hostMessages(page, "dirty")).toHaveLength(0);
    expect((await flush(page, payload.pageID, payload.revision)).markdown).toBe(markdown);

    await gate.getByRole("button", { name: "修复格式并加载" }).click();
    await expect(gate).toBeHidden();
    const editor = await blockEditor(page);
    await expect(editor).toContainText("这段内容必须保留原始语义。");

    const repairChange = await waitForHostMessage(page, "change");
    expect(repairChange).toMatchObject({
      pageID: payload.pageID,
      revision: payload.revision,
      hasChanges: true,
    });
    expect(repairChange.markdown).toContain("这段内容必须保留原始语义。");
    expect(repairChange.markdown).not.toContain("[!NOTE]");
    expect(repairChange.markdown).toContain("[!INFO]");

    await acknowledge(page, {
      version: 1,
      requestID: repairChange.requestID,
      pageID: payload.pageID,
      revision: 2,
      status: "saved",
    });
    const settledDraft = await flush(page, payload.pageID, 2);
    expect(settledDraft.markdown).toBe(repairChange.markdown);
    expect(settledDraft.hasChanges).toBe(false);

    await receivePage(page, pagePayload(repairChange.markdown!, {
      generation: 2,
      revision: 2,
    }));
    await expect(page.getByTestId("format-repair-gate")).toHaveCount(0);
    await expect(await blockEditor(page)).toContainText("这段内容必须保留原始语义。");
  });

  test("captures input when the host flushes before the editor debounce", async ({ page }) => {
    const payload = pagePayload("初始");
    await receivePage(page, payload);
    const editor = await blockEditor(page);

    await editor.click();
    await page.keyboard.press("End");
    await page.keyboard.insertText("即时输入");
    const draft = await flush(page, payload.pageID, payload.revision);

    expect(draft.markdown).toBe("初始即时输入");
    expect(draft.hasChanges).toBe(true);
  });

  test("waits for a slow acknowledgement, keeps edits made during save, and ignores a stale ack", async ({
    page,
  }) => {
    const payload = pagePayload("开始");
    await receivePage(page, payload);
    const editor = await blockEditor(page);

    await editor.click();
    await page.keyboard.press("End");
    await page.keyboard.insertText("第一段");
    const firstChange = await waitForHostMessage(page, "change");

    await page.evaluate((bridgeEnvelope) => {
      const nativeWindow = window as unknown as NativeEditorTestWindow;
      nativeWindow.__nativeEditorFlushSettled = false;
      nativeWindow.__nativeEditorFlush = nativeWindow.gooseEditor
        .flushAndGetDraft(bridgeEnvelope)
        .finally(() => {
          nativeWindow.__nativeEditorFlushSettled = true;
        });
    }, envelope(payload.pageID, payload.revision));

    await page.keyboard.insertText("保存中追加");
    await acknowledge(page, {
      version: 1,
      requestID: "stale-request",
      pageID: payload.pageID,
      revision: 99,
      status: "saved",
    });
    expect(
      await page.evaluate(
        () => (window as unknown as NativeEditorTestWindow).__gooseBridgeContext?.revision,
      ),
    ).toBe(payload.revision);

    await page.waitForTimeout(700);
    expect(
      await page.evaluate(
        () => (window as unknown as NativeEditorTestWindow).__nativeEditorFlushSettled,
      ),
    ).toBe(false);

    await acknowledge(page, {
      version: 1,
      requestID: firstChange.requestID,
      pageID: payload.pageID,
      revision: 2,
      status: "saved",
    });
    const flushedDraft = await page.evaluate(async () => {
      return await (window as unknown as NativeEditorTestWindow).__nativeEditorFlush!;
    });

    expect(flushedDraft).toMatchObject({
      pageID: payload.pageID,
      revision: 2,
      baseRevision: 2,
      markdown: "开始第一段保存中追加",
      hasChanges: true,
    });

    await acknowledge(page, {
      version: 1,
      requestID: flushedDraft.requestID,
      pageID: payload.pageID,
      revision: 3,
      status: "saved",
    });
    const settledDraft = await flush(page, payload.pageID, 3);
    expect(settledDraft.markdown).toBe("开始第一段保存中追加");
    expect(settledDraft.hasChanges).toBe(false);
  });

  test("shows failed and conflict feedback with working retry and reload actions", async ({ page }) => {
    const payload = pagePayload("保存状态");
    await receivePage(page, payload);
    const editor = await blockEditor(page);

    await editor.click();
    await page.keyboard.press("End");
    await page.keyboard.insertText("失败");
    const failedChange = await waitForHostMessage(page, "change");
    await acknowledge(page, {
      version: 1,
      requestID: failedChange.requestID,
      pageID: payload.pageID,
      revision: payload.revision,
      status: "failed",
      message: "磁盘暂时不可写",
    });

    const error = page.getByTestId("save-error");
    await expect(error).toContainText("磁盘暂时不可写");
    await error.getByRole("button", { name: "重试" }).click();
    const retryChange = await waitForHostMessage(page, "change", 2);
    expect(retryChange.requestID).not.toBe(failedChange.requestID);

    await acknowledge(page, {
      version: 1,
      requestID: retryChange.requestID,
      pageID: payload.pageID,
      revision: 2,
      status: "conflict",
      message: "文件已在其他位置更新",
    });
    await expect(error).toContainText("文件已在其他位置更新");
    await error.getByRole("button", { name: "重新载入" }).click();

    const reloadRequest = await waitForHostMessage(page, "reloadRequest");
    expect(reloadRequest).toMatchObject({
      pageID: payload.pageID,
      revision: payload.revision,
    });
  });

  test("reloads the same page for a newer generation and rejects an older generation", async ({
    page,
  }) => {
    const first = pagePayload("第一版", { generation: 1, revision: 1 });
    await receivePage(page, first);
    await expect(await blockEditor(page)).toContainText("第一版");

    const second = pagePayload("第二版", { generation: 2, revision: 2 });
    await receivePage(page, second);
    await expect(await blockEditor(page)).toContainText("第二版");
    await expect(page.getByText("第一版", { exact: true })).toBeHidden();

    const stale = pagePayload("过期版本", { generation: 1, revision: 3 });
    await page.evaluate(async (nextPage) => {
      await (window as unknown as NativeEditorTestWindow).gooseEditor.receivePage(nextPage);
    }, stale);
    await expect(await blockEditor(page)).toContainText("第二版");
    await expect(page.getByText("过期版本", { exact: true })).toBeHidden();

    const draft = await flush(page, second.pageID, second.revision);
    expect(draft).toMatchObject({
      revision: 2,
      markdown: "第二版",
      hasChanges: false,
    });
  });

  test("isolates overlapping receivePage calls even when their host generation is equal", async ({
    page,
  }) => {
    const first = pagePayload("不应显示的同代页面", {
      generation: 7,
      pageID: "file:///tmp/overlap-first.md",
    });
    const second = pagePayload("最终同代页面", {
      generation: 7,
      pageID: "file:///tmp/overlap-second.md",
    });

    await page.evaluate(async ([firstPage, secondPage]) => {
      const bridge = (window as unknown as NativeEditorTestWindow).gooseEditor;
      await Promise.allSettled([
        Promise.resolve(bridge.receivePage(firstPage)),
        Promise.resolve(bridge.receivePage(secondPage)),
      ]);
    }, [first, second] as const);

    await expect(await blockEditor(page)).toContainText("最终同代页面");
    await expect(page.getByText("不应显示的同代页面", { exact: true })).toHaveCount(0);
    const draft = await flush(page, second.pageID, second.revision);
    expect(draft).toMatchObject({
      pageID: second.pageID,
      markdown: "最终同代页面",
      hasChanges: false,
    });
  });

  test("rejects an old flush if the page changes while composition is settling", async ({ page }) => {
    const first = pagePayload("输入法中的旧页面", {
      generation: 11,
      pageID: "file:///tmp/composition-first.md",
    });
    const second = pagePayload("切换后的新页面", {
      generation: 12,
      pageID: "file:///tmp/composition-second.md",
    });
    await receivePage(page, first);
    const editor = await blockEditor(page);
    await editor.focus();
    await editor.evaluate((element) => {
      element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    });

    const result = await page.evaluate(async ({ oldEnvelope, nextPage }) => {
      const bridge = (window as unknown as NativeEditorTestWindow).gooseEditor;
      const flushing = bridge.flushAndGetDraft(oldEnvelope).then(
        () => ({ status: "fulfilled" as const, message: "" }),
        (error: unknown) => ({
          status: "rejected" as const,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      const receiving = Promise.resolve(bridge.receivePage(nextPage));
      const [flushResult] = await Promise.all([flushing, receiving]);
      return flushResult;
    }, {
      oldEnvelope: envelope(first.pageID, first.revision),
      nextPage: second,
    });

    expect(result.status).toBe("rejected");
    expect(result.message).toContain("桥接上下文已失效");
    await expect(await blockEditor(page)).toContainText("切换后的新页面");
    expect((await flush(page, second.pageID, second.revision)).markdown).toBe("切换后的新页面");
  });
});
