import { fail } from "./primitives.ts";
import { validateExecutionArtifactOrigin } from "./artifactExecutionOrigins.ts";
import { validateFrameArtifactOrigin } from "./artifactFrameOrigins.ts";
import { validateReviewArtifactOrigin } from "./artifactReviewOrigins.ts";
import { validateSpeakerArtifactOrigin } from "./artifactSpeakerOrigins.ts";
import { validateSeparationArtifactOrigin } from "./artifactSeparationOrigins.ts";
import { validateResearchArtifactOrigin } from "./artifactResearchOrigins.ts";
import { validateStudyArtifactOrigin } from "./artifactStudyOrigins.ts";
import { validateComputerUseArtifactOrigin } from "./artifactComputerUseOrigins.ts";
import { validateVisualTransitionArtifactOrigin } from "./artifactVisualTransitionOrigins.ts";

export interface ArtifactOriginValidationInput {
  item: Record<string, unknown>;
  origin: Record<string, unknown>;
  mediaClass: string;
  sources: string[];
  task: string | null;
  agent: string | null;
  context: string;
  path: string;
}

export function validateArtifactOrigin(
  kind: string,
  input: ArtifactOriginValidationInput,
): void {
  if (validateExecutionArtifactOrigin(kind, input)) return;
  if (validateFrameArtifactOrigin(kind, input)) return;
  if (validateSpeakerArtifactOrigin(kind, input)) return;
  if (validateSeparationArtifactOrigin(kind, input)) return;
  if (validateResearchArtifactOrigin(kind, input)) return;
  if (validateComputerUseArtifactOrigin(kind, input)) return;
  if (validateStudyArtifactOrigin(kind, input)) return;
  if (validateReviewArtifactOrigin(kind, input)) return;
  if (validateVisualTransitionArtifactOrigin(kind, input)) return;
  fail(input.context, `${input.path}.origin.kind`, `has unknown value ${kind}`);
}
