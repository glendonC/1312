import type { RunBundle } from "../transport";
import { classifySourceUrl, normalizeIngestReceipt, type RecordedSourceFacts } from "./sourceAdapters";

export const RECOMMENDED_RANGE_S = { min: 30, max: 60 } as const;
export const HOSTED_MAX_RANGE_S = 120;

export type PreflightStatus =
  | "idle"
  | "loading_source"
  | "probing"
  | "ready"
  | "invalid_source"
  | "inaccessible"
  | "no_target_language"
  | "mixed_language"
  | "excessive_duration"
  | "cancelled";

export type RangeMode = "recorded" | "suggested" | "detected" | "custom";
export type OutputDepth = "captions" | "evidence";

export interface AnalysisRequest {
  rangeMode: RangeMode;
  start: number;
  end: number;
  targetLanguage: string;
  outputDepth: OutputDepth;
  speechScope: "foreground" | "all";
  includeLyrics: boolean;
  speaker: string | null;
  honorifics: "preserve" | "naturalize";
  translationStyle: "literal" | "natural";
  captionDensity: "compact" | "balanced" | "relaxed";
  slowAnalysis: boolean;
  acceptLongLocal: boolean;
}

export interface ProducerGap {
  id: "container" | "language" | "acoustic" | "overlap" | "complexity" | "hosted-ingest";
  label: string;
  consequence: string;
}

export interface PreflightProvenance {
  kind: "recorded_ingest" | "contract_fixture" | "client_validation";
  producer: string | null;
  note: string;
}

export interface PreflightSession {
  status: PreflightStatus;
  title: string;
  message: string;
  facts: RecordedSourceFacts | null;
  request: AnalysisRequest;
  missing: ProducerGap[];
  provenance: PreflightProvenance;
  /** Used only by explicit development fixtures to expose relevance-gated controls. */
  relevance: { backgroundSpeech: boolean; music: boolean; speakerFocus: boolean };
}

export const PRODUCER_GAPS: readonly ProducerGap[] = [
  {
    id: "container",
    label: "Track and codec probe",
    consequence: "No container, codec, channel, or sample-rate measurement is available.",
  },
  {
    id: "language",
    label: "Time-ranged language detector",
    consequence: "No target-language range, mixed-language range, or language-absence finding can be produced.",
  },
  {
    id: "acoustic",
    label: "Music, speech, and noise classifier",
    consequence: "An empty music array cannot be read as proof that this source is music-free.",
  },
  {
    id: "overlap",
    label: "Preflight speaker and overlap estimator",
    consequence: "Diarizer labels from the completed run are not a preflight identity measurement.",
  },
  {
    id: "complexity",
    label: "Measured range recommender",
    consequence: "No suggested range or processing estimate is available.",
  },
] as const;

export function initialRequest(targetLanguage = "en", duration = 0): AnalysisRequest {
  return {
    rangeMode: "recorded",
    start: 0,
    end: Math.max(0, duration),
    targetLanguage,
    outputDepth: "evidence",
    speechScope: "foreground",
    includeLyrics: false,
    speaker: null,
    honorifics: "preserve",
    translationStyle: "natural",
    captionDensity: "balanced",
    slowAnalysis: false,
    acceptLongLocal: false,
  };
}

export function idlePreflight(): PreflightSession {
  return {
    status: "idle",
    title: "",
    message: "",
    facts: null,
    request: initialRequest(),
    missing: [],
    provenance: { kind: "client_validation", producer: null, note: "No source has been selected." },
    relevance: { backgroundSpeech: false, music: false, speakerFocus: false },
  };
}

export function loadingRecordedPreflight(): PreflightSession {
  return {
    ...idlePreflight(),
    status: "loading_source",
    title: "Loading recorded source facts",
    message: "Studio is loading the recorded ingest receipt. No new source analysis is running.",
    provenance: {
      kind: "recorded_ingest",
      producer: "ReplayTransport",
      note: "Waiting for the recorded bundle and its optional source receipt.",
    },
  };
}

export function unavailableRecordedPreflight(): PreflightSession {
  return {
    ...idlePreflight(),
    status: "inaccessible",
    title: "Recorded source unavailable",
    message: "The recorded run must load successfully before its source can be confirmed.",
    provenance: { kind: "recorded_ingest", producer: null, note: "No bundle is loaded." },
  };
}

export function cancelledPreflight(current: PreflightSession): PreflightSession {
  return {
    ...idlePreflight(),
    status: "cancelled",
    title: "Source confirmation cancelled",
    message: "No analysis was started and no result is being shown.",
    request: current.request,
    provenance: {
      kind: current.provenance.kind,
      producer: current.provenance.producer,
      note: "The user cancelled before starting the replay.",
    },
  };
}

export function recordedPreflight(bundle: RunBundle): PreflightSession {
  const facts = normalizeIngestReceipt(bundle);
  if (!facts) {
    return {
      ...idlePreflight(),
      status: "inaccessible",
      title: "Source receipt unavailable",
      message:
        "This recorded run has no ingest receipt, so Studio cannot establish source access, licence, or the selected source window.",
      request: initialRequest(bundle.run.pair.target, bundle.run.clip.duration),
      missing: [
        {
          id: "hosted-ingest",
          label: "Source ingest receipt",
          consequence: "Confirmation is withheld because the source facts cannot be reconstructed.",
        },
      ],
      provenance: {
        kind: "recorded_ingest",
        producer: null,
        note: "No source.json receipt was recorded for this run.",
      },
    };
  }

  return {
    status: "ready",
    title: "Recorded source ready for confirmation",
    message:
      "These facts came from the ingest receipt for the already-recorded run. This is not a new live probe.",
    facts,
    request: initialRequest(bundle.run.pair.target, facts.selection.duration),
    missing: PRODUCER_GAPS.filter((gap) => gap.id !== "container" || facts.mediaProbe === null),
    provenance: {
      kind: "recorded_ingest",
      producer: facts.producer,
      note:
        facts.rights.basis === "ownership_attestation"
          ? "Ownership scope, stable raw content identity, full-file selection, and derived probe lineage were recorded during local ingest."
          : "Redistribution licence, selected duration, source window, media, and waveform were produced during ingest.",
    },
    relevance: { backgroundSpeech: false, music: false, speakerFocus: false },
  };
}

export function submittedSourcePreflight(raw: string): PreflightSession {
  const classification = classifySourceUrl(raw);
  if (classification.kind === "invalid") {
    return {
      ...idlePreflight(),
      status: "invalid_source",
      title: "Invalid source",
      message: classification.label,
      provenance: { kind: "client_validation", producer: "URL parser", note: "No network request ran." },
    };
  }

  if (classification.kind === "unsupported") {
    return {
      ...idlePreflight(),
      status: "invalid_source",
      title: "Source is not supported",
      message: classification.label,
      provenance: { kind: "client_validation", producer: "source allowlist", note: "No network request ran." },
    };
  }

  return {
    ...idlePreflight(),
    status: "inaccessible",
    title: "Hosted source probe unavailable",
    message:
      "The static Studio cannot fetch or inspect this link. No analysis was started. Use the recorded source, or run the ingest producer locally.",
    missing: [
      {
        id: "hosted-ingest",
        label: "Hosted ingest service",
        consequence: "Access, licence, duration, and media metadata could not be checked.",
      },
    ],
    provenance: {
      kind: "client_validation",
      producer: classification.producer,
      note: `The ${classification.adapter} source adapter accepted the URL; no remote probe ran.`,
    },
  };
}

export interface RangeAssessment {
  duration: number | null;
  canReplay: boolean;
  reason: string | null;
  recommendation: "short" | "recommended" | "long" | null;
  localWarning: boolean;
}

export function assessRecordedRequest(
  session: PreflightSession,
  bundle: RunBundle,
  allowLongLocal: boolean,
): RangeAssessment {
  if (session.status !== "ready" || !session.facts) {
    return { duration: null, canReplay: false, reason: "Preflight is not ready.", recommendation: null, localWarning: false };
  }

  const { start, end, rangeMode, targetLanguage } = session.request;
  if (![start, end].every(Number.isFinite) || start < 0 || end <= start || end > session.facts.selection.duration) {
    return {
      duration: Number.isFinite(end - start) ? end - start : null,
      canReplay: false,
      reason: `Choose a valid range within 0:00–${formatSeconds(session.facts.selection.duration)}.`,
      recommendation: null,
      localWarning: false,
    };
  }

  const duration = end - start;
  const recommendation =
    duration < RECOMMENDED_RANGE_S.min
      ? "short"
      : duration <= RECOMMENDED_RANGE_S.max
        ? "recommended"
        : "long";
  const overHostedCap = duration > HOSTED_MAX_RANGE_S;
  if (overHostedCap && (!allowLongLocal || !session.request.acceptLongLocal)) {
    return {
      duration,
      canReplay: false,
      reason: `Hosted analysis is limited to ${HOSTED_MAX_RANGE_S} seconds. Choose a smaller range.`,
      recommendation,
      localWarning: false,
    };
  }

  if (targetLanguage !== bundle.run.pair.target) {
    return { duration, canReplay: false, reason: "No recorded artifact exists for that target language.", recommendation, localWarning: overHostedCap };
  }
  if (rangeMode === "suggested") {
    return { duration, canReplay: false, reason: "No range recommender ran for this source.", recommendation, localWarning: overHostedCap };
  }
  if (rangeMode === "detected") {
    return { duration, canReplay: false, reason: "No time-ranged language detector ran for this source.", recommendation, localWarning: overHostedCap };
  }
  if (Math.abs(start) > 0.01 || Math.abs(end - bundle.run.clip.duration) > 0.01) {
    return {
      duration,
      canReplay: false,
      reason: `The recorded evidence covers only the full 0:00–${formatSeconds(bundle.run.clip.duration)} selection. A new range needs a new producer run.`,
      recommendation,
      localWarning: overHostedCap,
    };
  }

  if (
    session.request.speechScope !== "foreground" ||
    session.request.includeLyrics ||
    session.request.speaker !== null ||
    session.request.honorifics !== "preserve" ||
    session.request.translationStyle !== "natural" ||
    session.request.captionDensity !== "balanced" ||
    session.request.slowAnalysis
  ) {
    return {
      duration,
      canReplay: false,
      reason: "The recorded artifact does not contain that advanced configuration.",
      recommendation,
      localWarning: overHostedCap,
    };
  }

  return { duration, canReplay: true, reason: null, recommendation, localWarning: overHostedCap };
}

export function formatSeconds(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const safe = Math.max(0, value);
  const minutes = Math.floor(safe / 60);
  const seconds = safe - minutes * 60;
  const shown = Number.isInteger(seconds) ? String(seconds).padStart(2, "0") : seconds.toFixed(1).padStart(4, "0");
  return `${minutes}:${shown}`;
}
