import { createRootTaskJobContext } from "../src/studio/runtime/production/jobContext.ts";
import type {
  ProductionAnalysisRequest,
  RuntimeArtifact,
  TaskJobContext,
} from "../src/studio/runtime/production/model.ts";

export function runtimeTestJobContext(input: {
  source: RuntimeArtifact;
  evidence?: RuntimeArtifact[];
  range: { startMs: number; endMs: number };
  requestId?: string;
}): TaskJobContext {
  const evidence = input.evidence ?? [];
  const request: ProductionAnalysisRequest = {
    schema: "studio.analysis-request.v1",
    requestId: input.requestId ?? "analysis-request:test-job-context",
    sourceSessionId: "source-session:test-job-context",
    sourceRevisionId: "source-revision:test-job-context",
    sourceContentId: input.source.content.contentId,
    range: { ...input.range },
    language: {
      languagePair: {
        requestedSource: { mode: "unknown", languages: [], reason: null },
        targetLanguage: "en",
      },
      selectedLanguagePackId: null,
      detectedLanguageEvidenceContentIds: evidence
        .filter((artifact) => artifact.origin.kind === "preflight_evidence" && artifact.origin.evidenceKind === "language_ranges")
        .map((artifact) => artifact.content.contentId),
    },
    outputDepth: "evidence",
    options: {
      speechScope: "foreground",
      includeLyrics: false,
      speaker: null,
      honorifics: "preserve",
      translationStyle: "natural",
      captionDensity: "balanced",
      slowAnalysis: false,
    },
  };
  return createRootTaskJobContext({ sourceArtifact: input.source, evidenceArtifacts: evidence, analysisRequest: request });
}
