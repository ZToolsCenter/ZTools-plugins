import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptsDir, '..');
const appDir = path.join(rootDir, 'app');
const distDir = path.join(rootDir, 'dist');

if (!existsSync(appDir)) {
  throw new Error(`App directory not found: ${appDir}`);
}

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
cpSync(appDir, distDir, { recursive: true });

console.log(`Copied app contents to ${distDir}`);
