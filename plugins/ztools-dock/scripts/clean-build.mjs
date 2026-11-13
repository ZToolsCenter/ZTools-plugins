import { rmSync, lstatSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const target = resolve(root, 'dist');
if (dirname(target) !== root || target === root) throw new Error('Refusing to clean outside the build directory');
if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new Error('Build directory must not be a link');
rmSync(target, { recursive: true, force: true });
