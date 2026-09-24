import { expect, test } from "playwright/test";
import {
  CARD_THEMES,
  getCardTheme,
  normalizeCardThemeId,
} from "../../src/lib/imageExport/themes";
import { buildStyledHTML } from "../../src/lib/imageExport/serializer/builder";
import {
  renderBlock,
  renderBlocks,
  renderInline,
} from "../../src/lib/imageExport/serializer/renderer";
import {
  BLOCKNOTE_TEXT_COLORS_DARK,
} from "../../src/lib/imageExport/serializer/utils";

test("checkListItem 使用行高包裹盒 + em 尺寸 checkbox", () => {
  const theme = getCardTheme("brutalist");
  const html = renderBlock(
    {
      type: "checkListItem",
      props: { checked: true },
      content: [{ type: "text", text: "完成任务", styles: {} }],
    },
    theme,
  );
  expect(html).toContain("task-checkbox-wrap");
  expect(html).toContain("task-item checked");
  expect(html).toContain("task-text");
  expect(html).toContain("task-checkbox checked");
});

test("heading level 正确输出 h1/h2/h3", () => {
  const theme = getCardTheme("brutalist");
  for (const level of [1, 2, 3] as const) {
    const html = renderBlock(
      {
        type: "heading",
        props: { level },
        content: [{ type: "text", text: `标题${level}`, styles: {} }],
      },
      theme,
    );
    expect(html).toContain(`<h${level}>`);
    expect(html).toContain(`标题${level}`);
  }
});

test("小 titleFontSize 主题的正文 h3 不低于 body 比例保底", () => {
  const theme = getCardTheme("kenya-hara");
  const html = buildStyledHTML({
    title: "测试",
    blocksHtml: "<h3>小节</h3><p>正文</p>",
    theme,
  });
  const m = html.match(/\.gooseshot-content h3 \{[\s\S]*?font-size: (\d+)px/);
  expect(m).toBeTruthy();
  const h3Size = Number(m![1]);
  expect(h3Size).toBeGreaterThanOrEqual(Math.round(theme.bodyFontSize * 1.22));
});

test("全部主题都包含 checklist 居中与标题 CSS", () => {
  for (const theme of CARD_THEMES) {
    const html = buildStyledHTML({
      title: "本周任务",
      blocksHtml:
        '<div class="task-item"><div class="task-checkbox-wrap"><div class="task-checkbox"></div></div><span class="task-text">x</span></div>',
      theme,
    });
    expect(html).toContain(".task-checkbox-wrap");
    expect(html).toContain(`height: ${theme.bodyLineHeight}em`);
    expect(html).toContain("width: 1em");
    expect(html).toContain("border: 1.5px solid currentColor");
    expect(html).toContain(`color: ${theme.textColor}`);
    expect(html).toContain(`.task-item.checked .task-text`);
    expect(html).toContain(`color: ${theme.secondaryText}`);
    expect(html).toContain("list-style-type: disc");
    expect(html).toContain("list-style-type: decimal");
    expect(html).toContain("border: 1px solid currentColor");
    expect(html).toMatch(/\.gooseshot-content h3 \{/);
    expect(html).toContain(".empty-block");
  }
});

test("浏览器中全部主题都显示列表标记、事项框和提醒块边界", async ({ page }) => {
  for (const theme of CARD_THEMES) {
    const blocksHtml = renderBlocks(
      [
        {
          type: "bulletListItem",
          content: [{ type: "text", text: "无序项目", styles: {} }],
        },
        {
          type: "bulletListItem",
          props: { textColor: "#ffffff", backgroundColor: "#000000" },
          content: [{ type: "text", text: "深底浅字项目", styles: {} }],
        },
        {
          type: "numberedListItem",
          props: { start: 3 },
          content: [{ type: "text", text: "有序项目", styles: {} }],
        },
        {
          type: "checkListItem",
          props: { checked: false },
          content: [{ type: "text", text: "待办事项", styles: {} }],
        },
        {
          type: "checkListItem",
          props: { checked: true },
          content: [{ type: "text", text: "完成事项", styles: {} }],
        },
        {
          type: "checkListItem",
          props: {
            checked: false,
            textColor: "#ffffff",
            backgroundColor: "#000000",
          },
          content: [{ type: "text", text: "深底浅字事项", styles: {} }],
        },
        {
          type: "callout",
          props: { icon: "Bell" },
          content: [{ type: "text", text: "提醒内容", styles: {} }],
        },
      ],
      theme,
    );
    const html = buildStyledHTML({ title: theme.name, blocksHtml, theme });
    await page.setContent(
      html.replace("<style>", "<style>ol, ul, menu { list-style: none; }\n"),
    );

    const styles = await page.evaluate(() => {
      const ul = document.querySelector("ul.bn-list");
      const ol = document.querySelector("ol.bn-list");
      const bullet = ul?.querySelector("li");
      const number = ol?.querySelector("li");
      const checkbox = document.querySelector(".task-checkbox:not(.checked)");
      const checkedCheckbox = document.querySelector(".task-checkbox.checked");
      const customBullet = ul.querySelector("li[style]");
      const customTask = document.querySelector(".task-item[style]");
      const customCheckbox = customTask?.querySelector(".task-checkbox");
      const checkedText = document.querySelector(
        ".task-item.checked .task-text",
      );
      const uncheckedText = document.querySelector(
        ".task-item:not(.checked) .task-text",
      );
      const callout = document.querySelector(".callout");
      if (
        !ul ||
        !ol ||
        !bullet ||
        !number ||
        !checkbox ||
        !checkedCheckbox ||
        !customBullet ||
        !customTask ||
        !customCheckbox ||
        !checkedText ||
        !uncheckedText ||
        !callout
      ) {
        throw new Error("导出块未完整渲染");
      }
      const relativeLuminance = (color: string) => {
        const channels = color
          .match(/[\d.]+/g)
          ?.slice(0, 3)
          .map(Number);
        if (!channels || channels.length !== 3) return 0;
        const [r, g, b] = channels.map((channel) => {
          const value = channel / 255;
          return value <= 0.04045
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const checkedBackground =
        getComputedStyle(checkedCheckbox).backgroundColor;
      const checkedMark = getComputedStyle(checkedCheckbox, "::after").color;
      const checkedLuminance = relativeLuminance(checkedBackground);
      const markLuminance = relativeLuminance(checkedMark);
      const checkedContrast =
        (Math.max(checkedLuminance, markLuminance) + 0.05) /
        (Math.min(checkedLuminance, markLuminance) + 0.05);
      return {
        bulletListStyle: getComputedStyle(ul).listStyleType,
        orderedListStyle: getComputedStyle(ol).listStyleType,
        bulletDisplay: getComputedStyle(bullet).display,
        numberDisplay: getComputedStyle(number).display,
        bulletMarkerColor: getComputedStyle(bullet, "::marker").color,
        numberMarkerColor: getComputedStyle(number, "::marker").color,
        orderedStart: ol.getAttribute("start"),
        listIndent:
          bullet.getBoundingClientRect().left - ul.getBoundingClientRect().left,
        checkboxBorderStyle: getComputedStyle(checkbox).borderStyle,
        checkboxBorderColor: getComputedStyle(checkbox).borderColor,
        checkedContrast,
        customBulletColor: getComputedStyle(customBullet).color,
        customBulletMarkerColor: getComputedStyle(customBullet, "::marker")
          .color,
        customTaskColor: getComputedStyle(customTask).color,
        customCheckboxBorderColor: getComputedStyle(customCheckbox).borderColor,
        checkedDecoration: getComputedStyle(checkedText).textDecorationLine,
        checkedTextColor: getComputedStyle(checkedText).color,
        uncheckedTextColor: getComputedStyle(uncheckedText).color,
        calloutBorderStyle: getComputedStyle(callout).borderStyle,
        calloutBorderColor: getComputedStyle(callout).borderColor,
        calloutColor: getComputedStyle(callout).color,
      };
    });

    expect(styles, theme.id).toMatchObject({
      bulletListStyle: "disc",
      orderedListStyle: "decimal",
      bulletDisplay: "list-item",
      numberDisplay: "list-item",
      orderedStart: "3",
      checkboxBorderStyle: "solid",
      checkedDecoration: "none",
      calloutBorderStyle: "solid",
    });
    expect(styles.listIndent, theme.id).toBeGreaterThan(10);
    expect(styles.bulletMarkerColor, theme.id).not.toBe("rgba(0, 0, 0, 0)");
    expect(styles.numberMarkerColor, theme.id).not.toBe("rgba(0, 0, 0, 0)");
    expect(styles.checkboxBorderColor, theme.id).not.toBe("rgba(0, 0, 0, 0)");
    expect(styles.checkedTextColor, theme.id).not.toBe(styles.uncheckedTextColor);
    expect(styles.checkedContrast, theme.id).toBeGreaterThanOrEqual(4.5);
    expect(styles.customBulletMarkerColor, theme.id).toBe(
      styles.customBulletColor,
    );
    expect(styles.customCheckboxBorderColor, theme.id).toBe(
      styles.customTaskColor,
    );
    expect(styles.calloutBorderColor, theme.id).toBe(styles.calloutColor);
  }
});

test("Vercel 极黑浅色 accent 勾选对号用深色", () => {
  const theme = getCardTheme("vercel-dark");
  const html = buildStyledHTML({
    title: "Dark",
    blocksHtml: "<p>hi</p>",
    theme,
  });
  expect(html).toContain("color: #0a0a0a");
});

test("深色主题粉色文字映射到深色导出色盘", () => {
  const theme = getCardTheme("github-dark");
  const html = renderBlock(
    {
      type: "paragraph",
      content: [{ type: "text", text: "备注", styles: { textColor: "pink" } }],
    },
    theme,
  );
  expect(html).toContain(BLOCKNOTE_TEXT_COLORS_DARK.pink);
});

test("空段落输出 empty-block 占位", () => {
  const theme = getCardTheme("github-light");
  const html = renderBlock({ type: "paragraph", content: [] }, theme);
  expect(html).toContain('class="empty-block"');
  expect(html).toContain("data-empty");
  expect(html).toContain("<br>");
});

test("段内 hardBreak 与文本换行转 br", () => {
  const theme = getCardTheme("github-light");
  expect(renderInline([{ type: "hardBreak" }], theme)).toBe("<br>");
  expect(
    renderInline([{ type: "text", text: "a\nb", styles: {} }], theme),
  ).toContain("<br>");
});

test("导出时移除编辑器对象替换字符，避免出现 OBJ 标识", () => {
  const theme = getCardTheme("github-light");
  const inlineHtml = renderInline(
    [{ type: "text", text: "AI Agent\uFFFC：", styles: {} }],
    theme,
  );
  const cardHtml = buildStyledHTML({
    title: "规划\uFFFCRC",
    blocksHtml: `<p>${inlineHtml}</p>`,
    theme,
  });

  expect(inlineHtml).toBe("AI Agent：");
  expect(cardHtml).toContain("规划RC");
  expect(cardHtml).not.toContain("\uFFFC");
});

test("链接 type=link 递归 content 不丢文字", () => {
  const theme = getCardTheme("github-light");
  const html = renderInline(
    [
      { type: "text", text: "见", styles: {} },
      {
        type: "link",
        href: "https://example.com",
        content: [{ type: "text", text: "文档", styles: { bold: true } }],
      },
    ],
    theme,
  );
  expect(html).toContain('href="https://example.com"');
  expect(html).toContain("<strong>文档</strong>");
  expect(html).not.toMatch(/<a href="[^"]*"><\/a>/);
});

test("连续 bullet/numbered 合并为 ul/ol.bn-list", () => {
  const theme = getCardTheme("github-light");
  const html = renderBlocks(
    [
      {
        type: "bulletListItem",
        content: [{ type: "text", text: "一", styles: {} }],
      },
      {
        type: "bulletListItem",
        content: [{ type: "text", text: "二", styles: {} }],
      },
      {
        type: "numberedListItem",
        content: [{ type: "text", text: "甲", styles: {} }],
      },
      {
        type: "numberedListItem",
        content: [{ type: "text", text: "乙", styles: {} }],
      },
    ],
    theme,
  );
  expect(html).toContain('<ul class="bn-list">');
  expect(html).toContain('<ol class="bn-list">');
  expect(html).toContain("<li");
  expect(html).toContain("一");
  expect(html).toContain("乙");
  // 不应出现「两个独立裸 li 无容器」——至少有成对的 ul/ol
  expect((html.match(/<ul class="bn-list">/g) || []).length).toBe(1);
  expect((html.match(/<ol class="bn-list">/g) || []).length).toBe(1);
});

test("有序列表保留起始编号，嵌套列表保持语义容器", () => {
  const theme = getCardTheme("github-light");
  const html = renderBlocks(
    [
      {
        type: "numberedListItem",
        props: { start: 3 },
        content: [{ type: "text", text: "第三项", styles: {} }],
        children: [
          {
            type: "bulletListItem",
            content: [{ type: "text", text: "子项", styles: {} }],
          },
        ],
      },
      {
        type: "numberedListItem",
        props: { start: 8 },
        content: [{ type: "text", text: "第四项", styles: {} }],
      },
    ],
    theme,
  );
  expect(html).toContain('<ol class="bn-list" start="3">');
  expect(html).toContain('<li value="8">第四项</li>');
  expect(html).toContain('<ul class="bn-list"><li>子项</li></ul>');
  expect(html).toContain("第三项");
  expect(html).toContain("第四项");
});

test("表格 headerRows=0 时首行仍为 td；默认首行 th", () => {
  const theme = getCardTheme("github-light");
  const makeTable = (headerRows: number | undefined) =>
    renderBlock(
      {
        type: "table",
        content: {
          type: "tableContent",
          ...(headerRows !== undefined ? { headerRows } : {}),
          rows: [
            {
              cells: [
                [{ type: "text", text: "A", styles: { bold: true } }],
                [{ type: "text", text: "B", styles: {} }],
              ],
            },
            {
              cells: [
                [{ type: "text", text: "1", styles: {} }],
                [
                  {
                    type: "link",
                    href: "https://x.test",
                    content: [{ type: "text", text: "链", styles: {} }],
                  },
                ],
              ],
            },
          ],
        },
      },
      theme,
    );

  const withHeader = makeTable(undefined);
  expect(withHeader).toContain("<th>");
  expect(withHeader).toContain("<strong>A</strong>");
  expect(withHeader).toContain('href="https://x.test"');
  expect(withHeader).toContain("链");

  const noHeader = makeTable(0);
  expect(noHeader).not.toContain("<th>");
  expect(noHeader).toContain("<td>");
});

test("图片 caption 输出 figure；非图片 file 输出 file-card", () => {
  const theme = getCardTheme("github-light");
  const fig = renderBlock(
    {
      type: "image",
      props: { url: "https://example.com/a.png", caption: "说明图" },
    },
    theme,
  );
  expect(fig).toContain('class="export-figure"');
  expect(fig).toContain("<figcaption>说明图</figcaption>");

  const file = renderBlock(
    {
      type: "file",
      props: { url: "https://example.com/doc.pdf", name: "报告.pdf" },
    },
    theme,
  );
  expect(file).toContain('class="file-card"');
  expect(file).toContain("报告.pdf");
  expect(file).not.toContain("<img");
});

test("codeBlock 输出 code-block 壳与语言标签", () => {
  const theme = getCardTheme("github-light");
  const html = renderBlock(
    {
      type: "codeBlock",
      props: { language: "typescript", wrap: true },
      content: [
        { type: "text", text: "const x = 1", styles: {} },
        { type: "hardBreak" },
        { type: "text", text: "const y = 2", styles: {} },
      ],
    },
    theme,
  );
  expect(html).toContain('class="code-block"');
  expect(html).toContain("code-lang");
  expect(html).toContain("typescript");
  expect(html).toContain("code-wrap");
  expect(html).toContain("const x = 1");
  expect(html).toContain("const y = 2");
});

test("生成内容不插入额外的选中标识", () => {
  const theme = getCardTheme("github-light");
  const html = buildStyledHTML({
    title: "t",
    blocksHtml: "<p>x</p>",
    theme,
  });
  expect(html).not.toContain("gooseshot-selection-tag");
  expect(html).not.toContain("选中内容");
});

test("块级 backgroundColor / textColor 输出 style", () => {
  const theme = getCardTheme("github-light");
  const html = renderBlock(
    {
      type: "paragraph",
      props: {
        backgroundColor: "yellow",
        textColor: "blue",
        textAlignment: "center",
      },
      content: [{ type: "text", text: "色块", styles: {} }],
    },
    theme,
  );
  expect(html).toContain("text-align:center");
  expect(html).toContain("background-color:");
  expect(html).toContain("color:");
});

test("主题字体与水印微调生效", () => {
  expect(getCardTheme("medium").titleFont).toContain("Noto Serif SC");
  expect(getCardTheme("medium").codeFont).toContain("JetBrains Mono");
  expect(getCardTheme("typewriter").bodyFont).toContain("Noto Serif SC");
  expect(getCardTheme("vercel-dark").watermark).toBe("#8b8b93");
  expect(getCardTheme("tokyo-night").watermark).toBe("#7a83b0");
  expect(getCardTheme("poster").watermark).toContain("0.45");
  expect(getCardTheme("synthwave").watermark).toContain("255,120,220");
  expect(getCardTheme("github-dark").secondaryText).toBe("#8b949e");
});

test("已删除主题会迁移到保留的代表主题", () => {
  expect(CARD_THEMES).toHaveLength(15);
  expect(normalizeCardThemeId("notion")).toBe("github-light");
  expect(normalizeCardThemeId("obsidian")).toBe("github-dark");
  expect(normalizeCardThemeId("academic")).toBe("medium");
  expect(normalizeCardThemeId("linear")).toBe("github-light");
  expect(normalizeCardThemeId("solarized-light")).toBe("typewriter");
});
