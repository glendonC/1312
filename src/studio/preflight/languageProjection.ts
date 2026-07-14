import type {
  LanguageRangeDecision,
  LanguageRangeScore,
  LanguageRangesReceipt,
} from "./contracts";

export interface RecordedLanguageRange {
  speechWindowIndex: number;
  chunkIndex: number;
  startSample: number;
  endSample: number;
  startSeconds: number;
  endSeconds: number;
  scores: LanguageRangeScore[];
  decision: LanguageRangeDecision;
}

/** Provider-neutral display facts derived only from an already-validated language receipt. */
export interface RecordedLanguageRangeFacts {
  producer: {
    id: string;
    version: string;
    modelId: string;
    modelRevision: string;
    quantization: string;
  };
  sampleRateHz: number;
  sampleCount: number;
  ranges: RecordedLanguageRange[];
}

export function projectLanguageRanges(
  receipt: LanguageRangesReceipt | null | undefined,
): RecordedLanguageRangeFacts | null {
  if (!receipt) return null;
  const sampleRateHz = receipt.input.sample_rate_hz;
  return {
    producer: {
      id: receipt.producer.id,
      version: receipt.producer.version,
      modelId: receipt.producer.model.id,
      modelRevision: receipt.producer.model.revision,
      quantization: receipt.producer.model.quantization,
    },
    sampleRateHz,
    sampleCount: receipt.input.sample_count,
    ranges: receipt.ranges.map((range) => ({
      speechWindowIndex: range.speech_window_index,
      chunkIndex: range.chunk_index,
      startSample: range.start_sample,
      endSample: range.end_sample,
      startSeconds: range.start_sample / sampleRateHz,
      endSeconds: range.end_sample / sampleRateHz,
      scores: range.scores.map((score) => ({ ...score })),
      decision: { ...range.decision },
    })),
  };
}
