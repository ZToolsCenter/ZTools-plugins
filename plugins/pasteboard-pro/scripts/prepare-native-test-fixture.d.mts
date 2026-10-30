export type NativeTestFixturePaths = Readonly<{
  root: string;
  artifactRoot: string;
  buildRoot: string;
  binary: string;
  receiptPath: string;
  temporaryRoot: string;
}>;
export type NativeTestFixturePreparation = NativeTestFixturePaths & (
  | Readonly<{ status: "not-applicable" }>
  | Readonly<{
    status: "ready";
    receiptSha256: string;
    binarySha256: string;
    cases: number;
    reused: boolean;
  }>
);
export function nativeTestFixturePaths(root?: string): NativeTestFixturePaths;
export function prepareNativeTestFixture(root?: string): Promise<NativeTestFixturePreparation>;
