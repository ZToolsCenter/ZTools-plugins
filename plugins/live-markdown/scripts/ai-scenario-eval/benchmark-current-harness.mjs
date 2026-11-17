import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createServer } from 'vite';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const server = await createServer({ root, configFile: false, server: { middlewareMode: true, hmr: false, ws: false } });
const report = { runtime: { node: process.version, platform: process.platform, arch: process.arch }, modelCalls: 0, kind: 'mock-invoke end-to-end CPU time, excludes SSR load and real inference; not a UI responsiveness or controlled device benchmark', cases: [] };
try {
  const { runPlannedAiTask } = await server.ssrLoadModule('/src/core/ai/plannedTaskRunner.ts');
  const { buildAiTaskRequest } = await server.ssrLoadModule('/src/core/ai/aiTaskRequest.ts');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.cache/acceptance/ai-scenarios/v1/case-manifest.json')));
  for (const id of ['G09', 'G11', '1MiB-last-match']) {
    const item = id === '1MiB-last-match' ? { source: 'a'.repeat(1_048_576), instruction: '把最后一处“a”改成“b”' } : manifest.realCases.find(item => item.id === id);
    const snap = { documentId: id, revision: 1, content: item.source, selection: null, cursor: null, readOnly: false };
    const request = buildAiTaskRequest({ source: item.source, selected: false, action: 'custom', userPrompt: item.instruction, config: { provider: 'local', activeRoleId: 'general', customSystemPrompt: '' } });
    const samples = [];
    let last;
    for (let iteration = 0; iteration < 12; iteration++) {
      let calls = 0;
      const started = performance.now();
      last = await runPlannedAiTask(request, snap, { isCurrent: () => true, abortCurrent() {}, async invoke(prompt) {
        calls++;
        if (calls === 1) return JSON.stringify(id === 'G09' ? { version: 1, kind: 'answer', target: 'document', content: { mode: 'generate', task: 'summarize' } }
          : id === 'G11' ? { version: 1, kind: 'edit', operation: 'rewrite', target: 'document', content: { mode: 'generate', task: 'polish' } }
          : { version: 1, kind: 'edit', operation: 'replace_exact', target: 'document', find: 'a', occurrence: 'last', content: { mode: 'literal', text: 'b' } });
        if (id === 'G09') {
          const facts = JSON.parse(prompt.split('\n').find(line => line.startsWith('候选：')).slice(3));
          return JSON.stringify({ ids: facts.filter(({ quote }) => quote.includes('决定')).map(({ id }) => id) });
        }
        return prompt.split('【当前分块】\n')[1].split('\n只改写')[0].replaceAll('以经', '已经');
      } });
      if (iteration > 1) samples.push(performance.now() - started);
    }
    samples.sort((a,b) => a-b);
    report.cases.push({ id, utf16Characters: item.source.length, bytes: Buffer.byteLength(item.source), samples: samples.length, p50Ms: samples[4], p95Ms: samples[9], range: last.proposal?.patch ? { from: last.proposal.patch.from, to: last.proposal.patch.to } : null, summaryStats: last.summaryStats ?? null });
  }
} finally { await server.close(); }
const output = path.join(root, '.cache/acceptance/ai-scenarios/v2-r4/performance-' + Date.now() + '.json');
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ...report, output }, null, 2));
