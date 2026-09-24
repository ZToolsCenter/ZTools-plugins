import { expect, test } from "playwright/test";
import {
  getMermaidInitConfig,
  getMermaidThemeVariables,
  stripMermaidInitDirectives,
} from "../../src/lib/imageExport/mermaidTheme";

test("浅色主题用 neo 外形，不用默认黄底紫盒", () => {
  const config = getMermaidInitConfig({ mode: "light" });
  const variables = getMermaidThemeVariables("light");
  expect(config.theme).toBe("neo");
  expect(config.look).toBe("neo");
  expect(variables.clusterBkg.toLowerCase()).not.toBe("#ffffde");
  expect(variables.primaryColor.toLowerCase()).not.toBe("#ececff");
  expect(variables.clusterBkg).toBe("#f7f6f2");
  expect(variables.primaryColor).toBe("#ffffff");
});

test("深色主题用 neo-dark，并保持产品中性色", () => {
  const config = getMermaidInitConfig({ mode: "dark" });
  const variables = getMermaidThemeVariables("dark");
  expect(config.theme).toBe("neo-dark");
  expect(config.look).toBe("neo");
  expect(variables.primaryTextColor).toBe("#faf9f5");
  expect(variables.clusterBkg).toBe("#262625");
});

test("stripMermaidInitDirectives 去掉模型自带的 init 主题", () => {
  const source = `%%{init: {'theme':'default'}}%%\nflowchart TD\nA-->B`;
  expect(stripMermaidInitDirectives(source)).toBe("flowchart TD\nA-->B");
});

test("时间轴去掉彩虹色块和黑色轴线", () => {
  const config = getMermaidInitConfig({ mode: "light" });
  expect(config.timeline.disableMulticolor).toBe(true);
  expect(config.themeCSS).toContain(".eventWrapper rect");
  expect(config.themeCSS).toContain(".lineWrapper line");
  expect(config.themeCSS).toContain("#c4c2ba");
  expect(config.themeCSS).not.toContain("black");
});
