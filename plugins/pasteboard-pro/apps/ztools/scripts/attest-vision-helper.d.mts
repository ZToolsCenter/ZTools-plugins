export type CodesignDetails = {
  identifier: string | null;
  signature: string | null;
  authorities: string[];
  teamIdentifier: string | null;
  hardenedRuntime: boolean;
};

export function parseCodesignDetails(output: string): CodesignDetails;

export function attestVisionHelper(
  helperPath: string,
  options?: {
    signature?: "adhoc" | "developer-id";
    outputPath?: string;
    requireGatekeeper?: boolean;
  },
): Promise<Record<string, unknown>>;
