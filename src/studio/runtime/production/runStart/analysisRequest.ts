import {
  assertProductionAnalysisRequest,
  assertProductionSourceSession,
} from "../assertions.ts";
import { canonicalSha256 } from "../artifactStore.ts";
import type {
  ProductionAnalysisRequest,
  RequestedSourceLanguage,
} from "../model.ts";

export interface AnalysisRequestInput {
  range: { startMs: number; endMs: number };
  requestedSource: RequestedSourceLanguage;
  targetLanguage: string;
  selectedLanguagePackId: string | null;
  outputDepth: "captions" | "evidence";
  options?: Partial<ProductionAnalysisRequest["options"]>;
}

export function createProductionAnalysisRequest(
  sessionValue: unknown,
  input: AnalysisRequestInput,
): ProductionAnalysisRequest {
  assertProductionSourceSession(sessionValue);
  const session = sessionValue;
  const options: ProductionAnalysisRequest["options"] = {
    speechScope: "foreground",
    includeLyrics: false,
    speaker: null,
    honorifics: "preserve",
    translationStyle: "natural",
    captionDensity: "balanced",
    slowAnalysis: false,
    ...input.options,
  };
  const body = {
    sourceSessionId: session.sessionId,
    sourceRevisionId: session.revisionId,
    sourceContentId: session.source.contentId,
    range: { ...input.range },
    language: {
      languagePair: {
        requestedSource: structuredClone(input.requestedSource),
        targetLanguage: input.targetLanguage,
      },
      selectedLanguagePackId: input.selectedLanguagePackId,
      detectedLanguageEvidenceContentIds: [...session.detectedLanguageEvidenceContentIds],
    },
    outputDepth: input.outputDepth,
    options,
  };
  const request: ProductionAnalysisRequest = {
    schema: "studio.analysis-request.v1",
    requestId: `analysis-request:${canonicalSha256(body)}`,
    ...body,
  };
  assertProductionAnalysisRequest(request);
  if (request.range.endMs > session.source.durationMs) {
    throw new Error("Production analysis request: selected range exceeds the measured source duration");
  }
  return request;
}
