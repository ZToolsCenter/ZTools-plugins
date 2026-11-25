import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZipArchive } from 'archiver';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(rootDir, 'dist');
const outDir = path.join(rootDir, 'out');
const packageJson = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

const pluginJsonPath = path.join(rootDir, 'public', 'plugin.json');
const pluginJson = JSON.parse(readFileSync(pluginJsonPath, 'utf8'));

if (packageJson.version !== pluginJson.version) {
  console.warn(
    `[zip] Warning: package.json (${packageJson.version}) and public/plugin.json (${pluginJson.version}) versions differ. ` +
      `The zip name uses package.json.`
  );
}

const zipName = `todos-v${packageJson.version}.zip`;
const finalZipPath = path.join(outDir, zipName);
const tempZipPath = path.join(rootDir, `.${zipName}.tmp`);

if (!existsSync(distDir)) {
  console.error('[zip] dist directory not found. Run the build first.');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
rmSync(tempZipPath, { force: true });
rmSync(finalZipPath, { force: true });

const output = createWriteStream(tempZipPath);
const archive = new ZipArchive({ zlib: { level: 9 } });

try {
  await new Promise((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('warning', error => {
      if (error.code === 'ENOENT') {
        console.warn('[zip]', error);
      } else {
        reject(error);
      }
    });
    archive.on('error', reject);

    archive.pipe(output);
    // Zip the contents of dist at the archive root, not a nested dist folder.
    archive.glob('**/*', {
      cwd: distDir,
      dot: true,
      ignore: ['**/*.zip', '**/.DS_Store'],
    });
    archive.finalize();
  });

  renameSync(tempZipPath, finalZipPath);
  const sizeKb = (statSync(finalZipPath).size / 1024).toFixed(1);
  console.log(`[zip] Created ${path.relative(rootDir, finalZipPath)} (${sizeKb} KB)`);
} catch (error) {
  rmSync(tempZipPath, { force: true });
  console.error('[zip] Failed to create archive:', error);
  process.exit(1);
}
