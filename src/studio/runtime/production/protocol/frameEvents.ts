import type {
  FrameSampleRequest,
  FrameSamplingFailureReason,
  FrameSamplingLimits,
  FrameSamplingReceipt,
  MediaScope,
} from "../model.ts";
import type { RuntimeEventBase } from "./base.ts";

export interface FrameSamplingStartedEvent extends RuntimeEventBase {
  type: "media.frames_sampling_started";
  data: {
    request: FrameSampleRequest;
    scope: MediaScope;
    sourceContentId: string;
    executionId: string;
    launchClaimId: string;
    requestFingerprint: string;
    limits: FrameSamplingLimits;
  };
}

export interface FrameSamplingCompletedEvent extends RuntimeEventBase {
  type: "media.frames_sampling_completed";
  data: {
    operationId: string;
    manifestArtifactId: string;
    receiptArtifactId: string;
    frameArtifactIds: string[];
    receiptContentId: string;
    receipt: FrameSamplingReceipt;
  };
}

export interface FrameSamplingFailedEvent extends RuntimeEventBase {
  type: "media.frames_sampling_failed";
  data: { operationId: string; reason: FrameSamplingFailureReason };
}
