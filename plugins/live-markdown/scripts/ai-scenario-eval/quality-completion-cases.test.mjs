import assert from 'node:assert/strict';
import test from 'node:test';
import {refinementCases} from './quality-refinement-cases.mjs';
import {completionCases,completionVariants,completionMatrixSummary} from './quality-completion-cases.mjs';

test('completion suite preserves every original request, scope, source and acceptance expectation',()=>{
 assert.deepEqual(completionCases.slice(0,44),refinementCases);
 assert.equal(completionCases.length,50);
 assert.equal(new Set(completionCases.map(c=>c.id)).size,50);
 assert.equal(completionMatrixSummary.caseCount*2,100);
});
test('the already-correct boundary requires exact original wording and remains a no-op',()=>{
 const c=completionVariants.find(c=>c.id==='B35-HOLD-CORRECT');
 assert.equal(c.instruction,'润色正文，已经正确的句子必须保持原样，不作同义词替换。');
 assert.equal(c.source,'The release has 3 stages, and each stage needs approval.');
 assert.equal(c.expected.effect,'no_op');
});
test('boundary variants preserve source date and source URL rather than authorizing changes',()=>{
 const zh=completionVariants.find(c=>c.id==='B35-HOLD-ZH');
 assert.match(zh.instruction,/不改变日期和负责人/u);
 assert.equal(zh.source,'由林安负责的排期日期是2026-11-03，请请大家进行确认。');
 const link=completionVariants.find(c=>c.id==='B35-HOLD-LINK');
 assert.equal(link.source,'These [checklists](https://internal.invalid/checks) requires approval.');
});
test('new topic proposals require actions, checks, risk responses and no invented completion or supplied parameters',()=>{
 for(const c of completionVariants.filter(c=>c.id.startsWith('B36-HO-'))){
  assert.equal(c.expected.semanticReview,true);
  assert.equal(c.expected.effect,'insert');
  assert.equal(c.expected.patch.from,c.source.length);
  assert.equal(c.expected.patch.to,c.source.length);
  assert.match(c.instruction,/检查|可观察/u);
  assert.match(c.instruction,/不要|不得/u);
  assert.equal(c.expected.artifact.type,'headings');
 }
});

test("fixtures never include model outputs, observed scores or captured request lanes",()=>{
 for(const c of completionVariants){
  assert.equal(Object.hasOwn(c,"lanes"),false);
  assert.equal(Object.hasOwn(c,"assessment"),false);
  assert.equal(Object.hasOwn(c,"raw"),false);
 }
});
