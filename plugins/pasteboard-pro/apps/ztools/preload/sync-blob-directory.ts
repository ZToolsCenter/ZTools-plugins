import { lstat, realpath } from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import path from "node:path";

export type ManagedBlobDirectoryIdentity = Readonly<{
  path: string;
  device: bigint;
  inode: bigint;
}>;

export type ManagedBlobDirectoryChain = Readonly<{
  paths: readonly string[];
  identities: readonly ManagedBlobDirectoryIdentity[];
  complete: boolean;
}>;

export function isInsideManagedBlobRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative.length > 0 &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

function directoryPaths(directory: string): string[] {
  const absolute = path.resolve(directory);
  const root = path.parse(absolute).root;
  const paths = [root];
  let current = root;
  for (const segment of path.relative(root, absolute).split(path.sep)) {
    if (segment.length === 0) continue;
    current = path.join(current, segment);
    paths.push(current);
  }
  return paths;
}

function assertManagedDirectory(
  directoryPath: string,
  status: BigIntStats,
): ManagedBlobDirectoryIdentity {
  if (status.isSymbolicLink()) {
    throw new TypeError(
      `Refusing to access a managed blob through a symbolic link: ${directoryPath}`,
    );
  }
  if (!status.isDirectory()) {
    throw new TypeError(`Managed blob parent path must be a directory: ${directoryPath}`);
  }
  if (status.ino === 0n) {
    throw new TypeError(
      `Managed blob directory has no usable identity: ${directoryPath}`,
    );
  }
  return { path: directoryPath, device: status.dev, inode: status.ino };
}

export async function inspectManagedBlobDirectory(
  directory: string,
  allowMissing: boolean,
): Promise<ManagedBlobDirectoryChain> {
  const paths = directoryPaths(directory);
  const identities: ManagedBlobDirectoryIdentity[] = [];
  for (const directoryPath of paths) {
    let status: BigIntStats;
    try {
      status = await lstat(directoryPath, { bigint: true });
    } catch (error) {
      if (
        allowMissing &&
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        break;
      }
      throw error;
    }
    identities.push(assertManagedDirectory(directoryPath, status));
  }
  return {
    paths,
    identities,
    complete: identities.length === paths.length,
  };
}

export function assertManagedBlobDirectoryContinuation(
  before: ManagedBlobDirectoryChain,
  after: ManagedBlobDirectoryChain,
): void {
  if (!after.complete || before.paths.length !== after.paths.length) {
    throw new TypeError("Managed blob directory chain is incomplete or changed");
  }
  for (const original of before.identities) {
    const current = after.identities.find((entry) => entry.path === original.path);
    if (
      current === undefined ||
      current.device !== original.device ||
      current.inode !== original.inode
    ) {
      throw new TypeError("Managed blob directory identity changed during file operation");
    }
  }
}

export function sameManagedBlobDirectoryChain(
  left: ManagedBlobDirectoryChain,
  right: ManagedBlobDirectoryChain,
): boolean {
  return (
    left.complete &&
    right.complete &&
    left.identities.length === right.identities.length &&
    left.identities.every((original, index) => {
      const current = right.identities[index];
      return (
        current !== undefined &&
        current.path === original.path &&
        current.device === original.device &&
        current.inode === original.inode
      );
    })
  );
}

export async function assertCanonicalManagedBlobFile(
  root: string,
  filePath: string,
): Promise<Readonly<{ canonicalRoot: string; canonicalFile: string }>> {
  const [canonicalRoot, canonicalFile] = await Promise.all([
    realpath(root),
    realpath(filePath),
  ]);
  if (!isInsideManagedBlobRoot(canonicalRoot, canonicalFile)) {
    throw new TypeError("Resolved blob file is outside its canonical managed root");
  }
  return { canonicalRoot, canonicalFile };
}
