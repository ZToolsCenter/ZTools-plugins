export type AssembledPackageVerification = Readonly<{
  files: string[];
  manifest: Record<string, unknown>;
}>;

export function verifyAssembledPackage(
  root: string,
): Promise<AssembledPackageVerification>;

export function assemblePackage(): Promise<AssembledPackageVerification>;
