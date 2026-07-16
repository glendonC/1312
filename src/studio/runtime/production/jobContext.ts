import { canonicalSha256 } from "./canonicalIdentity.ts";
import type {
  MediaScope,
  ProductionAnalysisRequest,
  RuntimeArtifact,
  TaskJobContext,
} from "./model.ts";

type ContextBody = Omit<TaskJobContext, "schema" | "contextId">;

function identity(body: ContextBody): TaskJobContext {
  return {
    schema: "studio.task-job-context.v1",
    contextId: `job-context:${canonicalSha256(body)}`,
    ...structuredClone(body),
  };
}

/** Build the root authority from immutable run-start and registered-artifact identities. */
export function createRootTaskJobContext(input: {
  sourceArtifact: RuntimeArtifact;
  evidenceArtifacts: RuntimeArtifact[];
  analysisRequest: ProductionAnalysisRequest;
}): TaskJobContext {
  if (input.sourceArtifact.origin.kind !== "ingest") {
    throw new Error("Task job context source must be one registered ingest artifact");
  }
  if (
    input.analysisRequest.sourceContentId !== input.sourceArtifact.content.contentId ||
    input.analysisRequest.range.endMs > (input.sourceArtifact.durationMs ?? 0)
  ) {
    throw new Error("Task job context analysis request does not bind the registered source");
  }
  const detectorEvidence = input.evidenceArtifacts.map((artifact) => {
    if (
      artifact.origin.kind !== "preflight_evidence" ||
      artifact.sourceArtifactIds.length !== 1 ||
      artifact.sourceArtifactIds[0] !== input.sourceArtifact.id
    ) {
      throw new Error("Task job context detector evidence does not bind the registered source");
    }
    return {
      artifactId: artifact.id,
      contentId: artifact.content.contentId,
      evidenceKind: artifact.origin.evidenceKind,
    };
  }).sort((left, right) => left.artifactId.localeCompare(right.artifactId));
  const expectedEvidenceContentIds = [...input.analysisRequest.language.detectedLanguageEvidenceContentIds].sort();
  const actualLanguageContentIds = detectorEvidence
    .filter((item) => item.evidenceKind === "language_ranges")
    .map((item) => item.contentId)
    .sort();
  if (JSON.stringify(expectedEvidenceContentIds) !== JSON.stringify(actualLanguageContentIds)) {
    throw new Error("Task job context language evidence identities changed from the analysis request");
  }
  const body: ContextBody = {
    source: {
      artifactId: input.sourceArtifact.id,
      contentId: input.sourceArtifact.content.contentId,
    },
    analysisRequest: {
      requestId: input.analysisRequest.requestId,
      requestedRange: { ...input.analysisRequest.range },
      taskRange: { ...input.analysisRequest.range },
      options: structuredClone(input.analysisRequest.options),
    },
    requestedSourceLanguagePolicy: structuredClone(
      input.analysisRequest.language.languagePair.requestedSource,
    ),
    targetLanguage: input.analysisRequest.language.languagePair.targetLanguage,
    selectedLanguagePackId: input.analysisRequest.language.selectedLanguagePackId,
    outputDepth: input.analysisRequest.outputDepth,
    detectorEvidence,
  };
  return identity(body);
}

function derivedRange(parent: TaskJobContext, scopes: readonly MediaScope[]): { startMs: number; endMs: number } {
  const sourceScopes = scopes.filter((scope) => scope.artifactId === parent.source.artifactId);
  if (sourceScopes.length === 0) return { ...parent.analysisRequest.taskRange };
  return {
    startMs: Math.min(...sourceScopes.map((scope) => scope.startMs)),
    endMs: Math.max(...sourceScopes.map((scope) => scope.endMs)),
  };
}

/** Scheduler-only attenuation. No prose or model-supplied context field is consulted. */
export function attenuateTaskJobContext(
  parent: TaskJobContext,
  mediaScope: readonly MediaScope[],
  inputArtifactIds: readonly string[],
): TaskJobContext {
  const taskRange = derivedRange(parent, mediaScope);
  if (
    taskRange.startMs < parent.analysisRequest.taskRange.startMs ||
    taskRange.endMs > parent.analysisRequest.taskRange.endMs
  ) {
    throw new Error("Child task job context cannot broaden its parent range");
  }
  const allowedInputs = new Set(inputArtifactIds);
  const body: ContextBody = {
    source: structuredClone(parent.source),
    analysisRequest: {
      ...structuredClone(parent.analysisRequest),
      taskRange,
    },
    requestedSourceLanguagePolicy: structuredClone(parent.requestedSourceLanguagePolicy),
    targetLanguage: parent.targetLanguage,
    selectedLanguagePackId: parent.selectedLanguagePackId,
    outputDepth: parent.outputDepth,
    detectorEvidence: parent.detectorEvidence
      .filter((evidence) => allowedInputs.has(evidence.artifactId))
      .map((evidence) => structuredClone(evidence)),
  };
  return identity(body);
}

export function expectedTaskJobContextId(value: TaskJobContext): string {
  const { schema: _schema, contextId: _contextId, ...body } = value;
  return `job-context:${canonicalSha256(body)}`;
}
