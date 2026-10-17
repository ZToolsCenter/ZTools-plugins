import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "playwright/test";

test('isolated list mount benchmark', async ({ page }) => {
  const baseline = process.env.PB_BENCH_REF;
  test.skip(!baseline, 'Set PB_BENCH_REF to the commit to compare');
  const root = path.resolve('apps/ztools/artifacts/virtual-benchmark');
  await mkdir(root, { recursive: true });
  const component = execFileSync('git', [
    'show', `${baseline}:plugins/pasteboard-pro/apps/ztools/src/components/Timeline.vue`,
  ], { encoding: 'utf8' })
    .replace('"../list-order"', '"../../src/list-order"')
    .replace('"./PasteCard.vue"', '"../../src/components/PasteCard.vue"');
  await writeFile(path.join(root, 'TimelineBefore.vue'), component);
  await writeFile(path.join(root, 'timeline.html'), await readFile('apps/ztools/tests/browser/timeline.html'));
  await writeFile(path.join(root, 'timeline.ts'),
    (await readFile('apps/ztools/tests/browser/timeline.ts', 'utf8'))
      .replace('"../../src/components/Timeline.vue"', '"./TimelineBefore.vue"'));

  const results: unknown[] = [];
  for (const version of ['before', 'after']) {
    for (let run = 0; run < 3; run++) {
      const url = version === 'before' ? '/artifacts/virtual-benchmark/timeline.html' : '/tests/browser/timeline.html';
      await page.goto(url);
      await page.waitForFunction(() => (window as any).timelineTest?.ready);
      results.push(await page.evaluate(({ version, run }) => ({
        version, run,
        mountMs: (window as any).timelineTest.mountMs,
        cards: document.querySelectorAll('.timeline__track [role="option"]').length,
      }), { version, run }));
    }
  }
  console.log('RENDER_BENCHMARK', JSON.stringify(results));
});
