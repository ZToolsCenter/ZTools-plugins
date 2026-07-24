import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Browser, type Page } from "playwright/test";

type Host = "atools" | "ztools";
type Dock = "floating" | "bottom" | "left" | "right";
type Theme = "light" | "dark";
type Density = "expanded" | "compact";
type Motion = "full" | "reduced";

type VisualRecord = {
  host: Host;
  state: string;
  screenshot: string;
  viewport: { width: number; height: number };
  shelf: { x: number; y: number; width: number; height: number };
  radii: Record<string, string>;
  consoleErrors: string[];
};

type ShelfBox = { x: number; y: number; width: number; height: number };

const artifactRoot = path.resolve("artifacts/pasteboardpro/visual-matrix");
const records: VisualRecord[] = [];
const hosts: Host[] = ["atools", "ztools"];
const docks: Dock[] = ["floating", "bottom", "left", "right"];
const themes: Theme[] = ["light", "dark"];
const densities: Density[] = ["expanded", "compact"];
const motions: Motion[] = ["full", "reduced"];

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await mkdir(artifactRoot, { recursive: true });
});

for (const dock of docks) {
  for (const theme of themes) {
    for (const density of densities) {
      for (const motion of motions) {
        test(`${dock} ${theme} ${density} ${motion}`, async ({ browser }) => {
          const state = `${dock}-${theme}-${density}-${motion}`;
          const pair = await Promise.all(
            hosts.map(async (host) => await captureMatrixState(browser, host, {
              dock,
              theme,
              density,
              motion,
              state,
            })),
          );
          expect(Math.abs(pair[0]!.shelf.width - pair[1]!.shelf.width)).toBeLessThanOrEqual(4);
          expect(Math.abs(pair[0]!.shelf.x - pair[1]!.shelf.x)).toBeLessThanOrEqual(4);
        });
      }
    }
  }
}

for (const host of hosts) {
  test(`${host} search, group, preview, and paste queue states`, async ({ browser }) => {
    const { page, errors } = await visualPage(browser, host, "bottom", "dark", "full");
    const search = page.getByRole("searchbox");

    await search.fill("invoice");
    await expect(page.getByRole("option")).toHaveCount(3);
    await captureNamedState(page, host, "search", errors);

    await search.fill("");
    await page.getByRole("button", { name: "Work", exact: true }).click();
    await expect(page.getByRole("option")).toHaveCount(2);
    await captureNamedState(page, host, "pinboard", errors);

    await page.getByRole("button", { name: "全部", exact: true }).click();
    if (host === "ztools") {
      await captureZtoolsPreview(browser);
    } else {
      const image = page.getByRole("option").filter({ hasText: "Scanned receipt" });
      await image.focus();
      await image.press("Space");
      await expect(page.getByLabel("内容预览")).toBeVisible();
      await captureNamedState(page, host, "preview", errors);
      await page.getByRole("button", { name: "关闭预览" }).click();
    }

    const first = page.getByRole("option").first();
    await first.click();
    await page.getByTitle(/粘贴队列/).click();
    await expect(page.getByRole("status")).toContainText("粘贴队列");
    await captureNamedState(page, host, "paste-stack", errors);

    expect(errors).toEqual([]);
    await page.context().close();
  });
}

test.afterAll(async () => {
  const expectedScreenshots = 72;
  const uniqueScreenshots = new Set(records.map((record) => record.screenshot));
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    pass:
      records.length === expectedScreenshots &&
      uniqueScreenshots.size === expectedScreenshots &&
      records.every((record) => record.consoleErrors.length === 0),
    matrixStates: docks.length * themes.length * densities.length * motions.length,
    screenshots: records.length,
    records,
  };
  await writeFile(
    path.join(artifactRoot, "visual-matrix.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  expect(records).toHaveLength(expectedScreenshots);
  expect(uniqueScreenshots.size).toBe(expectedScreenshots);
});

async function captureMatrixState(
  browser: Browser,
  host: Host,
  options: { dock: Dock; theme: Theme; density: Density; motion: Motion; state: string },
): Promise<VisualRecord> {
  const { page, errors } = await visualPage(browser, host, options.dock, options.theme, options.motion);
  if (options.density === "compact") {
    await page.getByTitle("切换紧凑模式").click();
    await expect(page.getByTitle("切换紧凑模式")).toHaveAttribute("aria-pressed", "true");
  }
  await settle(page);
  const shelf = page.getByLabel("Paste剪切板").filter({ has: page.getByRole("option") }).first();
  const box = await shelf.boundingBox();
  assertBox(box);
  const viewport = viewportFor(options.dock);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  const overflow = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(overflow.width).toBeLessThanOrEqual(overflow.viewport + 1);
  const radii = await shelf.evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      topLeft: styles.borderTopLeftRadius,
      topRight: styles.borderTopRightRadius,
      bottomLeft: styles.borderBottomLeftRadius,
      bottomRight: styles.borderBottomRightRadius,
      transitionDuration: styles.transitionDuration,
    };
  });
  assertDockRadii(options.dock, radii);
  if (options.motion === "reduced") expect(radii.transitionDuration).toBe("0s");
  const screenshot = `${host}/${options.state}.png`;
  await mkdir(path.join(artifactRoot, host), { recursive: true });
  await page.screenshot({ path: path.join(artifactRoot, screenshot), animations: "disabled" });
  const record = { host, state: options.state, screenshot, viewport, shelf: box, radii, consoleErrors: errors };
  records.push(record);
  expect(errors).toEqual([]);
  await page.context().close();
  return record;
}

async function captureNamedState(
  page: Page,
  host: Host,
  state: string,
  errors: string[],
  surfaceLabel = "Paste剪切板",
): Promise<void> {
  await settle(page);
  const shelf = surfaceLabel === "Paste剪切板"
    ? page.getByLabel(surfaceLabel).filter({ has: page.getByRole("option") }).first()
    : page.getByLabel(surfaceLabel).first();
  const box = await shelf.boundingBox();
  assertBox(box);
  const screenshot = `${host}/${state}.png`;
  await page.screenshot({ path: path.join(artifactRoot, screenshot), animations: "disabled" });
  records.push({
    host,
    state,
    screenshot,
    viewport: { width: 1280, height: 420 },
    shelf: box,
    radii: await shelf.evaluate((element) => {
      const styles = getComputedStyle(element);
      return {
        topLeft: styles.borderTopLeftRadius,
        topRight: styles.borderTopRightRadius,
        bottomLeft: styles.borderBottomLeftRadius,
        bottomRight: styles.borderBottomRightRadius,
        transitionDuration: styles.transitionDuration,
      };
    }),
    consoleErrors: [...errors],
  });
}

async function captureZtoolsPreview(browser: Browser): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 420 },
    colorScheme: "dark",
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  const errors = collectConsoleErrors(page);
  await page.goto(
    "http://127.0.0.1:5179/?visual=1&panel=preview&itemId=image-new",
    { waitUntil: "networkidle" },
  );
  await expect(page.getByLabel("内容预览")).toBeVisible();
  await captureNamedState(page, "ztools", "preview", errors, "内容预览");
  expect(errors).toEqual([]);
  await context.close();
}

async function visualPage(
  browser: Browser,
  host: Host,
  dock: Dock,
  theme: Theme,
  motion: Motion,
): Promise<{ page: Page; errors: string[] }> {
  const context = await browser.newContext({
    viewport: viewportFor(dock),
    colorScheme: theme,
    reducedMotion: motion === "reduced" ? "reduce" : "no-preference",
  });
  const page = await context.newPage();
  const errors = collectConsoleErrors(page);
  const port = host === "atools" ? 5180 : 5179;
  const shelfQuery = host === "ztools" ? "&shelf=1" : "";
  await page.goto(`http://127.0.0.1:${port}/?visual=1&dock=${dock}${shelfQuery}`, { waitUntil: "networkidle" });
  await expect(page.getByLabel("Paste剪切板").first()).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(5);
  return { page, errors };
}

function viewportFor(dock: Dock): { width: number; height: number } {
  return dock === "left" || dock === "right"
    ? { width: 760, height: 720 }
    : { width: 1280, height: 420 };
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

function assertBox(value: ShelfBox | null): asserts value is ShelfBox {
  expect(value).not.toBeNull();
  expect(value?.width).toBeGreaterThan(300);
  expect(value?.height).toBeGreaterThan(180);
}

function assertDockRadii(dock: Dock, radii: Record<string, string>): void {
  if (dock === "bottom") {
    expect(radii.bottomLeft).toBe("0px");
    expect(radii.bottomRight).toBe("0px");
  } else if (dock === "left") {
    expect(radii.topLeft).toBe("0px");
    expect(radii.bottomLeft).toBe("0px");
  } else if (dock === "right") {
    expect(radii.topRight).toBe("0px");
    expect(radii.bottomRight).toBe("0px");
  } else {
    expect(radii.topLeft).not.toBe("0px");
    expect(radii.bottomRight).not.toBe("0px");
  }
}
