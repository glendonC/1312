export interface MediaExtractRequest {
  operationId: string;
  taskId: string;
  agentId: string;
  artifactId: string;
  trackId: string;
  startMs: number;
  endMs: number;
}

export interface MediaSeekRequest {
  operationId: string;
  taskId: string;
  agentId: string;
  artifactId: string;
  trackId: string;
  startMs: number;
  endMs: number;
}

export type MediaOperationRequest = MediaExtractRequest | MediaSeekRequest;

export interface MediaExtractReceipt {
  schema: "studio.media-operation.receipt.v1";
  receiptId: string;
  operationId: string;
  capability: "media.extract";
  authorization: {
    grantId: string;
    taskId: string;
    agentId: string;
  };
  request: {
    artifactId: string;
    trackId: string;
    startMs: number;
    endMs: number;
  };
  producer: {
    id: "ffmpeg.audio-range-extract";
    version: string;
  };
  input: {
    artifactId: string;
    contentId: string;
  };
  output: {
    artifactId: string;
    contentId: string;
    bytes: number;
    durationMs: number;
    trackId: string;
  };
  sourceArtifactIds: string[];
}

export interface MediaSeekObservationReceipt {
  schema: "studio.media-perception.receipt.v1";
  receiptId: string;
  operationId: string;
  capability: "media.seek";
  authorization: {
    grantId: string;
    taskId: string;
    agentId: string;
  };
  request: {
    artifactId: string;
    trackId: string;
    startMs: number;
    endMs: number;
  };
  producer: {
    id: "ffmpeg.audio-activity-observation";
    version: string;
  };
  input: {
    artifactId: string;
    contentId: string;
  };
  observation: {
    status: "observed";
    decodedDurationUs: number;
    kind: "audio_activity";
    value: "signal" | "digital_silence";
    range: { startMs: number; endMs: number };
    measurements: {
      meanVolumeDb: number | null;
      peakVolumeDb: number | null;
      silenceThresholdDb: -60;
    };
  };
  sourceArtifactIds: string[];
}

export type MediaOperationReceipt = MediaExtractReceipt | MediaSeekObservationReceipt;


export interface OperationRecord {
  id: string;
  capability: "media.extract" | "media.seek";
  taskId: string;
  agentId: string;
  grantId: string;
  artifactId: string;
  trackId: string;
  startMs: number;
  endMs: number;
  status: "started" | "completed" | "failed";
  outputArtifactId: string | null;
  receiptId: string | null;
  observation: MediaSeekObservationReceipt["observation"] | null;
  failure: string | null;
}
