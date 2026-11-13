import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync,lstatSync,existsSync} from 'node:fs';
import {resolve,join,sep,dirname} from 'node:path';
import {tmpdir,homedir} from 'node:os';

// Prepare a reviewable market branch with the pinned official CLI's copy/branch helpers.
// Authentication and the eventual ordinary push/PR remain with the user's logged-in gh CLI.
const project=process.cwd();
const run=(bin,args,cwd=project)=>execFileSync(bin,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
if(run('git',['status','--porcelain']))throw new Error('请先提交源码，市场快照只读取已提交文件');
const manifest=JSON.parse(readFileSync('public/plugin.json','utf8'));
if(manifest.name!=='ztools-dock')throw new Error('此适配器仅用于 ztools-dock');
if(JSON.parse(readFileSync('node_modules/@ztools-center/plugin-cli/package.json','utf8')).version!=='1.3.2')throw new Error('请复核新的 CLI 实现后更新适配器');
const cache=resolve(process.env.ZTOOLS_MARKET_CACHE||join(homedir(),'.cache','ztools-dock-market','ZTools-plugins'));
process.env.ZTOOLS_CONFIG_DIR=dirname(cache);
if(run('git',['remote','get-url','origin'],cache)!=='https://github.com/jiang66-so/ZTools-plugins.git')throw new Error('市场缓存 origin 不符合预期');
if(run('git',['status','--porcelain'],cache))throw new Error('市场缓存有未提交改动，停止准备');
if(run('git',['ls-remote','--heads','origin',`refs/heads/plugin/${manifest.name}`],cache))throw new Error('远端已有发布分支，请先核对审核者贡献及已有 PR，不自动覆盖');
run('git',['fetch','--depth=1','--filter=blob:none','upstream','main'],cache);
const {validateStrictChangelogSection}=await import('@ztools-center/plugin-cli/dist/changelog.js');
const validation=validateStrictChangelogSection(manifest.version,project);if(!validation.valid)throw new Error(validation.error);
const {preparePublishBranch,copyPluginFiles,getForkRepoPath}=await import('@ztools-center/plugin-cli/dist/git.js');
if(resolve(getForkRepoPath())!==cache)throw new Error('CLI 缓存路径不一致');
const dest=resolve(cache,'plugins',manifest.name);
if(!dest.startsWith(resolve(cache,'plugins')+sep))throw new Error('插件目录越界');
const temp=mkdtempSync(join(tmpdir(),'ztools-dock-market-source-')),snapshot=join(temp,'source');
try {
 mkdirSync(snapshot);run('git',['archive','--format=tar','--output',join(temp,'source.tar'),'HEAD']);run('tar',['-xf',join(temp,'source.tar'),'-C',snapshot]);
 const docs=resolve(snapshot,'docs');if(docs.startsWith(snapshot+sep)&&existsSync(docs)&&lstatSync(docs).isDirectory())rmSync(docs,{recursive:true});
 writeFileSync(join(snapshot,'README.md'),readFileSync(join(snapshot,'MARKET.md')));
 preparePublishBranch(manifest.name,false,cache);copyPluginFiles(manifest.name,snapshot);
 run('git',['add','--sparse',`plugins/${manifest.name}`],cache);
 const files=run('git',['diff','--cached','--name-only'],cache).split('\n');
 if(files.some(f=>!f.startsWith(`plugins/${manifest.name}/`)||/(?:^|\/)(?:artifacts|release|node_modules|\.env|\.git)(?:\/|$)/.test(f)))throw new Error('市场差异包含非预期文件');
 console.log(JSON.stringify({sourceCommit:run('git',['rev-parse','HEAD']),base:run('git',['rev-parse','upstream/main'],cache),cache,pluginPath:dest,files:files.length},null,2));
}finally {
 if(resolve(temp).startsWith(resolve(tmpdir())+sep)&&temp.split(sep).at(-1).startsWith('ztools-dock-market-source-'))rmSync(temp,{recursive:true,force:true});
}
