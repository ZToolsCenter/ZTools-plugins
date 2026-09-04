import { inflateRawSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { link, lstat, mkdir, realpath, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const LIMITS = Object.freeze({ entries: 1200, single: 64 * 1024 * 1024, total: 256 * 1024 * 1024, ratio: 120, depth: 20, name: 240 });
const textDecoder = new TextDecoder('utf-8', { fatal: true });
function fail(message) { throw new Error(message); }
function u16(v, at) { if(at+2>v.byteLength) fail('ZIP 记录被截断。'); return v.getUint16(at,true); }
function u32(v, at) { if(at+4>v.byteLength) fail('ZIP 记录被截断。'); return v.getUint32(at,true); }
function reservedWindows(segment) { return /^(?:con|prn|aux|nul|com(?:[1-9]|[¹²³])|lpt(?:[1-9]|[¹²³]))(?:\..*)?$/i.test(segment) || /[. ]$/.test(segment) || /[\u0000-\u001f<>:"|?*]/.test(segment); }
export function normalizeEntryName(name) {
  if(typeof name!=='string'||!name||name.includes('\0')||new TextEncoder().encode(name).byteLength>LIMITS.name) fail('条目名称无效。');
  if(name.includes('\\')||/^\//.test(name)||/^(?:[A-Za-z]:|\\\\)/.test(name)) fail(`压缩包路径不安全：${name}`);
  const directory=name.endsWith('/'), raw=directory?name.slice(0,-1):name; const parts=raw.normalize('NFC').split('/'); if(parts.some((x)=>!x||x==='.'||x==='..'||reservedWindows(x))) fail(`压缩包路径不安全：${name}`); if(parts.length>LIMITS.depth) fail('压缩包路径超过深度限制。'); return parts.join('/')+(directory?'/':'');
}
export function collisionKey(name) { return normalizeEntryName(name).replace(/\/$/,'').normalize('NFC').toLocaleLowerCase('en-US'); }
function findEocd(bytes) { const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength); for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p-=1) if(u32(view,p)===0x06054b50) return p; fail('未找到 ZIP 结束记录。'); }
function decode(bytes) { try{return textDecoder.decode(bytes)}catch{fail('ZIP 文件名不是有效的 UTF-8。')} }
export function inspectZip(input, options={}) {
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input); const limits={...LIMITS,...(options.limits||{})}; const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength); const eocd=findEocd(bytes); const disk=u16(view,eocd+4),cdDisk=u16(view,eocd+6),entriesDisk=u16(view,eocd+8),entriesCount=u16(view,eocd+10),cdSize=u32(view,eocd+12),cdOffset=u32(view,eocd+16),comment=u16(view,eocd+20); if(disk||cdDisk||entriesDisk!==entriesCount||entriesCount===0xffff||cdSize===0xffffffff||cdOffset===0xffffffff||eocd+22+comment!==bytes.length) fail('拒绝多磁盘、ZIP64 或格式错误的 ZIP 结束记录。'); if(entriesCount>limits.entries||cdOffset+cdSize>eocd) fail('ZIP 中央目录超过安全限制。');
  let at=cdOffset,total=0;const entries=[],seen=new Set(); for(let i=0;i<entriesCount;i+=1){if(at+46>cdOffset+cdSize||u32(view,at)!==0x02014b50)fail('ZIP 中央目录条目无效。');const flags=u16(view,at+8),method=u16(view,at+10),crc=u32(view,at+16),compressed=u32(view,at+20),size=u32(view,at+24),nameLength=u16(view,at+28),extra=u16(view,at+30),entryComment=u16(view,at+32),attrs=u32(view,at+38),offset=u32(view,at+42),end=at+46+nameLength+extra+entryComment;if(end>cdOffset+cdSize||compressed===0xffffffff||size===0xffffffff||offset===0xffffffff)fail('拒绝 ZIP64 或格式错误的中央目录条目。');if(flags&1||flags&8)fail('拒绝加密或使用数据描述符的 ZIP 条目。');if(![0,8].includes(method))fail('不支持此 ZIP 压缩方法。');if((method===0&&size>0&&compressed===0)||size>limits.single||(compressed&&size/compressed>limits.ratio))fail('ZIP 条目超过解压安全限制。');const name=normalizeEntryName(decode(bytes.subarray(at+46,at+46+nameLength)));const key=collisionKey(name);if(seen.has(key))fail(`存在大小写或 Unicode 冲突：${name}`);seen.add(key);const mode=attrs>>>16,type=mode&0o170000,directory=name.endsWith('/');if(type&&type!==0o100000&&type!==0o40000)fail(`压缩包包含不安全的特殊条目：${name}`);if((type===0o40000&&!directory)||(directory&&(size!==0||compressed!==0||method!==0)))fail(`压缩包包含不安全的目录条目：${name}`);total+=size;if(total>limits.total)fail('ZIP 解压后总大小超过安全限制。');entries.push({name,key,flags,method,crc,compressed,size,offset,attrs,directory,centralOffset:cdOffset});at=end;}if(at!==cdOffset+cdSize)fail('ZIP 中央目录大小与条目不匹配。');for(const entry of entries)validateLocalRecord(bytes,entry,cdOffset);
  return {format:'zip',entries,total,limits};
}
function validateLocalRecord(bytes, entry, centralOffset) { const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),at=entry.offset;if(at>=centralOffset||u32(view,at)!==0x04034b50)fail(`条目缺少本地文件头：${entry.name}。`);const flags=u16(view,at+6),method=u16(view,at+8),crc=u32(view,at+14),compressed=u32(view,at+18),size=u32(view,at+22),nameLength=u16(view,at+26),extra=u16(view,at+28),start=at+30+nameLength+extra,end=start+entry.compressed;if(flags!==entry.flags||method!==entry.method||crc!==entry.crc||compressed!==entry.compressed||size!==entry.size||start>centralOffset||end>centralOffset)fail(`条目的本地文件头不匹配：${entry.name}。`);const localName=normalizeEntryName(decode(bytes.subarray(at+30,at+30+nameLength)));if(localName!==entry.name)fail(`条目的本地文件名不匹配：${entry.name}。`);return { start, end }; }
function localData(bytes, entry) { const {start,end}=validateLocalRecord(bytes,entry,entry.centralOffset);const raw=bytes.subarray(start,end);const value=entry.method===0?raw:inflateRawSync(raw,{maxOutputLength:entry.size+1});if(value.length!==entry.size||crc32(value)!==entry.crc)fail(`ZIP 校验和不匹配：${entry.name}。`);return value; }
export function planExtraction(input, options={}) { const archive=inspectZip(input,options);const policy=options.conflict||'rename';if(!['rename','skip','error'].includes(policy))fail('未知的同名冲突策略。');return {...archive,conflict:policy,writeOrder:archive.entries.map((e)=>({from:e.name,to:e.name,action:policy==='rename'?'rename-on-conflict':'write-or-'+policy}))}; }
function nodeIdentity(filePath, info) { return { path: filePath, dev: info.dev, ino: info.ino }; }
function sameNode(identity, info) { return identity.dev === info.dev && identity.ino === info.ino; }
async function recordCreatedDirectory(directory, createdDirectories) {
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) fail('新建目录的身份不安全。');
  createdDirectories.push(nodeIdentity(directory, info));
}
async function rollbackCreatedFiles(createdFiles) {
  for (const item of [...createdFiles].reverse()) {
    try {
      const info = await lstat(item.path);
      if (!info.isSymbolicLink() && info.isFile() && sameNode(item, info)) await rm(item.path, { force: true });
    } catch {}
  }
}
async function rollbackCreatedDirectories(createdDirectories) {
  for (const item of [...createdDirectories].reverse()) {
    try {
      const info = await lstat(item.path);
      if (!info.isSymbolicLink() && info.isDirectory() && sameNode(item, info)) await rmdir(item.path);
    } catch {}
  }
}
async function ensureSafeParents(root, target, assertActive = () => {}, createdDirectories = []) {
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) fail('输出路径超出目标目录。');
  let current = root;
  for (const part of rel.split(path.sep).slice(0, -1)) {
    assertActive();
    current = path.join(current, part);
    try {
      const info = await lstat(current);
      assertActive();
      if (info.isSymbolicLink() || !info.isDirectory()) fail('输出路径的上级目录不安全。');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      assertActive();
      await mkdir(current, { recursive: false, mode: 0o700 });
      await recordCreatedDirectory(current, createdDirectories);
      assertActive();
    }
  }
}
async function assertNoSymlinkAncestors(input) { const full=path.resolve(input), root=path.parse(full).root; let current=root; for(const part of path.relative(root,full).split(path.sep).filter(Boolean)){current=path.join(current,part);const info=await lstat(current);if(info.isSymbolicLink())fail('解压目标根目录不安全。');} }
export async function extractZipSafely(input, destination, options = {}) {
  const assertActive = typeof options.assertActive === 'function' ? options.assertActive : () => {};
  assertActive();
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const plan = planExtraction(bytes, options);
  const selected = path.resolve(destination);
  const selectedInfo = await lstat(selected);
  assertActive();
  if (selectedInfo.isSymbolicLink() || !selectedInfo.isDirectory()) fail('解压目标根目录不安全。');
  const root = await realpath(selected);
  assertActive();
  await assertNoSymlinkAncestors(root);
  assertActive();
  const rootInfo = await lstat(root);
  assertActive();
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) fail('解压目标根目录不安全。');
  const createdFiles = [];
  const createdDirectories = [];
  try {
    for (const entry of plan.entries) {
      assertActive();
      await assertNoSymlinkAncestors(root);
      assertActive();
      const parts = entry.name.split('/').filter(Boolean);
      const target = path.resolve(root, ...parts);
      await ensureSafeParents(root, target, assertActive, createdDirectories);
      assertActive();
      if (entry.directory) {
        try {
          const info = await lstat(target);
          assertActive();
          if (info.isSymbolicLink() || !info.isDirectory()) fail(`目录发生不安全冲突：${entry.name}`);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          assertActive();
          await mkdir(target, { mode: 0o700 });
          await recordCreatedDirectory(target, createdDirectories);
          assertActive();
        }
        continue;
      }

      let final = target;
      try {
        await lstat(final);
        assertActive();
        if (plan.conflict === 'skip') continue;
        if (plan.conflict === 'error') fail(`目标位置存在同名条目：${entry.name}`);
        let n = 1;
        while (true) {
          const candidate = `${target} (${n})`;
          try {
            await lstat(candidate);
            assertActive();
            n += 1;
          } catch (error) {
            if (error.code === 'ENOENT') {
              assertActive();
              final = candidate;
              break;
            }
            throw error;
          }
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        assertActive();
      }

      const temp = `${final}.archive-workbench-${randomBytes(12).toString('hex')}`;
      let tempInfo;
      try {
        await assertNoSymlinkAncestors(root);
        assertActive();
        await ensureSafeParents(root, final, assertActive, createdDirectories);
        assertActive();
        await writeFile(temp, localData(bytes, entry), { mode: 0o600, flag: 'wx' });
        assertActive();
        tempInfo = await lstat(temp);
        assertActive();
        await assertNoSymlinkAncestors(root);
        assertActive();
        await ensureSafeParents(root, final, assertActive, createdDirectories);
        assertActive();
        await link(temp, final);
        createdFiles.push(nodeIdentity(final, tempInfo));
        assertActive();
        await rm(temp, { force: true });
        assertActive();
        await assertNoSymlinkAncestors(root);
        assertActive();
      } catch (error) {
        await rm(temp, { force: true }).catch(() => {});
        throw error;
      }
    }
    assertActive();
    return plan;
  } catch (error) {
    await rollbackCreatedFiles(createdFiles);
    await rollbackCreatedDirectories(createdDirectories);
    throw error;
  }
}
function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i+=1)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0}
function put16(a,n){a.push(n&255,(n>>>8)&255)}function put32(a,n){a.push(n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255)}
export function createStoredZip(entries) { if(!Array.isArray(entries)||entries.length>LIMITS.entries||entries.length>0xffff)fail('ZIP 条目数量过多。');const parts=[],central=[];let offset=0,total=0;const seen=new Set();for(const item of entries){const name=normalizeEntryName(item.name),key=collisionKey(name);if(name.endsWith('/')||seen.has(key))fail(`存在大小写、Unicode 或目录冲突：${name}`);seen.add(key);const data=item.data instanceof Uint8Array?item.data:new TextEncoder().encode(String(item.data??''));if(data.length>LIMITS.single||data.length>0xffffffff||(total+=data.length)>LIMITS.total)fail('条目超过大小限制。');const nb=new TextEncoder().encode(name),crc=crc32(data),local=[];put32(local,0x04034b50);put16(local,20);put16(local,0x800);put16(local,0);put16(local,0);put16(local,0);put32(local,crc);put32(local,data.length);put32(local,data.length);put16(local,nb.length);put16(local,0);const header=Uint8Array.from(local);parts.push(header,nb,data);const c=[];put32(c,0x02014b50);put16(c,20);put16(c,20);put16(c,0x800);put16(c,0);put16(c,0);put16(c,0);put32(c,crc);put32(c,data.length);put32(c,data.length);put16(c,nb.length);put16(c,0);put16(c,0);put16(c,0);put16(c,0);put32(c,0);put32(c,offset);central.push(Uint8Array.from(c),nb);offset+=header.length+nb.length+data.length;if(offset>0xffffffff)fail('不支持输出 ZIP64。');}const cdOffset=offset,cdSize=central.reduce((n,x)=>n+x.length,0);if(cdSize>0xffffffff||cdOffset+cdSize>0xffffffff)fail('不支持输出 ZIP64。');const end=[];put32(end,0x06054b50);put16(end,0);put16(end,0);put16(end,entries.length);put16(end,entries.length);put32(end,cdSize);put32(end,cdOffset);put16(end,0);const all=[...parts,...central,Uint8Array.from(end)];const size=all.reduce((n,item)=>n+item.length,0);if(size>LIMITS.total+LIMITS.entries*512)fail('ZIP 输出超过安全限制。');const out=new Uint8Array(size);let at=0;for(const item of all){out.set(item,at);at+=item.length}return out;}
export { LIMITS };
