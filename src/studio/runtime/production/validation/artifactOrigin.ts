import { fail } from "./primitives.ts";
import { validateExecutionArtifactOrigin } from "./artifactExecutionOrigins.ts";
import { validateReviewArtifactOrigin } from "./artifactReviewOrigins.ts";
import { validateStudyArtifactOrigin } from "./artifactStudyOrigins.ts";

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
  if (validateStudyArtifactOrigin(kind, input)) return;
  if (validateReviewArtifactOrigin(kind, input)) return;
  fail(input.context, `${input.path}.origin.kind`, `has unknown value ${kind}`);
}
