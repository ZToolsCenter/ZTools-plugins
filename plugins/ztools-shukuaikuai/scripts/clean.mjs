// Kept as a non-destructive build-path check. Packaging selects current files explicitly.
import {existsSync,lstatSync} from 'node:fs';import {resolve,sep} from 'node:path';
const root=resolve('.'),target=resolve('dist/plugin');if(!target.startsWith(root+sep)||target===root)throw Error('Unsafe build directory');if(existsSync(target)&&lstatSync(target).isSymbolicLink())throw Error('Build directory is a link');
