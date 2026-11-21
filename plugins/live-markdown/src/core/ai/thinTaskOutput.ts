import type { ContentTaskFamily } from "./modelCapabilityAdvice";

export interface EvidenceCoverage {
  totalChunks: number;
  processedChunks: number;
  requiredFacts: number;
  selectedFacts: number;
  missingFields: string[];
}

export interface ThinTaskOutput {
  text: string;
  warnings: string[];
  sourceFacts?: string[];
  coverage?: EvidenceCoverage;
  executor?: ContentTaskFamily;
}
