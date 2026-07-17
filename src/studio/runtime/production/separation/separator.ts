import type { SeparationProducerLineage } from "../model.ts";

export interface SourceSeparationResult {
  lineage: SeparationProducerLineage;
  stems: [
    { role: "source_estimate_1"; path: string; sampleCount: number },
    { role: "source_estimate_2"; path: string; sampleCount: number },
  ];
}

export interface SourceSeparator {
  currentLineage(deadlineAtMs: number): Promise<SeparationProducerLineage>;
  separate(input: { wavPath: string; outputDirectory: string; expectedSampleCount: number }, deadlineAtMs: number): Promise<SourceSeparationResult>;
}

export class SourceSeparatorFailure extends Error {
  readonly reason: "model_unavailable" | "runtime_drift" | "separator_timeout" | "separator_failed";

  constructor(
    reason: "model_unavailable" | "runtime_drift" | "separator_timeout" | "separator_failed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SourceSeparatorFailure";
    this.reason = reason;
  }
}
