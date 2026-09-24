import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const distDir = join(rootDir, 'dist');

const staticFiles = [
  'plugin.json',
  'logo.png',
  'index.html',
  'index.css',
  'LICENSE',
];

const runtimePackageFiles = {
  'fuse.js': [
    'package.json',
    'LICENSE',
    'dist/fuse.cjs',
  ],
  'sql.js': [
    'package.json',
    'LICENSE',
    'dist/sql-wasm.js',
    'dist/sql-wasm.wasm',
  ],
};

function copyFile(relativePath) {
  const source = join(rootDir, relativePath);
  const target = join(distDir, relativePath);

  if (!existsSync(source)) {
    throw new Error(`Missing build input: ${relativePath}`);
  }

  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target);
}

function copyRuntimePackage(packageName, files) {
  for (const relativePath of files) {
    copyFile(join('node_modules', packageName, relativePath));
  }
}

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

const tscPath = join(rootDir, 'node_modules', 'typescript', 'bin', 'tsc');
if (!existsSync(tscPath)) {
  throw new Error('TypeScript is not installed. Run npm install before building.');
}

execFileSync(process.execPath, [tscPath, '--project', join(rootDir, 'tsconfig.json'), '--outDir', distDir], {
  cwd: rootDir,
  stdio: 'inherit',
});

for (const file of staticFiles) {
  copyFile(file);
}

for (const [packageName, files] of Object.entries(runtimePackageFiles)) {
  copyRuntimePackage(packageName, files);
}

writeFileSync(
  join(distDir, 'package.json'),
  `${JSON.stringify({ private: true, type: 'commonjs' }, null, 2)}\n`,
  'utf8',
);

console.log(`Built production plugin package in ${distDir}`);
