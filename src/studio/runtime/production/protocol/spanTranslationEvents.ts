import type {
  SpanTranslationGrant,
  SpanTranslationInputAuthority,
  SpanTranslationReceipt,
  SpanTranslationRequest,
} from "../model.ts";
import type { RuntimeEventBase } from "./base.ts";

export interface SpanTranslationStartedEvent extends RuntimeEventBase {
  type: "translation.span_started";
  data: {
    jobId: string;
    request: SpanTranslationRequest;
    grant: SpanTranslationGrant;
    input: SpanTranslationInputAuthority;
  };
}

export interface SpanTranslationCompletedEvent extends RuntimeEventBase {
  type: "translation.span_completed";
  data: {
    jobId: string;
    artifactId: string;
    contentId: string;
    receiptArtifactId: string;
    receiptContentId: string;
    receipt: SpanTranslationReceipt;
  };
}

export interface SpanTranslationFailedEvent extends RuntimeEventBase {
  type: "translation.span_failed";
  data: { jobId: string; reason: string };
}
