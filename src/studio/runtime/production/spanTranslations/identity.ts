import { canonicalSha256 } from "../canonicalIdentity.ts";
import type {
  SpanTranslationCaptionIdentity,
  SpanTranslationExecutorDescriptor,
  SpanTranslationInputAuthority,
  SpanTranslationRequest,
} from "../model.ts";
import { SPAN_TRANSLATION_LIMITS } from "../model.ts";

export function createSpanTranslationRequestFingerprint(input: {
  runId: string;
  request: SpanTranslationRequest;
  authority: SpanTranslationInputAuthority;
  executor: SpanTranslationExecutorDescriptor;
  rightsScope: "local_processing" | "redistribution";
}): string {
  return `span-translation-request:${canonicalSha256({
    runId: input.runId,
    request: input.request,
    input: input.authority,
    executor: input.executor,
    rightsScope: input.rightsScope,
    limits: SPAN_TRANSLATION_LIMITS,
  })}`;
}

export function createSpanTranslationGrantId(input: {
  runId: string;
  requestFingerprint: string;
  caption: SpanTranslationCaptionIdentity;
  attempt: number;
}): string {
  return `span-translation-grant:${canonicalSha256(input)}`;
}

export function createSpanTranslationJobId(grantId: string): string {
  return grantId.replace(/^span-translation-grant:/, "span-translation:");
}
