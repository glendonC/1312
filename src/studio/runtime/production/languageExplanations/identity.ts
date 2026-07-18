import { canonicalSha256 } from "../canonicalIdentity.ts";
import type {
  LanguageExplanationCaptionIdentity,
  LanguageExplanationExecutorDescriptor,
  LanguageExplanationInputAuthority,
  LanguageExplanationRequest,
} from "../model.ts";
import { LANGUAGE_EXPLANATION_LIMITS } from "../model.ts";

export function createLanguageExplanationRequestFingerprint(input: {
  runId: string;
  request: LanguageExplanationRequest;
  authority: LanguageExplanationInputAuthority;
  executor: LanguageExplanationExecutorDescriptor;
  rightsScope: "local_processing" | "redistribution";
}): string {
  return `language-explanation-request:${canonicalSha256({
    runId: input.runId,
    request: input.request,
    input: input.authority,
    executor: input.executor,
    rightsScope: input.rightsScope,
    limits: LANGUAGE_EXPLANATION_LIMITS,
  })}`;
}

export function createLanguageExplanationGrantId(input: {
  runId: string;
  requestFingerprint: string;
  caption: LanguageExplanationCaptionIdentity;
  attempt: number;
}): string {
  return `language-explanation-grant:${canonicalSha256(input)}`;
}

export function createLanguageExplanationJobId(grantId: string): string {
  return grantId.replace(/^language-explanation-grant:/, "language-explanation:");
}
