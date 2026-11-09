# Owner: v038_resource_limits (Sol). Each invocation creates an exclusive isolated snapshot.
import hashlib,json,os,signal,subprocess,sys,time,uuid,runpy
from pathlib import Path
ROOT=Path('/Users/harris/Desktop/ZTools-plugins/plugins/pasteboard-pro')
ART=ROOT/'artifacts/pasteboardpro/clipboard-format-g0/v038-resource-limits'
RUN=ART/('run-'+str(uuid.uuid4()))
RUN.mkdir(mode=0o700)
def exclusive(p,data):
 p.parent.mkdir(parents=True,exist_ok=True)
 with p.open('x') as f:f.write(data)
exclusive(RUN/'OWNER.json',json.dumps({'owner':'v038_resource_limits','model':'Sol'}))
WORK=RUN/'workspace'
manifest={}
for relative in ['packages/core/src','packages/sync-protocol/src','packages/snapshot-store/src','packages/snapshot-store/tests/g3-verification-budget/limits']:
 for p in (ROOT/relative).rglob('*'):
  if p.is_file():
   rel=p.relative_to(ROOT); data=p.read_bytes(); destination=WORK/rel
   destination.parent.mkdir(parents=True,exist_ok=True)
   with destination.open('xb') as f:f.write(data)
   manifest[str(rel)]=hashlib.sha256(data).hexdigest()
for rel in ['package.json','packages/core/package.json','packages/snapshot-store/package.json','packages/sync-protocol/package.json']:
 data=(ROOT/rel).read_text();exclusive(WORK/rel,data)
helpers=runpy.run_path(str(Path(__file__).with_name('dependency-shims.py')))
external_before=helpers['external_caches'](ROOT)
dependency_manifest=helpers['shims'](ROOT,WORK)
exclusive(RUN/'dependency-manifest.json',json.dumps(dependency_manifest,indent=2))
exclusive(RUN/'external-cache-before.json',json.dumps(external_before,indent=2))
exclusive(RUN/'source-manifest.json',json.dumps(manifest,indent=2))
args=['/Users/harris/.nvm/versions/node/v24.15.0/bin/node',str(ROOT/'node_modules/vitest/vitest.mjs'),'run','--config',str(WORK/'packages/snapshot-store/tests/g3-verification-budget/limits/vitest.config.ts'),*sys.argv[1:]]
if sys.argv[1:]==['--typecheck']:
 config={'compilerOptions':{'noEmit':True,'target':'ES2022','module':'ESNext','moduleResolution':'Bundler','strict':True,'skipLibCheck':True,'esModuleInterop':True,'types':['node'],'baseUrl':str(WORK),'paths':{'@pasteboard-pro/sync-protocol/v2-node':['packages/sync-protocol/src/v2-node.ts'],'@pasteboard-pro/core':['packages/core/src/index.ts']}},'files':[str(p) for p in (WORK/'packages/snapshot-store/tests/g3-verification-budget/limits').glob('*.ts')]}
 exclusive(WORK/'resource-types.json',json.dumps(config,indent=2))
 args=['/Users/harris/.nvm/versions/node/v24.15.0/bin/node',str(ROOT/'node_modules/typescript/bin/tsc'),'--project',str(WORK/'resource-types.json')]
env=dict(os.environ)
for key,leaf in [('TMPDIR','tmp'),('XDG_CACHE_HOME','cache'),('NODE_COMPILE_CACHE','node-cache')]:
 d=RUN/leaf;d.mkdir();env[key]=str(d)
start=time.monotonic(); timed_out=False
with (RUN/'stdout.log').open('x') as out,(RUN/'stderr.log').open('x') as err:
 child=subprocess.Popen(args,cwd=WORK,env=env,stdout=out,stderr=err,start_new_session=True)
 try:code=child.wait(timeout=120)
 except subprocess.TimeoutExpired:
  timed_out=True;os.killpg(child.pid,signal.SIGTERM)
  try:code=child.wait(timeout=2)
  except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);code=child.wait()
external_after=helpers['external_caches'](ROOT)
exclusive(RUN/'external-cache-after.json',json.dumps(external_after,indent=2))
changed=[r for r,h in manifest.items() if hashlib.sha256((ROOT/r).read_bytes()).hexdigest()!=h]
exclusive(RUN/'command.json',json.dumps({'owner':'v038_resource_limits','args':args,'cwd':str(WORK),'exitCode':code,'timeout120s':timed_out,'elapsedMs':(time.monotonic()-start)*1000,'sourceChangedDuringRun':changed,'sourceHashScopeOnly':True,'externalCacheMetadataUnchanged':external_before==external_after,'cacheRealPaths':[p['realPath'] for p in dependency_manifest['ownedCacheDirectories']],'childReaped':child.poll() is not None},indent=2))
print(json.dumps({'run':str(RUN),'exitCode':code,'sourceChangedDuringRun':changed,'timeout':timed_out}))
print((RUN/'stdout.log').read_text());print((RUN/'stderr.log').read_text())
sys.exit(code if not timed_out else 124)
