import { canonicalSha256 } from "../canonicalIdentity.ts";
import type {
  LearningPrepCaptionIdentity,
  LearningPrepExecutorDescriptor,
  LearningPrepInputAuthority,
  LearningPrepRequest,
} from "../model.ts";
import { LEARNING_PREP_LIMITS } from "../model.ts";

export function createLearningPrepRequestFingerprint(input: {
  runId: string;
  request: LearningPrepRequest;
  authority: LearningPrepInputAuthority;
  executor: LearningPrepExecutorDescriptor;
  rightsScope: "local_processing" | "redistribution";
}): string {
  return `learning-prep-request:${canonicalSha256({
    runId: input.runId,
    request: input.request,
    input: input.authority,
    executor: input.executor,
    rightsScope: input.rightsScope,
    limits: LEARNING_PREP_LIMITS,
  })}`;
}

export function createLearningPrepGrantId(input: {
  runId: string;
  requestFingerprint: string;
  caption: LearningPrepCaptionIdentity;
  attempt: number;
}): string {
  return `learning-prep-grant:${canonicalSha256(input)}`;
}

export function createLearningPrepJobId(grantId: string): string {
  return grantId.replace(/^learning-prep-grant:/, "learning-prep:");
}
