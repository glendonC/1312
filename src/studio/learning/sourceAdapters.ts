import type { RunBundle } from "../transport";
import type { Cue } from "../types";
import type {
  LearningSourceContext,
  LearningViewingSource,
  PresentedText,
  RecordedPresentedMoment,
} from "./model.ts";
import {
  availableText,
  exactKeys,
  exactStringArray,
  nonEmptyString,
  record,
  stringArray,
} from "./sourceAdapterPrimitives.ts";

const RECORDED_SOURCE_CONTEXT_KEYS = new Set(["origin", "identities", "rights", "nonClaims"]);
const PRODUCTION_SOURCE_CONTEXT_KEYS = new Set(["origin", "authorityState", "timeline", "identities", "rights", "nonClaims"]);
const PRODUCTION_TIMELINE_KEYS = new Set(["analysisRange", "timestampOrigin"]);
const PRODUCTION_RANGE_KEYS = new Set(["startMs", "endMs"]);
const TIMESTAMP_ORIGIN_KEYS = new Set(["kind", "offsetMs"]);
const RIGHTS_KEYS = new Set(["basis", "licence", "attribution", "mediaExport", "textExport"]);
const EXPORT_STATE_KEYS = new Set(["state", "reasonCode"]);
const RECORDED_IDENTITY_KEYS = new Set([
  "runId",
  "sourceId",
  "sourceContentId",
  "cueIds",
  "captionArtifactId",
  "captionContentId",
]);
const PRODUCTION_IDENTITY_KEYS = new Set([
  "runId",
  "sourceArtifactId",
  "sourceContentId",
  "analysisRequestId",
  "studyId",
  "studyArtifactId",
  "studyContentId",
  "readinessId",
  "readinessArtifactId",
  "readinessReceiptId",
  "readinessReceiptContentId",
  "approvalReviewId",
  "approvalArtifactId",
  "approvalReceiptId",
  "approvalReceiptContentId",
  "captionJobId",
  "captionArtifactId",
  "captionContentId",
  "captionReceiptArtifactId",
  "captionReceiptId",
  "captionReceiptContentId",
  "lineIds",
]);
function recordedSource(cue: Cue): PresentedText {
  if (cue.silence) {
    return {
      state: "unavailable",
      text: null,
      reasonCode: "recorded_silence",
      upstreamReasonCode: null,
      detail: "The recorded cue is a silence interval, so no source caption was emitted.",
    };
  }
  if (cue.source.text) return availableText(cue.source.text);
  return {
    state: "unavailable",
    text: null,
    reasonCode: "recorded_source_text_missing",
    upstreamReasonCode: null,
    detail: "The recorded cue has no source caption text.",
  };
}

function recordedTarget(cue: Cue, targetLanguage: string): PresentedText {
  if (cue.silence) {
    return {
      state: "unavailable",
      text: null,
      reasonCode: "recorded_silence",
      upstreamReasonCode: null,
      detail: "The recorded cue is a silence interval, so no target caption was emitted.",
    };
  }
  const target = cue.targets.find((candidate) => candidate.lang === targetLanguage);
  if (target?.withheld) {
    return {
      state: "withheld",
      text: null,
      reasonCode: "recorded_target_withheld",
      upstreamReasonCode: target.withheld.gate,
      detail: target.withheld.reason,
    };
  }
  if (target?.text) return availableText(target.text);
  return {
    state: "unavailable",
    text: null,
    reasonCode: "recorded_target_text_missing",
    upstreamReasonCode: null,
    detail: "The recorded cue has no target caption text.",
  };
}

export function projectRecordedLearningSource(
  bundle: RunBundle,
): Extract<LearningViewingSource, { context: { origin: "recorded_fixture" } }> {
  const captionsArtifact = bundle.evidence?.artifacts.find((artifact) => artifact.kind === "captions") ?? null;
  const sourceReceipt = bundle.ingestReceipt?.kind === "youtube" ? bundle.ingestReceipt : null;
  const context: Extract<LearningSourceContext, { origin: "recorded_fixture" }> = {
    origin: "recorded_fixture",
    identities: {
      runId: bundle.run.id,
      sourceId: bundle.run.clip.id,
      sourceContentId: bundle.mediaProbe?.input.content_id ?? null,
      cueIds: bundle.captions.cues.map((cue) => cue.id),
      captionArtifactId: captionsArtifact?.artifact_id ?? null,
      captionContentId: captionsArtifact?.content.id ?? null,
    },
    rights: {
      basis: "recorded_provider_licence",
      licence: bundle.run.clip.source.licence ?? sourceReceipt?.licence ?? null,
      attribution: sourceReceipt?.attribution ?? null,
      mediaExport: { state: "unavailable", reasonCode: "media_export_excluded_from_p0" },
      textExport: { state: "unavailable", reasonCode: "canonical_saved_item_missing" },
    },
    nonClaims: [
      "recorded_index_not_original_worker_lineage",
      "semantic_correctness_not_assessed",
      "production_authority_not_granted",
    ],
  };

  return {
    context,
    moments: bundle.captions.cues.map((cue): RecordedPresentedMoment => ({
      lineId: cue.id,
      startMs: Math.round(cue.t_start * 1_000),
      endMs: Math.round(cue.t_end * 1_000),
      sourceLanguage: cue.source.lang,
      targetLanguage: bundle.run.pair.target,
      source: recordedSource(cue),
      target: recordedTarget(cue, bundle.run.pair.target),
      support: {
        state: "none",
        claimIds: [],
        citationIds: [],
        semanticEvidenceArtifactIds: [],
        semanticEvidenceReceiptIds: [],
      },
    })),
  };
}

export function validateLearningSourceContext(input: unknown): LearningSourceContext {
  if (
    !record(input) || !record(input.identities) ||
    !record(input.rights) || !exactKeys(input.rights, RIGHTS_KEYS) ||
    !record(input.rights.mediaExport) || !exactKeys(input.rights.mediaExport, EXPORT_STATE_KEYS) ||
    !record(input.rights.textExport) || !exactKeys(input.rights.textExport, EXPORT_STATE_KEYS) ||
    input.rights.mediaExport.state !== "unavailable" ||
    input.rights.mediaExport.reasonCode !== "media_export_excluded_from_p0"
  ) {
    throw new Error("Learning source context has mixed or invalid authority fields");
  }
  if (input.origin === "recorded_fixture") {
    if (
      !exactKeys(input, RECORDED_SOURCE_CONTEXT_KEYS) ||
      !exactKeys(input.identities, RECORDED_IDENTITY_KEYS)
    ) {
      throw new Error("Recorded learning source context contains production authority fields");
    }
    if (
      !nonEmptyString(input.identities.runId) ||
      !nonEmptyString(input.identities.sourceId) ||
      !(input.identities.sourceContentId === null || nonEmptyString(input.identities.sourceContentId)) ||
      !stringArray(input.identities.cueIds) ||
      !(input.identities.captionArtifactId === null || nonEmptyString(input.identities.captionArtifactId)) ||
      !(input.identities.captionContentId === null || nonEmptyString(input.identities.captionContentId))
    ) throw new Error("Recorded learning source context has invalid identities");
    if (
      input.rights.basis !== "recorded_provider_licence" ||
      !(input.rights.licence === null || nonEmptyString(input.rights.licence)) ||
      !(input.rights.attribution === null || nonEmptyString(input.rights.attribution)) ||
      input.rights.textExport.state !== "unavailable" ||
      input.rights.textExport.reasonCode !== "canonical_saved_item_missing" ||
      !exactStringArray(input.nonClaims, [
        "recorded_index_not_original_worker_lineage",
        "semantic_correctness_not_assessed",
        "production_authority_not_granted",
      ])
    ) throw new Error("Recorded learning source context has invalid authority or rights fields");
    return input as unknown as LearningSourceContext;
  }
  if (input.origin === "verified_production_caption") {
    if (
      !exactKeys(input, PRODUCTION_SOURCE_CONTEXT_KEYS) ||
      !exactKeys(input.identities, PRODUCTION_IDENTITY_KEYS) ||
      !record(input.timeline) || !exactKeys(input.timeline, PRODUCTION_TIMELINE_KEYS) ||
      !record(input.timeline.analysisRange) || !exactKeys(input.timeline.analysisRange, PRODUCTION_RANGE_KEYS) ||
      !record(input.timeline.timestampOrigin) || !exactKeys(input.timeline.timestampOrigin, TIMESTAMP_ORIGIN_KEYS)
    ) {
      throw new Error("Production learning source context contains recorded authority fields");
    }
    for (const [key, value] of Object.entries(input.identities)) {
      if (key === "lineIds" ? !stringArray(value) : !nonEmptyString(value)) {
        throw new Error(`Production learning source context has invalid ${key}`);
      }
    }
    if (
      (input.authorityState !== "unrevoked" && input.authorityState !== "revoked_after_completion") ||
      typeof input.timeline.analysisRange.startMs !== "number" ||
      !Number.isInteger(input.timeline.analysisRange.startMs) || input.timeline.analysisRange.startMs < 0 ||
      typeof input.timeline.analysisRange.endMs !== "number" ||
      !Number.isInteger(input.timeline.analysisRange.endMs) ||
      input.timeline.analysisRange.endMs <= input.timeline.analysisRange.startMs ||
      input.timeline.timestampOrigin.kind !== "source_media_zero" ||
      input.timeline.timestampOrigin.offsetMs !== 0 ||
      input.rights.basis !== "production_private_source_policy" ||
      input.rights.licence !== null || input.rights.attribution !== null ||
      input.rights.textExport.state !== "unavailable" ||
      input.rights.textExport.reasonCode !== "export_adapter_missing" ||
      !exactStringArray(input.nonClaims, [
        "semantic_correctness_not_assessed",
        "translation_quality_not_assessed",
        "publication_not_authorized",
      ])
    ) throw new Error("Production learning source context has invalid authority or rights fields");
    return input as unknown as LearningSourceContext;
  }
  throw new Error("Learning source context origin is invalid");
}

export function validateLearningViewingSource(input: LearningViewingSource): LearningViewingSource {
  const context = validateLearningSourceContext(input.context);
  if (!Array.isArray(input.moments)) throw new Error("Learning viewing source moments are invalid");
  const lineIds = input.moments.map((moment) => moment.lineId);
  if (!stringArray(lineIds) || new Set(lineIds).size !== lineIds.length) {
    throw new Error("Learning viewing source line identities are invalid");
  }
  const expectedLineIds = context.origin === "recorded_fixture"
    ? context.identities.cueIds
    : context.identities.lineIds;
  if (!exactStringArray(lineIds, expectedLineIds)) {
    throw new Error("Learning viewing source moments do not match source authority identities");
  }
  for (const moment of input.moments) {
    if (
      !Number.isInteger(moment.startMs) || !Number.isInteger(moment.endMs) ||
      moment.startMs < 0 || moment.endMs <= moment.startMs ||
      !nonEmptyString(moment.sourceLanguage) || !nonEmptyString(moment.targetLanguage)
    ) throw new Error("Learning viewing source moment is invalid");
    if (
      context.origin === "verified_production_caption" &&
      (
        moment.startMs < context.timeline.analysisRange.startMs ||
        moment.endMs > context.timeline.analysisRange.endMs
      )
    ) throw new Error("Production learning moment falls outside its verified analysis range");
    const support = moment.support;
    const supportArrays = [
      support.claimIds,
      support.citationIds,
      support.semanticEvidenceArtifactIds,
      support.semanticEvidenceReceiptIds,
    ];
    if (supportArrays.some((values) => !stringArray(values) || new Set(values).size !== values.length)) {
      throw new Error("Learning viewing source support identities are invalid");
    }
    if (context.origin === "recorded_fixture") {
      if (support.state !== "none" || supportArrays.some((values) => values.length !== 0)) {
        throw new Error("Recorded learning source cannot carry production caption support");
      }
    } else if (
      support.state === "caption_line_support" && supportArrays.every((values) => values.length === 0)
    ) {
      throw new Error("Production caption support cannot be empty");
    }
  }
  return input;
}
