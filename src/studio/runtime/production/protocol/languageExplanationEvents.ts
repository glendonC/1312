import type {
  LanguageExplanationGrant,
  LanguageExplanationInputAuthority,
  LanguageExplanationReceipt,
  LanguageExplanationRequest,
} from "../model.ts";
import type { RuntimeEventBase } from "./base.ts";

export interface LanguageExplanationStartedEvent extends RuntimeEventBase {
  type: "language.explanation_started";
  data: {
    jobId: string;
    request: LanguageExplanationRequest;
    grant: LanguageExplanationGrant;
    input: LanguageExplanationInputAuthority;
  };
}

export interface LanguageExplanationCompletedEvent extends RuntimeEventBase {
  type: "language.explanation_completed";
  data: {
    jobId: string;
    artifactId: string;
    contentId: string;
    receiptArtifactId: string;
    receiptContentId: string;
    receipt: LanguageExplanationReceipt;
  };
}

export interface LanguageExplanationFailedEvent extends RuntimeEventBase {
  type: "language.explanation_failed";
  data: { jobId: string; reason: string };
}
