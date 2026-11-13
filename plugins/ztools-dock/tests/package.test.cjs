const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, join, sep } = require('node:path');
const { execFileSync } = require('node:child_process');
const { unzipSync } = require('fflate');

test('打包包含按需加载的间接资源，排除旧哈希文件及内部构建清单', () => {
  const temp = mkdtempSync(join(tmpdir(), 'ztools-dock-package-'));
  try {
    mkdirSync(join(temp,'dist/assets'),{recursive:true}); mkdirSync(join(temp,'dist/.vite'));
    const write = (name,value) => writeFileSync(join(temp,'dist',name),value);
    write('plugin.json', JSON.stringify({version:'test',main:'index.html',preload:'preload.cjs',logo:'logo.png'}));
    write('index.html','<script src="./assets/main.js"></script>');
    write('preload.cjs',''); write('logo.png','fixture');
    write('assets/main.js','import("./lazy.js")'); write('assets/lazy.js','export default 1'); write('assets/old.js','stale');
    write('.vite/manifest.json',JSON.stringify({'index.html':{file:'assets/main.js',dynamicImports:['lazy.js']},'lazy.js':{file:'assets/lazy.js'}}));
    execFileSync(process.execPath,[resolve(__dirname,'../scripts/package.mjs')],{cwd:temp,stdio:'pipe'});
    const files=unzipSync(readFileSync(join(temp,'release/程序坞-test-windows.zip')));
    assert.ok(files['assets/lazy.js']); assert.ok(files['assets/main.js']);
    assert.equal(files['assets/old.js'],undefined); assert.equal(files['.vite/manifest.json'],undefined);
  } finally {
    if(resolve(temp).startsWith(resolve(tmpdir())+sep) && temp.split(sep).at(-1).startsWith('ztools-dock-package-')) rmSync(temp,{recursive:true,force:true});
  }
});
