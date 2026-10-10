import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type PluginManifest = {
  name: string;
  main: string;
  preload: string;
  logo: string;
  [key: string]: unknown;
};

export async function packagePlugin(rootDir = process.cwd()): Promise<string> {
  const manifest = JSON.parse(await readFile(path.join(rootDir, 'plugin.json'), 'utf8')) as PluginManifest;
  const outDir = path.join(rootDir, 'release', manifest.name);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await mkdir(path.join(outDir, 'assets'), { recursive: true });

  await cp(path.join(rootDir, manifest.main), path.join(outDir, 'index.html'));
  await cp(path.join(rootDir, manifest.preload), path.join(outDir, 'preload.cjs'));
  await cp(path.join(rootDir, manifest.logo), path.join(outDir, 'logo.png'));
  await cp(path.join(rootDir, 'dist', 'assets'), path.join(outDir, 'assets'), { recursive: true });

  await writeFile(
    path.join(outDir, 'plugin.json'),
    `${JSON.stringify(
      {
        ...manifest,
        main: 'index.html',
        preload: 'preload.cjs',
        logo: 'logo.png',
      },
      null,
      2,
    )}\n`,
  );

  await createZpx(outDir, path.join(rootDir, 'release', `${manifest.name}.zpx`));

  return outDir;
}

async function createZpx(sourceDir: string, zpxPath: string): Promise<void> {
  const files = await listFiles(sourceDir);
  const chunks: Buffer[] = [];
  const centralDirectory: Buffer[] = [];
  let offset = 0;

  for (const filePath of files) {
    const relativePath = toZipPath(path.relative(sourceDir, filePath));
    const data = await readFile(filePath);
    const name = Buffer.from(relativePath, 'utf8');
    const crc = crc32(data);
    const localHeader = Buffer.alloc(30 + name.length);

    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    name.copy(localHeader, 30);

    chunks.push(localHeader, data);

    const centralHeader = Buffer.alloc(46 + name.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    name.copy(centralHeader, 46);
    centralDirectory.push(centralHeader);

    offset += localHeader.length + data.length;
  }

  const centralDirectorySize = centralDirectory.reduce((size, chunk) => size + chunk.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectorySize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  await writeFile(zpxPath, Buffer.concat([...chunks, ...centralDirectory, end]));
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(dir, entry.name);
      return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
    }),
  );

  return files.flat().sort((a, b) => toZipPath(path.relative(dir, a)).localeCompare(toZipPath(path.relative(dir, b))));
}

function toZipPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;

  for (const byte of data) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }

  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let crc = index;

  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }

  return crc >>> 0;
});

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  packagePlugin().then((outDir) => {
    console.log(`Packaged ZTools plugin at ${outDir}`);
  });
}
