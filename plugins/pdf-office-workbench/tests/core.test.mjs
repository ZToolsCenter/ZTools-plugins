import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDocumentRenamePlan,
  buildPdfMergePlan,
  buildPdfSplitPlan,
  extractInvoiceFields,
  parsePageRanges,
  summarizePdfBatch
} from '../src/core/index.mjs';

test('buildPdfMergePlan orders files and names output', () => {
  const plan = buildPdfMergePlan([
    { path: 'b.pdf', pages: 2 },
    { path: 'a.pdf', pages: 3 }
  ], { outputName: 'merged.pdf' });

  assert.deepEqual(plan, { outputName: 'merged.pdf', totalPages: 5, files: ['a.pdf', 'b.pdf'] });
});

test('buildPdfSplitPlan creates page range tasks', () => {
  assert.deepEqual(buildPdfSplitPlan('report.pdf', '1-2,4,6-7'), [
    { source: 'report.pdf', range: [1, 2], targetName: 'report-p1-2.pdf' },
    { source: 'report.pdf', range: [4, 4], targetName: 'report-p4.pdf' },
    { source: 'report.pdf', range: [6, 7], targetName: 'report-p6-7.pdf' }
  ]);
});

test('parsePageRanges rejects malformed and reversed ranges', () => {
  assert.deepEqual(parsePageRanges('1-3, 5'), [[1, 3], [5, 5]]);
  assert.throws(() => parsePageRanges('0-2'), /无效页码范围/);
  assert.throws(() => parsePageRanges('4-2'), /无效页码范围/);
  assert.throws(() => parsePageRanges(''), /至少一个页码范围/);
});

test('extractInvoiceFields reads common invoice text fields', () => {
  const fields = extractInvoiceFields('发票号码: 12345678\n开票日期: 2026-06-01\n金额 ¥88.50\n购买方: ZTools');

  assert.deepEqual(fields, {
    invoiceNumber: '12345678',
    date: '2026-06-01',
    amount: '88.50',
    buyer: 'ZTools'
  });
});

test('buildDocumentRenamePlan uses extracted fields with fallback index', () => {
  const plan = buildDocumentRenamePlan([
    { path: '/tmp/a.pdf', fields: { date: '2026-06-01', buyer: 'ZTools', amount: '88.50' } },
    { path: '/tmp/b.pdf', fields: {} }
  ], '{date}-{buyer}-{amount}');

  assert.deepEqual(plan.map(item => item.targetName), ['2026-06-01-ZTools-88.50.pdf', '未命名-2.pdf']);
});

test('summarizePdfBatch totals documents and pages', () => {
  assert.deepEqual(summarizePdfBatch([{ pages: 2, size: 1024 }, { pages: 3, size: 2048 }]), {
    documents: 2,
    pages: 5,
    size: 3072
  });
});
