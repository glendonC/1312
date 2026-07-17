import type { MediaScope, OcrFailureReason, OcrLimits, OcrReceipt, OcrRequest } from "../model.ts";
import type { RuntimeEventBase } from "./base.ts";

export interface OcrStartedEvent extends RuntimeEventBase {
  type: "media.frames_ocr_started";
  data: {
    request: OcrRequest;
    scope: MediaScope;
    sourceContentId: string;
    executionId: string;
    launchClaimId: string;
    requestFingerprint: string;
    limits: OcrLimits;
  };
}

export interface OcrCompletedEvent extends RuntimeEventBase {
  type: "media.frames_ocr_completed";
  data: {
    operationId: string;
    outputArtifactId: string;
    receiptArtifactId: string;
    receiptContentId: string;
    receipt: OcrReceipt;
  };
}

export interface OcrFailedEvent extends RuntimeEventBase {
  type: "media.frames_ocr_failed";
  data: { operationId: string; reason: OcrFailureReason };
}
