import type { EnglishAgreementAnalysis, EnglishAgreementInput } from "./englishAgreementTypes";

export interface EnglishAgreementWorkerRequest {
  type: "analyze";
  id: number;
  input: EnglishAgreementInput;
}

export type EnglishAgreementWorkerResponse =
  | { type: "result"; id: number; analysis: EnglishAgreementAnalysis }
  | { type: "failure"; id: number; error: { name: string; message: string } };

export interface EnglishAgreementWorkerPort {
  onmessage: ((event: MessageEvent<EnglishAgreementWorkerResponse>) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: EnglishAgreementWorkerRequest): void;
  terminate(): void;
}
