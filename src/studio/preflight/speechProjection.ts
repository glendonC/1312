import type { SpeechActivityReceipt } from "./contracts";

/** Provider-neutral display facts derived only from an already-validated detector receipt. */
export interface RecordedSpeechActivityFacts {
  producer: { id: string; version: string; modelRevision: string };
  sampleRateHz: number;
  sampleCount: number;
  speechSamples: number;
  speechDuration: number;
  coverage: number;
  windows: Array<{
    startSample: number;
    endSample: number;
    startSeconds: number;
    endSeconds: number;
  }>;
}

export function projectSpeechActivity(
  receipt: SpeechActivityReceipt | null | undefined,
): RecordedSpeechActivityFacts | null {
  if (!receipt) return null;
  const sampleRateHz = receipt.normalization.sample_rate_hz;
  const speechSamples = receipt.speech_windows.reduce(
    (total, window) => total + window.end_sample - window.start_sample,
    0,
  );
  return {
    producer: {
      id: receipt.producer.id,
      version: receipt.producer.version,
      modelRevision: receipt.producer.model.revision,
    },
    sampleRateHz,
    sampleCount: receipt.normalization.sample_count,
    speechSamples,
    speechDuration: speechSamples / sampleRateHz,
    coverage: speechSamples / receipt.normalization.sample_count,
    windows: receipt.speech_windows.map((window) => ({
      startSample: window.start_sample,
      endSample: window.end_sample,
      startSeconds: window.start_sample / sampleRateHz,
      endSeconds: window.end_sample / sampleRateHz,
    })),
  };
}
