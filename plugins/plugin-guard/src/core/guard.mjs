import { lstat, open, readdir, realpath, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
const LIMITS = Object.freeze({ depth: 12, files: 1600, bytes: 24 * 1024 * 1024 });
const DEFAULT_FINDING_LIMIT = 5000;
const DEFAULT_IO = Object.freeze({ lstat, open, readdir, realpath, stat });
const KNOWN_BRIDGE = new Set(['choosePluginDirectory','scan','copyText']);
const FEATURE_CODES = /^[a-z0-9][a-z0-9-]{1,62}$/;
const PEM_PRIVATE_KEY = /-----BEGIN ((?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED) )?PRIVATE KEY)-----[\s\S]*?(?:-----END \1-----|$)/gi;
const SECRET_PATTERNS = Object.freeze([
  /\bgithub_pat_[A-Za-z0-9_]*\b/gi,
  /\bgh[pousr]_[A-Za-z0-9_]*\b/gi,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/gi,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bAWS[_\s-]*SECRET[_\s-]*ACCESS[_\s-]*KEY\s*[:=]\s*['\"]?[A-Za-z0-9/+=._-]{8,}/gi,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\b(?:api[_\s-]?key|access[_\s-]?token|secret|token|password|signature)\s*[:=]\s*['\"]?[^\s,'\";]{6,}/gi
]);
const RISKY = [
  ['dynamic-require', /require\s*\(\s*[^'"\s]/, 'high'], ['eval', /\beval\s*\(|\bFunction\s*\(/, 'high'],
  ['child-process', /require\s*\(\s*['\"]child_process|\bexec(?:Sync|File)?\s*\(/, 'medium'], ['shell', /shell\s*:\s*true|exec\s*\(\s*[`'"]/, 'high'],
  ['whole-module-bridge', /(?:globalThis|window)\.[\w$]+\s*=\s*(?:require\(|(?:fs|child_process)\b)/, 'high'], ['remote-url', /https?:\/\//i, 'low']
];
const BRIDGE_FIELD = /\bbridge\.([A-Za-z_$][\w$]*)\s*=/g;
function issue(level, code, message, file) { return { level, code, message, ...(file ? { file } : {}) }; }
function boundedOption(value, label) { if (value === undefined) return Infinity; if (!Number.isInteger(value) || value < 0 || value > 10000) throw new RangeError(`${label} 必须是 0 到 10,000 之间的整数。`); return value; }
function branchContains(directoryRel, file) {
  if (directoryRel === '') return true;
  return typeof file === 'string' && (file === directoryRel || file.startsWith(`${directoryRel}/`));
}
function createFindingStore(limit) {
  const store = { issues: [], risks: [], totals: { issues: 0, risks: 0 }, retained: 0 };
  const counts = { issues: new Map(), risks: new Map() };
  const sink = (kind) => Object.freeze({ push(value) {
    const file = typeof value?.file === 'string' ? value.file : '';
    counts[kind].set(file, (counts[kind].get(file) || 0) + 1);
    store.totals[kind] += 1;
    if (store.retained < limit) { store[kind].push(value); store.retained += 1; }
    return store.totals[kind];
  } });
  const dropBranch = (directoryRel) => {
    for (const kind of ['issues', 'risks']) {
      let removedTotal = 0;
      for (const [file, count] of counts[kind]) {
        if (!branchContains(directoryRel, file)) continue;
        removedTotal += count;
        counts[kind].delete(file);
      }
      store.totals[kind] -= removedTotal;
      const retainedBefore = store[kind].length;
      store[kind] = store[kind].filter((finding) => !branchContains(directoryRel, finding?.file));
      store.retained -= retainedBefore - store[kind].length;
    }
  };
  return { store, issues: sink('issues'), risks: sink('risks'), dropBranch };
}
function within(root, candidate) { const rel = path.relative(root, candidate); return rel && !rel.startsWith('..'+path.sep) && rel !== '..' && !path.isAbsolute(rel); }
function withinOrEqual(root, candidate) { return path.resolve(root) === path.resolve(candidate) || within(root, candidate); }
function comparablePath(value) { const resolved=path.resolve(value); return process.platform==='win32'?resolved.toLocaleLowerCase('en-US'):resolved; }
function sameCanonicalPath(left, right) { return comparablePath(left)===comparablePath(right); }
function entrySnapshotMatches(left, right) { return Boolean(left&&right&&['dev','ino','mode','size','mtimeMs','ctimeMs'].every((key)=>Object.is(left[key],right[key]))); }
function hasSnapshotValue(value, rejectZero = false) { return value!==undefined&&value!==null&&!(typeof value==='number'&&Number.isNaN(value))&&(!rejectZero||String(value)!=='0'); }
function snapshotFieldsMatch(left, right, keys, requireOne = false) {
  let compared=0;
  for(const key of keys){
    const hasLeft=hasSnapshotValue(left[key]),hasRight=hasSnapshotValue(right[key]);
    if(hasLeft!==hasRight)return false;
    if(!hasLeft)continue;
    compared+=1;
    if(!Object.is(left[key],right[key]))return false;
  }
  return !requireOne||compared>0;
}
function directorySnapshotMatches(left, right) {
  if(!left||!right||!left.isDirectory()||!right.isDirectory())return false;
  const stableId=hasSnapshotValue(left.ino,true)&&hasSnapshotValue(right.ino,true);
  if(stableId&&!snapshotFieldsMatch(left,right,['dev','ino']))return false;
  if(!snapshotFieldsMatch(left,right,['mode','mtimeMs','ctimeMs'],true))return false;
  return stableId||snapshotFieldsMatch(left,right,['dev','birthtimeMs'],true);
}
function resolveIo(overrides) { const io={...DEFAULT_IO,...(overrides||{})}; for(const key of Object.keys(DEFAULT_IO))if(typeof io[key]!=='function')throw new TypeError(`io.${key} 必须是函数。`); return io; }
export function manifestRelative(root, candidate, pathApi = path) { return pathApi.relative(root,candidate).split(pathApi.sep).join('/'); }
export function safeRelative(value) { return typeof value === 'string' && value.length > 0 && !value.includes('\0') && !path.isAbsolute(value) && !/^(?:[A-Za-z]:[\\/]|\\\\)/.test(value) && !value.split(/[\\/]+/).includes('..'); }
export function maskSecrets(text) {
  let output = String(text).replace(PEM_PRIVATE_KEY, '[redacted]');
  for (const pattern of SECRET_PATTERNS) output = output.replace(pattern, '[redacted]');
  return output;
}
async function verifyDirectoryChain(root, directory, io) {
  const relative=path.relative(root,directory);
  if(relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw new Error('目录超出授权根目录。');
  const segments=relative?relative.split(path.sep):[];
  let current=root,last;
  for(const segment of [null,...segments]){
    if(segment!==null)current=path.join(current,segment);
    const info=await io.lstat(current);
    if(info.isSymbolicLink()||!info.isDirectory())throw new Error('目录链包含符号链接或非目录入口。');
    last=info;
  }
  const canonical=await io.realpath(directory);
  if(!withinOrEqual(root,canonical)||!sameCanonicalPath(canonical,directory))throw new Error('目录规范路径超出授权根目录。');
  const after=await io.lstat(directory);
  if(after.isSymbolicLink()||!directorySnapshotMatches(last,after))throw new Error('目录在验证过程中发生变化。');
  return after;
}
async function inspectEntry(root, directory, full, expectedDirectory, io) {
  const parentBefore=await verifyDirectoryChain(root,directory,io);
  if(!directorySnapshotMatches(expectedDirectory,parentBefore))throw new Error('父目录在扫描过程中发生变化。');
  const before=await io.lstat(full);
  const parentAfter=await verifyDirectoryChain(root,directory,io);
  const after=await io.lstat(full);
  if(!directorySnapshotMatches(parentBefore,parentAfter)||!entrySnapshotMatches(before,after))throw new Error('目录入口在扫描过程中发生变化。');
  return after;
}
async function verifyFileCandidate(root, full, io) {
  if(!within(root,full))throw new Error('文件超出授权根目录。');
  const directory=path.dirname(full),parentBefore=await verifyDirectoryChain(root,directory,io),before=await io.lstat(full);
  if(before.isSymbolicLink()||!before.isFile())throw new Error('文件入口不是普通文件。');
  const canonical=await io.realpath(full);
  if(!within(root,canonical)||!sameCanonicalPath(canonical,full))throw new Error('文件规范路径超出授权根目录。');
  const parentAfter=await verifyDirectoryChain(root,directory,io),after=await io.lstat(full);
  if(!directorySnapshotMatches(parentBefore,parentAfter)||!fileSnapshotMatches(before,after))throw new Error('文件在规范路径验证过程中发生变化。');
  return after;
}
function captureDirectorySnapshot(info) {
  const isDirectory = info.isDirectory();
  return Object.freeze({ dev:info.dev,ino:info.ino,birthtimeMs:info.birthtimeMs,ctimeMs:info.ctimeMs,mtimeMs:info.mtimeMs,mode:info.mode,isDirectory:()=>isDirectory });
}
function emptyBranch(issues = []) { return { entries:[],directories:[],files:0,bytes:0,issues,caseKeys:[] }; }
function mergeBranch(target, branch, seenKeys) {
  target.entries.push(...branch.entries); target.directories.push(...branch.directories); target.files+=branch.files; target.bytes+=branch.bytes; target.issues.push(...branch.issues); target.caseKeys.push(...branch.caseKeys);
  for(const key of branch.caseKeys)seenKeys.add(key);
}
async function collectBranch(root, state, directory, depth, io, inheritedCaseKeys) {
  const directoryRel=manifestRelative(root,directory);
  if(depth>state.limits.depth)return emptyBranch([issue('high','depth-limit','目录深度超过上限。',directoryRel)]);
  let directoryBefore;
  try{directoryBefore=await verifyDirectoryChain(root,directory,io)}catch{return emptyBranch([issue('high','directory-race','目录在扫描过程中变得不安全。',directoryRel)])}
  const branch=emptyBranch(),seenKeys=new Set(inheritedCaseKeys);
  try{
    const entries=await io.readdir(directory,{withFileTypes:true});
    for(const entry of entries){
      const full=path.join(directory,entry.name),rel=manifestRelative(root,full),info=await inspectEntry(root,directory,full,directoryBefore,io);
      if(info.isSymbolicLink()){branch.issues.push(issue('high','symlink','不会扫描符号链接。',rel));continue}
      if(info.isDirectory()){
        const child=await collectBranch(root,state,full,depth+1,io,seenKeys);
        mergeBranch(branch,child,seenKeys);
        if(state.files+branch.files>state.limits.files||state.bytes+branch.bytes>state.limits.bytes)throw new RangeError('扫描超过安全上限。');
      }else if(!info.isFile()){
        branch.issues.push(issue('medium','special-file','已忽略特殊文件系统入口。',rel));
      }else{
        const safeInfo=await verifyFileCandidate(root,full,io);
        if(!fileSnapshotMatches(info,safeInfo))throw new Error('候选文件在收集过程中发生变化。');
        const nextFiles=branch.files+1,nextBytes=branch.bytes+safeInfo.size;
        if(state.files+nextFiles>state.limits.files||state.bytes+nextBytes>state.limits.bytes)throw new RangeError('扫描超过安全上限。');
        const key=rel.normalize('NFC').toLocaleLowerCase('en-US');
        seenKeys.add(key);branch.caseKeys.push(key);branch.files=nextFiles;branch.bytes=nextBytes;branch.entries.push({rel,size:safeInfo.size});
      }
    }
    const directoryAfter=await verifyDirectoryChain(root,directory,io);
    if(!directorySnapshotMatches(directoryBefore,directoryAfter))throw new Error('目录在扫描过程中发生变化。');
    branch.directories.push({rel:directoryRel,snapshot:captureDirectorySnapshot(directoryAfter)});
    return branch;
  }catch(error){
    if(error instanceof RangeError)throw error;
    return emptyBranch([issue('high','directory-race','目录在扫描过程中发生变化，已丢弃该目录的全部结果。',directoryRel)]);
  }
}
async function collect(root, state, io) {
  const branch=await collectBranch(root,state,root,0,io,state.caseKeys);
  state.entries.push(...branch.entries);state.directories.push(...branch.directories);state.files=branch.files;state.bytes=branch.bytes;
  for(const key of branch.caseKeys)state.caseKeys.add(key);
  for(const finding of branch.issues)state.issues.push(finding);
}
function branchDirectory(root, relative) { return relative?path.join(root,...relative.split('/')):root; }
function directoryIsAncestorOfFile(directoryRel, fileRel) {
  if(directoryRel==='')return true;
  const parent=path.posix.dirname(fileRel);
  return parent===directoryRel||parent.startsWith(`${directoryRel}/`);
}
function invalidateCollectedBranch(state, findings, directoryRel) {
  if(!state.directories.some((record)=>record.rel===directoryRel))return;
  state.entries=state.entries.filter((entry)=>!branchContains(directoryRel,entry.rel));
  state.directories=state.directories.filter((record)=>!branchContains(directoryRel,record.rel));
  for(const rel of state.collectedSizes.keys())if(branchContains(directoryRel,rel))state.collectedSizes.delete(rel);
  state.files=state.entries.length;
  state.bytes=state.entries.reduce((total,entry)=>total+entry.size,0);
  findings.dropBranch(directoryRel);
  state.issues.push(issue('high','directory-race','目录在扫描后发生变化，已丢弃该目录的全部结果。',directoryRel));
}
async function verifyCollectedDirectories(root, state, io, findings, fileRel) {
  const records=state.directories
    .filter((record)=>fileRel===undefined||directoryIsAncestorOfFile(record.rel,fileRel))
    .slice()
    .sort((left,right)=>left.rel.split('/').filter(Boolean).length-right.rel.split('/').filter(Boolean).length);
  for(const record of records){
    if(!state.directories.includes(record))continue;
    try{
      const current=await verifyDirectoryChain(root,branchDirectory(root,record.rel),io);
      if(!directorySnapshotMatches(record.snapshot,current))throw new Error('目录身份已变化。');
    }catch{invalidateCollectedBranch(state,findings,record.rel)}
  }
}
export function fileSnapshotMatches(left, right) { return Boolean(left&&right&&left.isFile()&&right.isFile()&&['dev','ino','size','mtimeMs','ctimeMs'].every((key)=>Object.is(left[key],right[key]))); }
export async function readHandleBounded(handle, limit) { if(!Number.isSafeInteger(limit)||limit<0||limit>LIMITS.bytes)throw new RangeError('受审计文件超过扫描字节上限。');const buffer=Buffer.allocUnsafe(limit+1);let offset=0;while(offset<buffer.length){const{bytesRead}=await handle.read(buffer,offset,buffer.length-offset,null);if(bytesRead===0)break;offset+=bytesRead;}if(offset>limit)throw new RangeError('受审计文件增长后超过已授权大小。');return buffer.subarray(0,offset); }
async function readAuditedFileBounded(root, full, expectedSize, io, verifyReadBoundary = async()=>{}) {
  const before=await verifyFileCandidate(root,full,io);
  if(before.size!==expectedSize)throw new Error('文件大小与有界扫描结果不一致。');
  const flags=fsConstants.O_RDONLY|(process.platform==='win32'?0:(fsConstants.O_NOFOLLOW||0)),handle=await io.open(full,flags);
  try{
    const held=await handle.stat();
    if(!fileSnapshotMatches(before,held))throw new Error('文件在打开过程中发生变化。');
    const openedPath=await verifyFileCandidate(root,full,io);
    if(!fileSnapshotMatches(held,openedPath))throw new Error('已打开文件不再位于授权根目录。');
    await verifyReadBoundary();
    const bytes=await readHandleBounded(handle,expectedSize),heldAfter=await handle.stat(),after=await verifyFileCandidate(root,full,io);
    if(!fileSnapshotMatches(held,heldAfter)||!fileSnapshotMatches(heldAfter,after))throw new Error('文件在读取过程中发生变化。');
    await verifyReadBoundary();
    return bytes.toString('utf8');
  }finally{await handle.close()}
}
function validateManifest(manifest, entries, issues) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return issues.push(issue('high','manifest','plugin.json 必须是对象。'));
  for (const key of ['name','version','author','logo']) if (typeof manifest[key] !== 'string' || !manifest[key].trim()) issues.push(issue('high','manifest-field',`缺少 ${key} 或其值无效。`));
  if (!manifest.main && !manifest.preload) issues.push(issue('high','entrypoint','清单需要 main 或 preload 入口。'));
  for (const key of ['main','logo','preload']) if (manifest[key] && (!safeRelative(manifest[key]) || !entries.has(manifest[key]))) issues.push(issue('high','entrypoint',`${key} 不安全或缺失：${String(manifest[key])}。`));
  const allowedCategories = new Set(['productivity','development','system','media','text','network','game','other']); if (!Array.isArray(manifest.categories) || manifest.categories.some((item)=>!allowedCategories.has(item))) issues.push(issue('medium','categories','categories 包含未知或无法跨平台使用的键。'));
  if (!Array.isArray(manifest.platform) || !['darwin','win32','linux'].every((p)=>manifest.platform.includes(p))) issues.push(issue('medium','platform','清单应明确覆盖 darwin、win32 和 linux。'));
  if (!Array.isArray(manifest.features)) { issues.push(issue('high','feature-list','features 必须是数组。')); return; }
  const seen = new Set(); for (const feature of manifest.features) { if (!feature || !FEATURE_CODES.test(feature.code || '') || seen.has(feature.code)) issues.push(issue('high','feature-code','Feature code 必须唯一且范围明确。')); seen.add(feature?.code); if (!Array.isArray(feature?.cmds) || feature.cmds.some((x)=>{if(typeof x==='string')return !x.trim();if(!x||!['files','img','over'].includes(x.type)||!x.label)return true;if(x.type==='files')return !Number.isInteger(x.maxLength)||x.maxLength<1||(!Array.isArray(x.extensions)&&typeof x.match!=='string');if(x.type==='over')return !Number.isInteger(x.minLength)||!Number.isInteger(x.maxLength)||x.minLength<0||x.maxLength<x.minLength;return false;})) issues.push(issue('medium','feature-trigger','功能触发器缺失或范围过宽。')); }
}
export async function scanPlugin(input, options = {}) {
  const io=resolveIo(options.io),inputInfo=await io.lstat(input);
  if(inputInfo.isSymbolicLink())throw new TypeError('插件根目录不能是符号链接。');
  const root=await io.realpath(input),rootInfo=await io.stat(root);
  if(!rootInfo.isDirectory())throw new TypeError('请选择插件目录，而不是文件。');
  const findingLimit=options.findingLimit===undefined?DEFAULT_FINDING_LIMIT:boundedOption(options.findingLimit,'findingLimit'),manifestFeatureLimit=boundedOption(options.manifestFeatureLimit,'manifestFeatureLimit'),findings=createFindingStore(findingLimit);
  const state={limits:{...LIMITS,...(options.limits||{})},entries:[],directories:[],collectedSizes:new Map(),files:0,bytes:0,issues:findings.issues,caseKeys:new Set()};
  await collect(root,state,io);
  for(const entry of state.entries)state.collectedSizes.set(entry.rel,entry.size);
  await verifyCollectedDirectories(root,state,io,findings);
  const invalidEntries=new Set();let needsInitialReadBarrier=true;
  const readAuditedFile=async(full)=>{
    const rel=manifestRelative(root,full);
    await verifyCollectedDirectories(root,state,io,findings,rel);
    if(!state.collectedSizes.has(rel))throw new Error('文件不在有界扫描范围内。');
    const verifyReadBoundary=async()=>{
      const scope=needsInitialReadBarrier?undefined:rel;
      needsInitialReadBarrier=false;
      await verifyCollectedDirectories(root,state,io,findings,scope);
      if(!state.collectedSizes.has(rel))throw new Error('文件所属目录在读取前发生变化。');
    };
    try{return await readAuditedFileBounded(root,full,state.collectedSizes.get(rel),io,verifyReadBoundary)}catch(error){invalidEntries.add(rel);throw error}
  };
  let index=new Set(state.entries.map((entry)=>entry.rel)),manifest;
  if(!index.has('plugin.json')){
    state.issues.push(issue('high','manifest','缺少 plugin.json。'));
  }else{
    try{
      const source=await readAuditedFile(path.join(root,'plugin.json'));
      try{manifest=JSON.parse(source)}catch{state.issues.push(issue('high','manifest-json','plugin.json 不是有效的 JSON。'))}
    }catch{state.issues.push(issue('high','manifest-read','无法从授权根目录安全读取 plugin.json。'))}
  }
  const risks=findings.risks;
  for(const entry of state.entries.filter((value)=>/\.(?:cjs|mjs|js|json|html)$/i.test(value.rel))){
    if(!state.collectedSizes.has(entry.rel))continue;
    const full=path.join(root,entry.rel);
    if(!within(root,full)){state.issues.push(issue('high','containment','入口超出插件根目录。',entry.rel));invalidEntries.add(entry.rel);continue}
    let source;
    try{source=await readAuditedFile(full)}catch{if(state.collectedSizes.has(entry.rel))risks.push(issue('high','incomplete-file-read','无法安全、完整地读取文件。',entry.rel));continue}
    for(const [code,re,level] of RISKY){re.lastIndex=0;if(re.test(source))risks.push(issue(level,code,`检测到静态模式：${code}。`,entry.rel))}
    if(/preload/i.test(entry.rel)&&source.split(/\r?\n/).some((line)=>line.length>2000))risks.push(issue('medium','minified-preload','难以阅读或已打包的 preload 代码会扩大审计风险。',entry.rel));
    const req=/require\s*\(\s*['\"](\.[^'\"]+)['\"]\s*\)/g;let required;
    while((required=req.exec(source))){
      const base=path.resolve(path.dirname(full),required[1]),candidates=[base,`${base}.js`,`${base}.cjs`,`${base}.json`,path.join(base,'index.js'),path.join(base,'index.cjs'),path.join(base,'index.json')];
      if(!candidates.some((target)=>within(root,target))){risks.push(issue('high','relative-require-escape','相对 require 超出插件根目录。',entry.rel));continue}
      let found=false;
      for(const target of candidates.filter((candidate)=>within(root,candidate))){try{const targetRel=manifestRelative(root,target);await verifyCollectedDirectories(root,state,io,findings,targetRel);if(!state.collectedSizes.has(targetRel))continue;await verifyFileCandidate(root,target,io);await verifyCollectedDirectories(root,state,io,findings,targetRel);if(!state.collectedSizes.has(targetRel))continue;found=true;break}catch{}}
      if(!found)risks.push(issue('high','missing-relative-require',`无法读取相对 require：${required[1]}。`,entry.rel));
    }
    BRIDGE_FIELD.lastIndex=0;let field;
    while((field=BRIDGE_FIELD.exec(source)))if(!KNOWN_BRIDGE.has(field[1]))risks.push(issue('high','unknown-bridge',`未知桥接字段 ${field[1]} 已按失败关闭处理。`,entry.rel));
    if(maskSecrets(source)!==source)risks.push(issue('high','secret','发现疑似凭据，报告中的值已脱敏。',entry.rel));
  }
  await verifyCollectedDirectories(root,state,io,findings);
  let safeEntries=[];
  for(const entry of [...state.entries]){
    await verifyCollectedDirectories(root,state,io,findings,entry.rel);
    if(!state.collectedSizes.has(entry.rel))continue;
    const full=path.join(root,entry.rel);
    try{const current=await verifyFileCandidate(root,full,io);if(current.size!==entry.size)throw new Error('文件大小发生变化。');await verifyCollectedDirectories(root,state,io,findings,entry.rel);if(state.collectedSizes.has(entry.rel))safeEntries.push(entry)}
    catch{if(!invalidEntries.has(entry.rel))state.issues.push(issue('high','entry-invalidated','入口不再安全，已从扫描结果中移除。',entry.rel));invalidEntries.add(entry.rel)}
  }
  await verifyCollectedDirectories(root,state,io,findings);
  safeEntries=safeEntries.filter((entry)=>state.collectedSizes.has(entry.rel));
  index=new Set(safeEntries.map((entry)=>entry.rel));
  if(manifest&&index.has('plugin.json'))validateManifest(manifest,index,state.issues);
  else if(manifest&&!index.has('plugin.json'))manifest=undefined;
  const collisionKeys=new Set();
  for(const entry of safeEntries){const key=entry.rel.normalize('NFC').toLocaleLowerCase('en-US');if(collisionKeys.has(key))state.issues.push(issue('high','case-collision','大小写或 Unicode 冲突路径无法安全跨平台使用。',entry.rel));collisionKeys.add(key)}
  const featureValues=Array.isArray(manifest?.features)?manifest.features:[];
  const retainedFeatures=manifestFeatureLimit===Infinity?featureValues:featureValues.slice(0,manifestFeatureLimit);
  const clean=(finding)=>({ ...finding, ...(finding.file?{file:maskSecrets(finding.file)}:{}), message:maskSecrets(finding.message) });
  return {
    root,
    manifest:manifest?{name:maskSecrets(manifest.name),version:maskSecrets(manifest.version),features:retainedFeatures.map((feature)=>({code:maskSecrets(feature?.code||'')}))}:null,
    manifestFeatureTotal:featureValues.length,
    files:safeEntries.length,
    bytes:safeEntries.reduce((total,entry)=>total+entry.size,0),
    issues:findings.store.issues.map(clean),
    risks:findings.store.risks.map(clean),
    findingTotals:{issues:findings.store.totals.issues,risks:findings.store.totals.risks,findings:findings.store.totals.issues+findings.store.totals.risks},
    retainedFindings:findings.store.retained,
    findingsTruncated:findings.store.retained<findings.store.totals.issues+findings.store.totals.risks,
    entries:safeEntries.map((entry)=>({ ...entry, rel:maskSecrets(entry.rel) })),
    scannedAt:new Date().toISOString()
  };
}
function markdownText(value) { return maskSecrets(value).replace(/[\r\n\t]+/g,' ').replace(/\\/g,'\\\\').replace(/([`*_[\]<>#])/g,'\\$1'); }
function markdownCode(value) { return maskSecrets(value).replace(/[\r\n\t]+/g,' ').replace(/`/g,'ˋ'); }
function humanText(value) { return String(value??'').replace(/\bFeature code\b/gi,'功能代码').replace(/\[redacted\]/gi,'[已脱敏]'); }
const HUMAN_FINDING_CODES = Object.freeze({
  'dynamic-require': '动态依赖加载',
  eval: '动态代码执行',
  'child-process': '子进程调用',
  shell: '命令解释器执行',
  'whole-module-bridge': '整模块桥接暴露',
  'remote-url': '远程网址',
  'depth-limit': '目录深度超限',
  'directory-race': '目录竞态风险',
  symlink: '符号链接',
  'special-file': '特殊文件',
  'case-collision': '路径大小写或 Unicode 冲突',
  manifest: '插件清单',
  'manifest-field': '清单字段',
  entrypoint: '插件入口',
  categories: '分类配置',
  platform: '平台范围',
  'feature-list': '功能列表',
  'feature-code': '功能代码',
  'feature-trigger': '功能触发器',
  'manifest-json': '清单格式',
  'manifest-read': '清单读取',
  containment: '路径越界',
  'incomplete-file-read': '文件未完整读取',
  'minified-preload': '预加载脚本可读性',
  'relative-require-escape': '相对依赖越界',
  'missing-relative-require': '相对依赖缺失',
  'unknown-bridge': '未知桥接字段',
  secret: '疑似凭据',
  'entry-invalidated': '入口已失效'
});
export function humanFindingCode(value) { return HUMAN_FINDING_CODES[String(value??'')] || '未分类检查项'; }
function humanFindingMessage(value, code) { const text=humanText(value),raw=String(code??''),label=HUMAN_FINDING_CODES[raw]; return label?text.split(raw).join(label):text; }
function humanLevel(value) { return ({high:'高',medium:'中',low:'低'})[value]||humanText(value); }
export function toMarkdown(report) { const issues=Array.isArray(report.issues)?report.issues:[],risks=Array.isArray(report.risks)?report.risks:[],shown=Number.isFinite(Number(report.retainedFindings))?Number(report.retainedFindings):issues.length+risks.length,total=Number.isFinite(Number(report.findingTotals?.findings))?Number(report.findingTotals.findings):shown,truncated=Boolean(report.findingsTruncated)||shown<total,rows=['# 插件安全体检报告','','扫描时间：'+markdownText(report.scannedAt),'文件：'+Number(report.files||0)+'；字节：'+Number(report.bytes||0),'已展示发现：'+shown+' / '+total]; if(truncated) rows.push('','> 证据已截断；汇总数量覆盖完整扫描结果。'); rows.push('','## 发现'); for(const x of [...issues,...risks]) rows.push('- `'+markdownCode(humanLevel(x.level))+'` `'+markdownCode(humanFindingCode(x.code))+'`'+(x.file?' — `'+markdownCode(humanText(x.file))+'`':'')+'：'+markdownText(humanFindingMessage(x.message,x.code))); return rows.join('\n'); }
export { LIMITS, DEFAULT_FINDING_LIMIT, KNOWN_BRIDGE };
