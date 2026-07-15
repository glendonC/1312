import type { AnalysisRequest } from "../preflight/model.ts";
import {
  RUNTIME_HOST_LIFECYCLE_STATES,
  type RuntimeHostFailureReason,
  type RuntimeHostLifecycleState,
  type RuntimeHostSourceSummary,
  type RuntimeHostStartRequest,
} from "../runtime/production/runtimeHost/model.ts";

export interface LocalRuntimeStartInputs {
  source: RuntimeHostSourceSummary;
  analysisRequest: AnalysisRequest;
  requestedSourceLanguage: RuntimeHostStartRequest["requestedSourceLanguage"];
  selectedLanguagePackId: string | null;
}

export interface LocalRuntimeLifecycleProjection {
  label: string;
  detail: string;
  running: boolean;
  closed: boolean;
  tone: "pending" | "running" | "closed" | "failed";
}

function milliseconds(seconds: number, label: string): number {
  const value = Math.round(seconds * 1_000);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Local runtime request: ${label} must be a non-negative time in seconds.`);
  }
  return value;
}

export function isLocalRuntimeLanguageTag(value: string): boolean {
  return /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value);
}

function assertRequestedLanguages(value: RuntimeHostStartRequest["requestedSourceLanguage"]): void {
  if (value.languages.some((language) => !isLocalRuntimeLanguageTag(language))) {
    throw new Error("Local runtime request: requested source languages must be BCP-47 tags.");
  }
}

/** Maps only product input plus stable host-returned source identities into the host command. */
export function mapAnalysisRequestToRuntimeStart({
  source,
  analysisRequest,
  requestedSourceLanguage,
  selectedLanguagePackId,
}: LocalRuntimeStartInputs): RuntimeHostStartRequest {
  const startMs = milliseconds(analysisRequest.start, "range start");
  const endMs = milliseconds(analysisRequest.end, "range end");
  if (endMs <= startMs) {
    throw new Error("Local runtime request: the selected range must be non-empty.");
  }
  if (endMs > source.durationMs) {
    throw new Error("Local runtime request: the selected range exceeds the registered source duration.");
  }
  if (!isLocalRuntimeLanguageTag(analysisRequest.targetLanguage)) {
    throw new Error("Local runtime request: target language must be a BCP-47 tag.");
  }
  assertRequestedLanguages(requestedSourceLanguage);
  if (
    selectedLanguagePackId !== null &&
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(selectedLanguagePackId)
  ) {
    throw new Error("Local runtime request: language-pack identity must not contain path characters.");
  }

  return {
    sourceSessionId: source.sourceSessionId,
    sourceRevisionId: source.sourceRevisionId,
    range: { startMs, endMs },
    requestedSourceLanguage: structuredClone(requestedSourceLanguage),
    targetLanguage: analysisRequest.targetLanguage,
    selectedLanguagePackId,
    outputDepth: analysisRequest.outputDepth,
    options: {
      speechScope: analysisRequest.speechScope,
      includeLyrics: analysisRequest.includeLyrics,
      speaker: analysisRequest.speaker,
      honorifics: analysisRequest.honorifics,
      translationStyle: analysisRequest.translationStyle,
      captionDensity: analysisRequest.captionDensity,
      slowAnalysis: analysisRequest.slowAnalysis,
    },
  };
}

export function isRuntimeHostLifecycle(value: unknown): value is RuntimeHostLifecycleState {
  return (RUNTIME_HOST_LIFECYCLE_STATES as readonly unknown[]).includes(value);
}

/** Accepted and initializing remain explicitly pre-running; only host evidence can select running. */
export function projectLocalRuntimeLifecycle(
  lifecycle: RuntimeHostLifecycleState,
  reason: RuntimeHostFailureReason | null,
): LocalRuntimeLifecycleProjection {
  if (lifecycle === "accepted") {
    return {
      label: "Accepted",
      detail: "The command is durable. Executor start is not yet evidenced.",
      running: false,
      closed: false,
      tone: "pending",
    };
  }
  if (lifecycle === "initializing") {
    return {
      label: "Initializing",
      detail: "The receipt and journal are being initialized. This is not running.",
      running: false,
      closed: false,
      tone: "pending",
    };
  }
  if (lifecycle === "running") {
    return {
      label: "Running",
      detail: "The host reports validated executor-start evidence.",
      running: true,
      closed: false,
      tone: "running",
    };
  }
  if (lifecycle === "terminal") {
    return {
      label: "Terminal",
      detail: "The bounded one-child proof reached a terminal journal state.",
      running: false,
      closed: true,
      tone: "closed",
    };
  }
  if (!reason) {
    throw new Error(`Local runtime lifecycle: ${lifecycle} requires a closed reason.`);
  }
  return {
    label: lifecycle === "failed" ? "Failed" : "Interrupted",
    detail: `${reason.message} (${reason.code})`,
    running: false,
    closed: true,
    tone: "failed",
  };
}
