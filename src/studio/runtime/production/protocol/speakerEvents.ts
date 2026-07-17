import type {
  MediaScope,
  SpeakerOverlapFailureReason,
  SpeakerOverlapLimits,
  SpeakerOverlapReceipt,
  SpeakerOverlapRequest,
} from "../model.ts";
import type { RuntimeEventBase } from "./base.ts";

export interface SpeakerOverlapStartedEvent extends RuntimeEventBase {
  type: "media.speakers_started";
  data: {
    request: SpeakerOverlapRequest;
    scope: MediaScope;
    sourceContentId: string;
    executionId: string;
    launchClaimId: string;
    requestFingerprint: string;
    limits: SpeakerOverlapLimits;
  };
}

export interface SpeakerOverlapCompletedEvent extends RuntimeEventBase {
  type: "media.speakers_completed";
  data: {
    operationId: string;
    outputArtifactId: string;
    receiptArtifactId: string;
    receiptContentId: string;
    receipt: SpeakerOverlapReceipt;
  };
}

export interface SpeakerOverlapFailedEvent extends RuntimeEventBase {
  type: "media.speakers_failed";
  data: { operationId: string; reason: SpeakerOverlapFailureReason };
}
