import { expect, test } from "playwright/test";
import {
  isMermaidTimeline,
  parseMermaidTimeline,
  tryRenderMermaidTimeline,
  wrapText,
} from "../../src/lib/imageExport/timelineSvg";

const PI_TIMELINE = `timeline
    title 两个「Pi」的发展轨迹
    2021-06 : Pi Network SDK 官方文档仓库创建（pi-apps/pi-platform-docs）
    2021-2025 : Pi SDK 持续演进：window.Pi、支付认证、Pi Browser 生态
    2025-08 : pi-mono 仓库创建（earendil-works/pi，原 badlogic/pi-mono）
    2025 下半年 : pi-mono 爆发式增长，stars 快速攀升至约 9.5 万
    至今 : 两者完全独立，仅「Pi」命名巧合，无任何关联
`;

test("识别 mermaid timeline，忽略 flowchart", () => {
  expect(isMermaidTimeline(PI_TIMELINE)).toBe(true);
  expect(isMermaidTimeline("flowchart TD\nA-->B")).toBe(false);
});

test("解析日期与事件，中文冒号留在事件里", () => {
  const model = parseMermaidTimeline(PI_TIMELINE);
  expect(model?.title).toBe("两个「Pi」的发展轨迹");
  expect(model?.items).toHaveLength(5);
  expect(model?.items[1]?.period).toBe("2021-2025");
  expect(model?.items[1]?.events[0]).toContain("window.Pi");
  expect(model?.items[3]?.period).toBe("2025 下半年");
});

test("长中文会折行", () => {
  const lines = wrapText("两者完全独立，仅「Pi」命名巧合，无任何关联", 120, 13);
  expect(lines.length).toBeGreaterThan(1);
});

test("浅色时间线是竖轴卡片，不是彩虹盒和黑线", () => {
  const svg = tryRenderMermaidTimeline(PI_TIMELINE, "light");
  expect(svg).toBeTruthy();
  expect(svg).toContain("两个「Pi」的发展轨迹");
  expect(svg).toContain("pi-mono 爆发式增长");
  expect(svg).toContain("<circle");
  expect(svg).toContain("<rect");
  expect(svg).not.toContain('stroke="black"');
  expect(svg).not.toContain("#ffffde");
  expect(svg).not.toContain("#ececff");
  expect(svg).toContain("#4f46e5");
  expect(svg).toContain("#f7f6f2");
  expect(svg).not.toContain('font-family=""');
});

test("深色时间线使用浅色正文", () => {
  const svg = tryRenderMermaidTimeline(PI_TIMELINE, "dark");
  expect(svg).toContain("#faf9f5");
  expect(svg).not.toContain('stroke="black"');
});
