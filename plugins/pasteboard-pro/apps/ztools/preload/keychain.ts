import { execFile as nodeExecFile } from "node:child_process";

export const PASTEBOARD_KEYCHAIN_SERVICE = "com.pasteboardpro.ztools.sync";

const SECURITY_PATH = "/usr/bin/security";
const MAX_SECRET_BYTES = 16 * 1_024;
const EXEC_OPTIONS = {
  encoding: "utf8",
  maxBuffer: 65_536,
  shell: false,
  timeout: 10_000,
  windowsHide: true,
} as const;

type KeychainExecError = Error & {
  code?: string | number;
  stderr?: string;
};

export type KeychainExecFile = (
  file: string,
  args: readonly string[],
  options: typeof EXEC_OPTIONS,
  callback: (error: KeychainExecError | null, stdout: string, stderr: string) => void,
) => unknown;

export interface KeychainSecretStore {
  save(account: string, secret: string): Promise<void>;
  load(account: string): Promise<string | undefined>;
  delete(account: string): Promise<void>;
}

export type KeychainSecretStoreOptions = Readonly<{
  execFile?: KeychainExecFile;
  service?: string;
  logger?: Readonly<{ error(message: string, details?: unknown): void }>;
}>;

function defaultExecFile(...args: Parameters<KeychainExecFile>): unknown {
  return nodeExecFile(
    args[0],
    [...args[1]],
    args[2],
    args[3] as (error: Error | null, stdout: string, stderr: string) => void,
  );
}

function validateAccount(account: string): string {
  const normalized = account.trim();
  if (normalized.length === 0 || normalized.length > 128 || normalized.includes("\0")) {
    throw new TypeError("Keychain account must be a non-empty safe identifier");
  }
  return normalized;
}

function validateSecret(secret: string): void {
  const bytes = Buffer.byteLength(secret, "utf8");
  if (bytes === 0 || bytes > MAX_SECRET_BYTES || secret.includes("\0")) {
    throw new RangeError("Keychain secret must contain 1 to 16384 UTF-8 bytes");
  }
}

function missingItem(error: KeychainExecError, stderr: string): boolean {
  return (
    error.code === 44 ||
    /could not be found|specified item.*not.*found/i.test(
      `${error.stderr ?? ""}\n${stderr}`,
    )
  );
}

export function createKeychainSecretStore(
  options: KeychainSecretStoreOptions = {},
): KeychainSecretStore {
  const execFile = options.execFile ?? defaultExecFile;
  const service = options.service ?? PASTEBOARD_KEYCHAIN_SERVICE;
  if (service.trim().length === 0 || service.includes("\0")) {
    throw new TypeError("Keychain service must be a non-empty safe identifier");
  }

  const run = async (
    operation: string,
    account: string,
    args: readonly string[],
    allowMissing: boolean,
  ): Promise<string | undefined> =>
    await new Promise((resolve, reject) => {
      execFile(SECURITY_PATH, args, EXEC_OPTIONS, (error, stdout, stderr) => {
        if (error === null) {
          resolve(stdout.replace(/\r?\n$/u, ""));
          return;
        }
        if (allowMissing && missingItem(error, stderr)) {
          resolve(undefined);
          return;
        }
        options.logger?.error("PasteboardPro Keychain operation failed", {
          operation,
          account,
          code: error.code,
        });
        reject(new Error(`Keychain ${operation} failed`, { cause: error }));
      });
    });

  return {
    async save(accountValue, secret) {
      const account = validateAccount(accountValue);
      validateSecret(secret);
      await run(
        "save",
        account,
        [
          "add-generic-password",
          "-U",
          "-s",
          service,
          "-a",
          account,
          "-w",
          secret,
        ],
        false,
      );
    },
    async load(accountValue) {
      const account = validateAccount(accountValue);
      return await run(
        "load",
        account,
        ["find-generic-password", "-s", service, "-a", account, "-w"],
        true,
      );
    },
    async delete(accountValue) {
      const account = validateAccount(accountValue);
      await run(
        "delete",
        account,
        ["delete-generic-password", "-s", service, "-a", account],
        true,
      );
    },
  };
}
