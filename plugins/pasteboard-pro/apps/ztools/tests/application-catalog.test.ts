import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  APPLICATION_CATALOG_SCRIPT,
  ApplicationCatalogExecFile,
  ApplicationCatalogFileSystem,
  ApplicationCatalogService,
  ApplicationCatalogServiceOptions,
  SelectableApplication,
} from "../preload/application-catalog";

type EntryKind = "directory" | "symlink" | "file";

function entry(name: string, kind: EntryKind) {
  return {
    name,
    isDirectory: () => kind === "directory",
    isSymbolicLink: () => kind === "symlink",
  };
}

function missingError(): Error & { code: string } {
  return Object.assign(new Error("missing"), { code: "ENOENT" });
}

function makeFakeFileSystem(home = "/Users/test") {
  const directories = new Set<string>(["/Applications", "/System/Applications", join(home, "Applications")]);
  const entries = new Map<string, ReturnType<typeof entry>[]>();
  const aliases = new Map<string, string>();

  const fileSystem: ApplicationCatalogFileSystem = {
    readdir: vi.fn(async (path) => {
      const result = entries.get(path);
      if (!result) throw missingError();
      return result;
    }),
    realpath: vi.fn(async (path) => {
      const resolved = aliases.get(path) ?? path;
      if (!directories.has(resolved)) throw missingError();
      return resolved;
    }),
    stat: vi.fn(async (path) => {
      if (!directories.has(path)) throw missingError();
      return { isDirectory: () => true };
    }),
  };

  function setEntries(path: string, values: ReturnType<typeof entry>[]) {
    directories.add(path);
    entries.set(path, values);
  }

  function addApplication(parent: string, name: string, kind: "directory" | "symlink" = "directory") {
    const applicationPath = join(parent, name);
    if (kind === "directory") {
      directories.add(applicationPath);
    } else {
      const target = join("/Targets", name);
      directories.add(target);
      aliases.set(applicationPath, target);
    }
    return applicationPath;
  }

  return { fileSystem, setEntries, addApplication, home };
}

function metadataRunner(
  metadataByPath: ReadonlyMap<string, Record<string, unknown>>,
  onCall?: (paths: readonly string[], options: Parameters<ApplicationCatalogExecFile>[2]) => void,
): ApplicationCatalogExecFile {
  return (_file, args, options, callback) => {
    const paths = args.slice(4);
    onCall?.(paths, options);
    const records = paths.flatMap((path, index) => {
      const metadata = metadataByPath.get(path);
      return metadata ? [{ index, ...metadata }] : [];
    });
    callback(null, JSON.stringify(records));
  };
}

function appMetadata(bundleId: string, name: string) {
  return { bundleId, displayName: name };
}

describe("application catalog service", () => {
  it("scans only app bundles and one folder level, then normalizes, deduplicates, and sorts metadata", async () => {
    const fake = makeFakeFileSystem();
    const root = "/Applications";
    const nested = join(root, "Utilities");
    const aliasDirectory = join(root, "Aliases");
    const zetaPath = fake.addApplication(root, "Zeta.app");
    const duplicatePath = fake.addApplication(root, "Alias.app");
    const fallbackPath = fake.addApplication(nested, "Beta.app");
    const invalidPath = fake.addApplication(root, "Invalid.app");
    const noIdPath = fake.addApplication(root, "NoId.app");
    const deepPath = fake.addApplication(join(nested, "Deep"), "TooDeep.app");
    fake.setEntries("/Applications", [
      entry("Zeta.app", "directory"),
      entry("Alias.app", "directory"),
      entry("Utilities", "directory"),
      entry("Invalid.app", "directory"),
      entry("NoId.app", "directory"),
    ]);
    fake.setEntries(nested, [entry("Beta.app", "directory"), entry("Deep", "directory")]);
    fake.setEntries(join(nested, "Deep"), [entry("TooDeep.app", "directory")]);
    fake.setEntries(aliasDirectory, []);
    void deepPath;

    const metadata = new Map<string, Record<string, unknown>>([
      [zetaPath, appMetadata("com.example.zeta", "Zeta")],
      [duplicatePath, appMetadata("com.example.zeta", "Duplicate should lose")],
      [fallbackPath, { bundleId: "com.example.beta" }],
      [invalidPath, appMetadata("../invalid", "Invalid")],
      [noIdPath, { displayName: "No bundle id" }],
    ]);
    const service = new ApplicationCatalogService({
      platform: "darwin",
      homeDirectory: fake.home,
      fileSystem: fake.fileSystem,
      execFile: metadataRunner(metadata),
    });

    const result = await service.listApplications();
    expect(result).toEqual({
      supported: true,
      applications: [
        { bundleId: "com.example.beta", name: "Beta" },
        { bundleId: "com.example.zeta", name: "Duplicate should lose" },
      ],
    });
    expect(service.getCachedApplicationPath("COM.EXAMPLE.ZETA")).toBe(duplicatePath);
    expect(service.getCachedApplicationPath(undefined)).toBeUndefined();
  });

  it("supports .app symlinks without following symlink folders or entering app bundles", async () => {
    const fake = makeFakeFileSystem();
    const linkPath = join("/Applications", "Linked.app");
    fake.addApplication("/Applications", "Linked.app", "symlink");
    fake.setEntries("/Applications", [entry("Linked.app", "symlink"), entry("External", "symlink")]);
    const seenPaths: string[] = [];
    const service = new ApplicationCatalogService({
      platform: "darwin",
      homeDirectory: fake.home,
      fileSystem: fake.fileSystem,
      execFile: metadataRunner(new Map([[linkPath, appMetadata("com.example.linked", "Linked")]]), (paths) => {
        seenPaths.push(...paths);
      }),
    });

    await expect(service.listApplications()).resolves.toEqual({
      supported: true,
      applications: [{ bundleId: "com.example.linked", name: "Linked" }],
    });
    expect(seenPaths).toEqual([linkPath]);
    expect(fake.fileSystem.readdir).not.toHaveBeenCalledWith(linkPath);
  });

  it("passes discovered paths through fixed, bounded argv and caches concurrent scans for five minutes", async () => {
    const fake = makeFakeFileSystem();
    const applicationPath = fake.addApplication("/Applications", "Preview.app");
    fake.setEntries("/Applications", [entry("Preview.app", "directory")]);
    const calls: Array<{ paths: readonly string[]; options: Parameters<ApplicationCatalogExecFile>[2] }> = [];
    let finishFirst: ((value: string) => void) | undefined;
    let markRunnerStarted: (() => void) | undefined;
    const runnerStarted = new Promise<void>((resolve) => { markRunnerStarted = resolve; });
    const firstOutput = new Promise<string>((resolve) => { finishFirst = resolve; });
    let now = 10_000;
    let callCount = 0;
    const runner: ApplicationCatalogExecFile = (_file, args, options, callback) => {
      const paths = args.slice(4);
      calls.push({ paths, options });
      callCount += 1;
      if (callCount === 1) {
        markRunnerStarted?.();
        void firstOutput.then((output) => callback(null, output));
      } else {
        callback(null, JSON.stringify(paths.map((_path, index) => ({ index, ...appMetadata("com.apple.Preview", "Preview") }))));
      }
    };
    const service = new ApplicationCatalogService({
      platform: "darwin",
      homeDirectory: fake.home,
      fileSystem: fake.fileSystem,
      execFile: runner,
      now: () => now,
    });

    const first = service.listApplications();
    const second = service.listApplications();
    await runnerStarted;
    expect(callCount).toBe(1);
    finishFirst?.(JSON.stringify([{ index: 0, ...appMetadata("com.apple.Preview", "Preview") }]));
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual(secondResult);
    expect(service.getCachedApplicationPath("com.apple.Preview")).toBe(applicationPath);
    expect(calls[0]?.paths).toEqual([applicationPath]);
    expect(calls[0]?.options).toMatchObject({ shell: false, timeout: 15_000, maxBuffer: 2 * 1_024 * 1_024 });
    expect(APPLICATION_CATALOG_SCRIPT).toContain("ObjC.import('Foundation')");

    now += 5 * 60 * 1_000 + 1;
    await service.listApplications();
    await service.listApplications(true);
    expect(callCount).toBe(3);
  });

  it("returns 600 apps across UTF-8-sized argv batches without truncation", async () => {
    const fake = makeFakeFileSystem();
    const nested = join("/Applications", "é".repeat(100));
    const appCount = 600;
    const pathsByAppName = new Map<string, number>();
    const children = Array.from({ length: appCount }, (_item, index) => {
      const name = `Application-${String(index).padStart(3, "0")}-${"ö".repeat(90)}.app`;
      const path = fake.addApplication(nested, name);
      pathsByAppName.set(path, index);
      return entry(name, "directory");
    });
    fake.setEntries("/Applications", [entry("é".repeat(100), "directory")]);
    fake.setEntries(nested, children);

    const batchArgvBytes: number[] = [];
    const runner: ApplicationCatalogExecFile = (file, args, _options, callback) => {
      const paths = args.slice(4);
      batchArgvBytes.push([file, ...args].reduce(
        (total, argument) => total + Buffer.byteLength(argument, "utf8") + 1,
        0,
      ));
      const records = paths.map((path, index) => {
        const appIndex = pathsByAppName.get(path);
        return {
          index,
          bundleId: `com.example.application${String(appIndex).padStart(3, "0")}`,
          displayName: `Application ${String(appIndex).padStart(3, "0")}`,
        };
      });
      callback(null, JSON.stringify(records));
    };
    const service = new ApplicationCatalogService({
      platform: "darwin",
      homeDirectory: fake.home,
      fileSystem: fake.fileSystem,
      execFile: runner,
    });

    const result = await service.listApplications();
    expect(result.applications).toHaveLength(appCount);
    expect(result.applications[0]?.name).toBe("Application 000");
    expect(result.applications.at(-1)?.name).toBe("Application 599");
    expect(service.getCachedApplicationPath("com.example.application599")).toBe(
      [...pathsByAppName.keys()].find((path) => pathsByAppName.get(path) === 599),
    );
    expect(batchArgvBytes.length).toBeGreaterThan(1);
    expect(batchArgvBytes.every((bytes) => bytes <= 64 * 1_024)).toBe(true);
  });

  it("fails explicitly on candidate overflow and allows a later retry", async () => {
    const fake = makeFakeFileSystem();
    const rootEntries = Array.from({ length: 4_097 }, (_item, index) => {
      fake.addApplication("/Applications", `Application-${String(index).padStart(4, "0")}.app`);
      return entry(`Application-${String(index).padStart(4, "0")}.app`, "directory");
    });
    fake.setEntries("/Applications", rootEntries);
    let runnerCalls = 0;
    const runner: ApplicationCatalogExecFile = (_file, _args, _options, callback) => {
      runnerCalls += 1;
      callback(null, "[]");
    };
    const service = new ApplicationCatalogService({
      platform: "darwin",
      homeDirectory: fake.home,
      fileSystem: fake.fileSystem,
      execFile: runner,
    });

    await expect(service.listApplications()).rejects.toThrow("exceeds the supported application limit");
    expect(runnerCalls).toBe(0);
    fake.setEntries("/Applications", rootEntries.slice(0, 2));
    await expect(service.listApplications()).resolves.toEqual({ supported: true, applications: [] });
    expect(runnerCalls).toBe(1);
  });

  it("skips malformed metadata and does not scan or invent application IDs off macOS", async () => {
    const fake = makeFakeFileSystem();
    const appPath = fake.addApplication("/Applications", "Valid.app");
    fake.setEntries("/Applications", [entry("Valid.app", "directory")]);
    const service = new ApplicationCatalogService({
      platform: "darwin",
      homeDirectory: fake.home,
      fileSystem: fake.fileSystem,
      execFile: (_file, _args, _options, callback) => callback(null, JSON.stringify([
        { index: 0, bundleId: "com.example.valid", localizedDisplayName: "Localized Valid", displayName: "Ignored" },
        { index: 3, bundleId: "com.example.unlisted", displayName: "Missing app path" },
        { index: 0, bundleId: "../../bad", displayName: "Bad id" },
      ])),
    });
    await expect(service.listApplications()).resolves.toEqual({
      supported: true,
      applications: [{ bundleId: "com.example.valid", name: "Localized Valid" }],
    });
    expect(service.getCachedApplicationPath("com.example.valid")).toBe(appPath);

    const unsupportedRunner = vi.fn();
    const unsupported = new ApplicationCatalogService({
      platform: "linux",
      execFile: unsupportedRunner,
    });
    await expect(unsupported.listApplications()).resolves.toEqual({ supported: false, applications: [] });
    expect(await unsupported.listApplications(true)).toEqual({ supported: false, applications: [] });
    expect(unsupported.getCachedApplicationPath("com.example.valid")).toBeUndefined();
    expect(unsupportedRunner).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform !== "darwin" || process.env.PASTEBOARD_PRO_APPLICATION_CATALOG_SMOKE !== "1")(
    "runs a real macOS catalog smoke check without printing app names or paths",
    async () => {
    const result = await new ApplicationCatalogService().listApplications();
    const validCount = result.applications.filter((application: SelectableApplication) =>
      application.bundleId.length > 0 && application.name.length > 0).length;
    console.info(`application catalog smoke: total=${result.applications.length}; valid=${validCount}`);
    expect(result.supported).toBe(true);
    expect(validCount).toBe(result.applications.length);
    },
  );
});
