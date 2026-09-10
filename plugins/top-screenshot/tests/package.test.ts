import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { packagePlugin } from '../scripts/package-plugin';

describe('packagePlugin', () => {
  it('creates a flat ztools plugin directory with rewritten entry paths', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'top-screenshot-package-'));
    await mkdir(path.join(root, 'dist', 'assets'), { recursive: true });
    await mkdir(path.join(root, 'assets'), { recursive: true });
    await writeFile(
      path.join(root, 'plugin.json'),
      JSON.stringify({
        name: 'top-screenshot',
        title: '截图置顶',
        main: 'dist/index.html',
        preload: 'dist/preload.cjs',
        logo: 'assets/logo.png',
        features: [],
      }),
    );
    await writeFile(path.join(root, 'dist', 'index.html'), '<script src="./assets/app.js"></script>');
    await writeFile(path.join(root, 'dist', 'preload.cjs'), 'globalThis.preloaded = true;');
    await writeFile(path.join(root, 'dist', 'assets', 'app.js'), 'console.log("app");');
    await writeFile(path.join(root, 'assets', 'logo.png'), 'png');

    const outDir = await packagePlugin(root);

    expect(outDir).toBe(path.join(root, 'release', 'top-screenshot'));
    await expect(readFile(path.join(outDir, 'index.html'), 'utf8')).resolves.toBe('<script src="./assets/app.js"></script>');
    await expect(readFile(path.join(outDir, 'preload.cjs'), 'utf8')).resolves.toBe('globalThis.preloaded = true;');
    await expect(readFile(path.join(outDir, 'assets', 'app.js'), 'utf8')).resolves.toBe('console.log("app");');
    await expect(readFile(path.join(outDir, 'logo.png'), 'utf8')).resolves.toBe('png');

    const zpx = await readFile(path.join(root, 'release', 'top-screenshot.zpx'));
    expect(zpx.subarray(0, 4)).toEqual(Buffer.from('PK\x03\x04', 'binary'));
    expect(zpx.toString('utf8')).toContain('assets/app.js');
    expect(zpx.toString('utf8')).toContain('console.log("app");');
    expect(zpx.toString('utf8')).toContain('png');

    const packagedPlugin = JSON.parse(await readFile(path.join(outDir, 'plugin.json'), 'utf8'));
    expect(packagedPlugin).toMatchObject({
      name: 'top-screenshot',
      title: '截图置顶',
      main: 'index.html',
      preload: 'preload.cjs',
      logo: 'logo.png',
    });
  });
});
