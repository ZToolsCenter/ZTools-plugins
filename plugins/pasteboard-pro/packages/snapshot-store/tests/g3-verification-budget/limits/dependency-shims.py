# Owner: v038_resource_limits (Sol). Adapted read-only dependency topology from v037; no old helper execution.
import json,os
from pathlib import Path
CACHE_NAMES={'.vite','.vite-temp','.cache','.tmp','.bin','.pnpm','.modules.yaml','.vue-global-types'}
def metadata(p):
 if not p.exists():return {'path':str(p),'exists':False}
 s=p.stat();result={'path':str(p),'realPath':str(p.resolve()),'exists':True,'inode':s.st_ino,'mtimeNs':s.st_mtime_ns,'size':s.st_size}
 if p.is_dir():result['entries']=[{'name':q.name,'size':q.lstat().st_size,'mtimeNs':q.lstat().st_mtime_ns} for q in sorted(p.iterdir())]
 return result
def external_caches(root):
 return [metadata(root/r/'node_modules'/n) for r in [Path('.'),Path('packages/snapshot-store'),Path('packages/core'),Path('packages/sync-protocol')] for n in ['.vite','.vite-temp','.cache']]
def shims(root,work):
 workspace={json.loads((work/'packages'/p/'package.json').read_text())['name']:work/'packages'/p for p in ['core','snapshot-store','sync-protocol']}
 links=[];caches=[]
 for rel in [Path('node_modules'),*[Path('packages')/p/'node_modules' for p in ['core','snapshot-store','sync-protocol']]]:
  source=root/rel;local=work/rel;local.mkdir()
  for cache in ['.vite','.vite-temp','.cache']:
   p=local/cache;p.mkdir();caches.append(str(p))
  if source.exists():
   for entry in sorted(source.iterdir()):
    if entry.name in CACHE_NAMES or entry.name.startswith('.') or not entry.exists():continue
    packages=list(entry.iterdir()) if entry.name.startswith('@') else [entry]
    for package in packages:
     name=entry.name+'/'+package.name if entry.name.startswith('@') else entry.name
     target=workspace.get(name,package.resolve());dest=local/name;dest.parent.mkdir(parents=True,exist_ok=True)
     os.symlink(target,dest);links.append({'path':str(dest),'target':str(target),'workspaceCopy':name in workspace})
  for name,target in workspace.items():
   dest=local/name
   if not dest.exists():dest.parent.mkdir(parents=True,exist_ok=True);os.symlink(target,dest);links.append({'path':str(dest),'target':str(target),'workspaceCopy':True})
 return {'links':links,'ownedCacheDirectories':[metadata(Path(p)) for p in caches]}
