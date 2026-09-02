import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const dist = path.join(root, 'dist');
await rm(dist, { recursive: true, force: true }); await mkdir(dist, { recursive: true });
await cp(path.join(root,'src','ui'), dist, {recursive:true}); await cp(path.join(root,'src','core'), path.join(dist,'core'), {recursive:true}); await cp(path.join(root,'preload'), path.join(dist,'preload'), {recursive:true}); await cp(path.join(root,'logo.svg'),path.join(dist,'logo.svg'));
const app = await readFile(path.join(dist,'app.mjs'),'utf8'); await writeFile(path.join(dist,'app.mjs'),app.replace("'../core/sanitize.mjs'", "'./core/sanitize.mjs'"));
const manifest=JSON.parse(await readFile(path.join(root,'plugin.json'),'utf8')); delete manifest.development; manifest.main='index.html'; manifest.logo='logo.svg'; manifest.preload='preload/index.cjs'; await writeFile(path.join(dist,'plugin.json'),JSON.stringify(manifest,null,2)+'\n');
