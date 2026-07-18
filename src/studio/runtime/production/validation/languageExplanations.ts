import type {
  GeneratedLanguageExplanationFacet,
  LanguageExplanationArtifact,
  LanguageExplanationCaptionIdentity,
  LanguageExplanationContextLine,
  LanguageExplanationExecutorDescriptor,
  LanguageExplanationFacet,
  LanguageExplanationFacetKind,
  LanguageExplanationGrant,
  LanguageExplanationInputAuthority,
  LanguageExplanationReceipt,
  LanguageExplanationRequest,
  LanguageExplanationTextSnapshot,
} from "../model.ts";
import {
  LANGUAGE_EXPLANATION_FACET_KINDS,
  LANGUAGE_EXPLANATION_LIMITS,
  LANGUAGE_EXPLANATION_NON_CLAIMS,
} from "../model.ts";
import { validateStudyReadinessReceiptIdentity } from "./publishReview.ts";
import {
  array,
  contentId,
  exact,
  fail,
  integer,
  literal,
  nullableInteger,
  nullableString,
  object,
  oneOf,
  string,
  uniqueStrings,
} from "./primitives.ts";

const FACET_KINDS = new Set<string>(LANGUAGE_EXPLANATION_FACET_KINDS);
type MissingFacetReason = Exclude<LanguageExplanationReceipt["result"]["facets"][number]["reasonCode"], null>;

const MISSING_REASONS = new Set<MissingFacetReason>([
  "generator_abstained",
  "facet_not_applicable",
  "insufficient_caption_context",
  "target_unavailable",
]);
const NON_CLAIMS = new Set<string>(LANGUAGE_EXPLANATION_NON_CLAIMS);
const CAPTION_REASON_CODES = new Set<Extract<LanguageExplanationTextSnapshot, { state: "withheld" | "unavailable" }>["reasonCode"]>([
  "recorded_quality_gate_withheld",
  "recognizer_unavailable",
  "recognizer_empty",
  "translator_unavailable",
  "translator_missing_line",
  "source_unavailable",
  "study_coverage_withheld",
  "study_coverage_unknown",
  "study_coverage_failed",
  "study_coverage_unavailable",
  "study_coverage_truncated",
  "study_readiness_withheld",
  "study_coverage_conflict",
  "study_coverage_uncovered",
  "study_citation_mismatch",
  "not_in_requested_dialogue_scope",
]);

function stableIdentity(value: unknown, context: string, path: string): string {
  const identity = string(value, context, path);
  if (identity.length > 240 || identity.trim() !== identity || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(identity)) {
    fail(context, path, "must be a bounded path-free identity");
  }
  return identity;
}

function boundedText(value: unknown, context: string, path: string): string {
  const text = string(value, context, path);
  if (
    text.trim() !== text ||
    new TextEncoder().encode(text).byteLength > LANGUAGE_EXPLANATION_LIMITS.maxFacetTextBytes ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
  ) fail(context, path, "must be bounded, trimmed, printable text");
  return text;
}

function boundedCaptionText(value: unknown, context: string, path: string): string {
  const text = string(value, context, path);
  if (
    text.trim() !== text ||
    new TextEncoder().encode(text).byteLength > LANGUAGE_EXPLANATION_LIMITS.maxCaptionTextBytes ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
  ) fail(context, path, "must be caption-compatible bounded, trimmed, printable text");
  return text;
}

function validateCaptionIdentity(
  value: unknown,
  context: string,
  path: string,
): LanguageExplanationCaptionIdentity {
  const item = object(value, context, path);
  exact(item, ["jobId", "artifactId", "contentId", "receiptArtifactId", "receiptId", "receiptContentId"], context, path);
  return {
    jobId: stableIdentity(item.jobId, context, `${path}.jobId`),
    artifactId: stableIdentity(item.artifactId, context, `${path}.artifactId`),
    contentId: contentId(item.contentId, context, `${path}.contentId`),
    receiptArtifactId: stableIdentity(item.receiptArtifactId, context, `${path}.receiptArtifactId`),
    receiptId: stableIdentity(item.receiptId, context, `${path}.receiptId`),
    receiptContentId: contentId(item.receiptContentId, context, `${path}.receiptContentId`),
  };
}

function validateSelection(
  value: unknown,
  context: string,
  path: string,
): LanguageExplanationRequest["selection"] {
  const item = object(value, context, path);
  exact(item, ["side", "unit", "start", "end", "text"], context, path);
  const start = integer(item.start, context, `${path}.start`);
  const end = integer(item.end, context, `${path}.end`, 1);
  const text = boundedText(item.text, context, `${path}.text`);
  if (end <= start || end - start > LANGUAGE_EXPLANATION_LIMITS.maxSelectionCodePoints) {
    fail(context, path, "must contain one bounded non-empty code-point span");
  }
  if (Array.from(text).length !== end - start) {
    fail(context, `${path}.text`, "must contain exactly the selected code-point count");
  }
  return {
    side: oneOf(item.side, new Set(["source", "target"]), context, `${path}.side`),
    unit: literal(item.unit, "unicode_code_point", context, `${path}.unit`),
    start,
    end,
    text,
  };
}

function validateFacetKinds(value: unknown, context: string, path: string): LanguageExplanationFacetKind[] {
  const kinds = array(value, context, path).map((kind, index) =>
    oneOf<LanguageExplanationFacetKind>(kind, FACET_KINDS, context, `${path}[${index}]`));
  if (
    kinds.length === 0 || kinds.length > LANGUAGE_EXPLANATION_LIMITS.maxRequestedFacets ||
    new Set(kinds).size !== kinds.length
  ) fail(context, path, "must contain a bounded non-empty set of unique supported facets");
  return kinds;
}

export function assertLanguageExplanationRequest(value: unknown): LanguageExplanationRequest {
  const context = "Language-explanation request";
  const item = object(value, context, "request");
  exact(item, ["caption", "lineId", "selection", "facetKinds"], context, "request");
  return {
    caption: validateCaptionIdentity(item.caption, context, "request.caption"),
    lineId: stableIdentity(item.lineId, context, "request.lineId"),
    selection: validateSelection(item.selection, context, "request.selection"),
    facetKinds: validateFacetKinds(item.facetKinds, context, "request.facetKinds"),
  };
}

export function validateLanguageExplanationLimits(
  value: unknown,
  context: string,
  path: string,
): typeof LANGUAGE_EXPLANATION_LIMITS {
  const item = object(value, context, path);
  const keys = Object.keys(LANGUAGE_EXPLANATION_LIMITS) as Array<Extract<keyof typeof LANGUAGE_EXPLANATION_LIMITS, string>>;
  exact(item, keys, context, path);
  for (const key of keys) {
    const measured = integer(item[key], context, `${path}.${key}`, 1);
    if (measured !== LANGUAGE_EXPLANATION_LIMITS[key]) fail(context, `${path}.${key}`, "must equal the fixed host limit");
  }
  return LANGUAGE_EXPLANATION_LIMITS;
}

export function validateLanguageExplanationExecutorDescriptor(
  value: unknown,
  context: string,
  path: string,
): LanguageExplanationExecutorDescriptor {
  const item = object(value, context, path);
  exact(item, ["id", "version", "classification", "executionScope", "model", "promptContractContentId", "configurationContentId"], context, path);
  literal(item.version, "1", context, `${path}.version`);
  literal(item.executionScope, "current_run", context, `${path}.executionScope`);
  const id = oneOf<LanguageExplanationExecutorDescriptor["id"]>(item.id, new Set([
    "studio.unavailable-language-explanation-generator",
    "studio.deterministic-language-explanation-test-seam",
    "studio.openai-language-explanation-generator",
  ]), context, `${path}.id`);
  const classification = oneOf<LanguageExplanationExecutorDescriptor["classification"]>(item.classification, new Set([
    "unavailable", "deterministic_test", "real_model",
  ]), context, `${path}.classification`);
  const model = nullableString(item.model, context, `${path}.model`);
  const promptContractContentId = contentId(item.promptContractContentId, context, `${path}.promptContractContentId`);
  const configurationContentId = contentId(item.configurationContentId, context, `${path}.configurationContentId`);
  if (
    (classification === "unavailable" && (id !== "studio.unavailable-language-explanation-generator" || model !== null)) ||
    (classification === "deterministic_test" && (id !== "studio.deterministic-language-explanation-test-seam" || model !== "deterministic-test-model")) ||
    (classification === "real_model" && (id !== "studio.openai-language-explanation-generator" || model === null))
  ) fail(context, path, "executor identity, classification, and model must agree");
  if (model !== null && (model.trim() !== model || model.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(model))) {
    fail(context, `${path}.model`, "must be a bounded path-free model identity");
  }
  return {
    id,
    version: "1",
    classification,
    executionScope: "current_run",
    model,
    promptContractContentId,
    configurationContentId,
  } as LanguageExplanationExecutorDescriptor;
}

function validateTextSnapshot(
  value: unknown,
  language: "ko" | "en",
  context: string,
  path: string,
): LanguageExplanationTextSnapshot {
  const item = object(value, context, path);
  exact(item, ["language", "state", "text", "reasonCode"], context, path);
  literal(item.language, language, context, `${path}.language`);
  const state = oneOf<LanguageExplanationTextSnapshot["state"]>(item.state, new Set(["available", "withheld", "unavailable"]), context, `${path}.state`);
  if (state === "available") {
    if (item.reasonCode !== null) fail(context, `${path}.reasonCode`, "must be null for available text");
    return { language, state, text: boundedCaptionText(item.text, context, `${path}.text`), reasonCode: null };
  }
  if (item.text !== null) fail(context, `${path}.text`, "must be null when text is not available");
  return {
    language,
    state,
    text: null,
    reasonCode: oneOf(item.reasonCode, CAPTION_REASON_CODES, context, `${path}.reasonCode`),
  };
}

export function validateLanguageExplanationContextLine(
  value: unknown,
  context: string,
  path: string,
): LanguageExplanationContextLine {
  const item = object(value, context, path);
  exact(item, ["lineId", "startMs", "endMs", "source", "target"], context, path);
  const startMs = integer(item.startMs, context, `${path}.startMs`);
  const endMs = integer(item.endMs, context, `${path}.endMs`, 1);
  if (endMs <= startMs) fail(context, path, "must have a non-empty media range");
  return {
    lineId: stableIdentity(item.lineId, context, `${path}.lineId`),
    startMs,
    endMs,
    source: validateTextSnapshot(item.source, "ko", context, `${path}.source`),
    target: validateTextSnapshot(item.target, "en", context, `${path}.target`),
  };
}

function validateContextLines(value: unknown, context: string, path: string): LanguageExplanationContextLine[] {
  const lines = array(value, context, path).map((line, index) =>
    validateLanguageExplanationContextLine(line, context, `${path}[${index}]`));
  if (lines.length === 0 || lines.length > LANGUAGE_EXPLANATION_LIMITS.maxContextLines) {
    fail(context, path, "must contain a bounded non-empty context window");
  }
  if (new Set(lines.map((line) => line.lineId)).size !== lines.length) fail(context, path, "must not repeat line identities");
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].startMs < lines[index - 1].startMs) fail(context, path, "must be ordered by media time");
  }
  return lines;
}

export function validateLanguageExplanationGrant(
  value: unknown,
  context: string,
  path: string,
): LanguageExplanationGrant {
  const item = object(value, context, path);
  exact(item, ["schema", "grantId", "attempt", "runId", "requestFingerprint", "caption", "lineId", "selection", "facetKinds", "rightsScope", "disposition", "executor", "limits"], context, path);
  const attempt = integer(item.attempt, context, `${path}.attempt`);
  if (attempt >= LANGUAGE_EXPLANATION_LIMITS.maxAttemptsPerRequest) {
    fail(context, `${path}.attempt`, "must remain below the fixed retry ceiling");
  }
  return {
    schema: literal(item.schema, "studio.language-explanation.grant.v1", context, `${path}.schema`),
    grantId: stableIdentity(item.grantId, context, `${path}.grantId`),
    attempt,
    runId: stableIdentity(item.runId, context, `${path}.runId`),
    requestFingerprint: stableIdentity(item.requestFingerprint, context, `${path}.requestFingerprint`),
    caption: validateCaptionIdentity(item.caption, context, `${path}.caption`),
    lineId: stableIdentity(item.lineId, context, `${path}.lineId`),
    selection: validateSelection(item.selection, context, `${path}.selection`),
    facetKinds: validateFacetKinds(item.facetKinds, context, `${path}.facetKinds`),
    rightsScope: oneOf(item.rightsScope, new Set(["local_processing", "redistribution"]), context, `${path}.rightsScope`),
    disposition: literal(item.disposition, "private_apply_output", context, `${path}.disposition`),
    executor: validateLanguageExplanationExecutorDescriptor(item.executor, context, `${path}.executor`),
    limits: validateLanguageExplanationLimits(item.limits, context, `${path}.limits`),
  };
}

export function validateLanguageExplanationInputAuthority(
  value: unknown,
  context: string,
  path: string,
): LanguageExplanationInputAuthority {
  const item = object(value, context, path);
  exact(item, ["source", "study", "readiness", "approval", "caption", "line", "contextLines", "selection", "inputContextLineage"], context, path);
  const source = object(item.source, context, `${path}.source`);
  exact(source, ["artifactId", "contentId", "analysisRequestId", "rightsScope"], context, `${path}.source`);
  const study = object(item.study, context, `${path}.study`);
  exact(study, ["studyId", "artifactId", "contentId"], context, `${path}.study`);
  const approval = object(item.approval, context, `${path}.approval`);
  exact(approval, ["reviewId", "artifactId", "receiptId", "receiptContentId"], context, `${path}.approval`);
  const lineage = object(item.inputContextLineage, context, `${path}.inputContextLineage`);
  exact(lineage, ["claimIds", "citationIds", "semanticEvidenceArtifactIds", "semanticEvidenceReceiptIds"], context, `${path}.inputContextLineage`);
  const contextLines = validateContextLines(item.contextLines, context, `${path}.contextLines`);
  const line = validateLanguageExplanationContextLine(item.line, context, `${path}.line`);
  if (!contextLines.some((candidate) => JSON.stringify(candidate) === JSON.stringify(line))) {
    fail(context, `${path}.contextLines`, "must include the exact selected line snapshot");
  }
  const selection = validateSelection(item.selection, context, `${path}.selection`);
  const selectedSnapshot = selection.side === "source" ? line.source : line.target;
  if (
    selectedSnapshot.state !== "available" ||
    Array.from(selectedSnapshot.text).slice(selection.start, selection.end).join("") !== selection.text
  ) fail(context, `${path}.selection`, "must match an available exact span in the selected line snapshot");
  return {
    source: {
      artifactId: stableIdentity(source.artifactId, context, `${path}.source.artifactId`),
      contentId: contentId(source.contentId, context, `${path}.source.contentId`),
      analysisRequestId: stableIdentity(source.analysisRequestId, context, `${path}.source.analysisRequestId`),
      rightsScope: oneOf(source.rightsScope, new Set(["local_processing", "redistribution"]), context, `${path}.source.rightsScope`),
    },
    study: {
      studyId: stableIdentity(study.studyId, context, `${path}.study.studyId`),
      artifactId: stableIdentity(study.artifactId, context, `${path}.study.artifactId`),
      contentId: contentId(study.contentId, context, `${path}.study.contentId`),
    },
    readiness: validateStudyReadinessReceiptIdentity(item.readiness, context, `${path}.readiness`),
    approval: {
      reviewId: stableIdentity(approval.reviewId, context, `${path}.approval.reviewId`),
      artifactId: stableIdentity(approval.artifactId, context, `${path}.approval.artifactId`),
      receiptId: stableIdentity(approval.receiptId, context, `${path}.approval.receiptId`),
      receiptContentId: contentId(approval.receiptContentId, context, `${path}.approval.receiptContentId`),
    },
    caption: validateCaptionIdentity(item.caption, context, `${path}.caption`),
    line,
    contextLines,
    selection,
    inputContextLineage: {
      claimIds: uniqueStrings(lineage.claimIds, context, `${path}.inputContextLineage.claimIds`),
      citationIds: uniqueStrings(lineage.citationIds, context, `${path}.inputContextLineage.citationIds`),
      semanticEvidenceArtifactIds: uniqueStrings(lineage.semanticEvidenceArtifactIds, context, `${path}.inputContextLineage.semanticEvidenceArtifactIds`),
      semanticEvidenceReceiptIds: uniqueStrings(lineage.semanticEvidenceReceiptIds, context, `${path}.inputContextLineage.semanticEvidenceReceiptIds`),
    },
  };
}

function validateContent(kind: LanguageExplanationFacetKind, value: unknown, context: string, path: string): unknown {
  const item = object(value, context, path);
  if (kind === "meaning") {
    exact(item, ["sceneMeaning"], context, path);
    return { sceneMeaning: boundedText(item.sceneMeaning, context, `${path}.sceneMeaning`) };
  }
  if (kind === "word") {
    exact(item, ["form", "sense", "role"], context, path);
    return {
      form: boundedText(item.form, context, `${path}.form`),
      sense: boundedText(item.sense, context, `${path}.sense`),
      role: boundedText(item.role, context, `${path}.role`),
    };
  }
  if (kind === "phrase") {
    exact(item, ["form", "function"], context, path);
    return {
      form: boundedText(item.form, context, `${path}.form`),
      function: boundedText(item.function, context, `${path}.function`),
    };
  }
  if (kind === "grammar") {
    exact(item, ["construction", "explanation", "segments"], context, path);
    const segments = array(item.segments, context, `${path}.segments`).map((segment, index) => {
      const row = object(segment, context, `${path}.segments[${index}]`);
      exact(row, ["form", "role"], context, `${path}.segments[${index}]`);
      return {
        form: boundedText(row.form, context, `${path}.segments[${index}].form`),
        role: boundedText(row.role, context, `${path}.segments[${index}].role`),
      };
    });
    if (segments.length === 0 || segments.length > 16) fail(context, `${path}.segments`, "must contain 1 to 16 segments");
    return {
      construction: boundedText(item.construction, context, `${path}.construction`),
      explanation: boundedText(item.explanation, context, `${path}.explanation`),
      segments,
    };
  }
  exact(item, ["sourceChoice", "targetChoice", "rationale"], context, path);
  return {
    sourceChoice: boundedText(item.sourceChoice, context, `${path}.sourceChoice`),
    targetChoice: boundedText(item.targetChoice, context, `${path}.targetChoice`),
    rationale: boundedText(item.rationale, context, `${path}.rationale`),
  };
}

function generatedFacet(value: unknown, context: string, path: string): GeneratedLanguageExplanationFacet {
  const item = object(value, context, path);
  exact(item, ["kind", "availability", "reasonCode", "content"], context, path);
  const kind = oneOf<LanguageExplanationFacetKind>(item.kind, FACET_KINDS, context, `${path}.kind`);
  const availability = oneOf<GeneratedLanguageExplanationFacet["availability"]>(item.availability, new Set(["available", "withheld", "unavailable"]), context, `${path}.availability`);
  if (availability === "available") {
    if (item.reasonCode !== null) fail(context, `${path}.reasonCode`, "must be null for an available facet");
    return { kind, availability, reasonCode: null, content: validateContent(kind, item.content, context, `${path}.content`) } as GeneratedLanguageExplanationFacet;
  }
  if (item.content !== null) fail(context, `${path}.content`, "must be null for a missing facet");
  return {
    kind,
    availability,
    reasonCode: oneOf<MissingFacetReason>(item.reasonCode, MISSING_REASONS, context, `${path}.reasonCode`),
    content: null,
  };
}

export function validateGeneratedLanguageExplanationFacets(
  value: unknown,
  expectedKinds: readonly LanguageExplanationFacetKind[],
  context = "Language-explanation generator output",
  path = "output.facets",
): GeneratedLanguageExplanationFacet[] {
  const facets = array(value, context, path).map((facet, index) => generatedFacet(facet, context, `${path}[${index}]`));
  if (JSON.stringify(facets.map((facet) => facet.kind)) !== JSON.stringify(expectedKinds)) {
    fail(context, path, "must contain each requested facet exactly once and in request order");
  }
  return facets;
}

function validateStoredFacet(value: unknown, context: string, path: string): LanguageExplanationFacet {
  const item = object(value, context, path);
  exact(item, ["kind", "availability", "reasonCode", "content", "executionAuthority", "semanticReview", "grounding", "externalCitationIds"], context, path);
  literal(item.executionAuthority, "host_receipted", context, `${path}.executionAuthority`);
  literal(item.semanticReview, "not_reviewed", context, `${path}.semanticReview`);
  const generated = generatedFacet({ kind: item.kind, availability: item.availability, reasonCode: item.reasonCode, content: item.content }, context, path);
  const citations = array(item.externalCitationIds, context, `${path}.externalCitationIds`);
  if (citations.length !== 0) fail(context, `${path}.externalCitationIds`, "must remain empty in v1");
  if (generated.availability === "available") {
    literal(item.grounding, "caption_context_inference", context, `${path}.grounding`);
    return { ...generated, executionAuthority: "host_receipted", semanticReview: "not_reviewed", grounding: "caption_context_inference", externalCitationIds: [] } as LanguageExplanationFacet;
  }
  literal(item.grounding, "none", context, `${path}.grounding`);
  return { ...generated, executionAuthority: "host_receipted", semanticReview: "not_reviewed", grounding: "none", externalCitationIds: [] };
}

function validateNonClaims(value: unknown, context: string, path: string): typeof LANGUAGE_EXPLANATION_NON_CLAIMS {
  const claims = uniqueStrings(value, context, path);
  if (claims.length !== NON_CLAIMS.size || claims.some((claim) => !NON_CLAIMS.has(claim))) {
    fail(context, path, "must retain the complete closed explanation non-claim set");
  }
  return [...LANGUAGE_EXPLANATION_NON_CLAIMS];
}

function derivedResult(facets: readonly LanguageExplanationFacet[]): LanguageExplanationArtifact["result"] {
  const availableFacetCount = facets.filter((facet) => facet.availability === "available").length;
  const withheldFacetCount = facets.filter((facet) => facet.availability === "withheld").length;
  const unavailableFacetCount = facets.filter((facet) => facet.availability === "unavailable").length;
  return {
    status: availableFacetCount === facets.length ? "completed" : availableFacetCount > 0 ? "partial" : "unavailable",
    requestedFacetCount: facets.length,
    availableFacetCount,
    withheldFacetCount,
    unavailableFacetCount,
  };
}

export function validateLanguageExplanationArtifact(
  value: unknown,
  context = "Language-explanation artifact",
  path = "artifact",
): LanguageExplanationArtifact {
  const item = object(value, context, path);
  exact(item, ["schema", "jobId", "runId", "input", "grant", "executor", "facets", "result", "semanticReview", "rights", "nonClaims"], context, path);
  literal(item.schema, "studio.language-explanation.artifact.v1", context, `${path}.schema`);
  const jobId = stableIdentity(item.jobId, context, `${path}.jobId`);
  const runId = stableIdentity(item.runId, context, `${path}.runId`);
  const input = validateLanguageExplanationInputAuthority(item.input, context, `${path}.input`);
  const grant = validateLanguageExplanationGrant(item.grant, context, `${path}.grant`);
  const executor = validateLanguageExplanationExecutorDescriptor(item.executor, context, `${path}.executor`);
  const facets = array(item.facets, context, `${path}.facets`).map((facet, index) => validateStoredFacet(facet, context, `${path}.facets[${index}]`));
  if (JSON.stringify(facets.map((facet) => facet.kind)) !== JSON.stringify(grant.facetKinds)) fail(context, `${path}.facets`, "must match the granted facet order");
  const resultValue = object(item.result, context, `${path}.result`);
  exact(resultValue, ["status", "requestedFacetCount", "availableFacetCount", "withheldFacetCount", "unavailableFacetCount"], context, `${path}.result`);
  const result = {
    status: oneOf<LanguageExplanationArtifact["result"]["status"]>(resultValue.status, new Set(["completed", "partial", "unavailable"]), context, `${path}.result.status`),
    requestedFacetCount: integer(resultValue.requestedFacetCount, context, `${path}.result.requestedFacetCount`, 1),
    availableFacetCount: integer(resultValue.availableFacetCount, context, `${path}.result.availableFacetCount`),
    withheldFacetCount: integer(resultValue.withheldFacetCount, context, `${path}.result.withheldFacetCount`),
    unavailableFacetCount: integer(resultValue.unavailableFacetCount, context, `${path}.result.unavailableFacetCount`),
  };
  if (JSON.stringify(result) !== JSON.stringify(derivedResult(facets))) fail(context, `${path}.result`, "must be derived from facet availability");
  const review = object(item.semanticReview, context, `${path}.semanticReview`);
  exact(review, ["state", "receiptId"], context, `${path}.semanticReview`);
  literal(review.state, "not_reviewed", context, `${path}.semanticReview.state`);
  if (review.receiptId !== null) fail(context, `${path}.semanticReview.receiptId`, "must remain null without a review producer");
  const rights = object(item.rights, context, `${path}.rights`);
  exact(rights, ["sourceScope", "publication", "exportEligibility"], context, `${path}.rights`);
  const sourceScope = oneOf<LanguageExplanationArtifact["rights"]["sourceScope"]>(rights.sourceScope, new Set(["local_processing", "redistribution"]), context, `${path}.rights.sourceScope`);
  literal(rights.publication, "private", context, `${path}.rights.publication`);
  literal(rights.exportEligibility, "unavailable", context, `${path}.rights.exportEligibility`);
  if (
    jobId !== grant.grantId.replace(/^language-explanation-grant:/, "language-explanation:") ||
    runId !== grant.runId ||
    JSON.stringify(input.caption) !== JSON.stringify(grant.caption) ||
    input.line.lineId !== grant.lineId ||
    JSON.stringify(input.selection) !== JSON.stringify(grant.selection) ||
    JSON.stringify(executor) !== JSON.stringify(grant.executor) ||
    input.source.rightsScope !== grant.rightsScope || sourceScope !== grant.rightsScope
  ) fail(context, path, "artifact input, grant, executor, rights, and job identity must agree");
  if (input.selection.side === "target" && input.line.target.state !== "available") fail(context, `${path}.input.selection`, "cannot select unavailable target text");
  if (facets.some((facet) => facet.kind === "translation_choice" && facet.availability === "available") && input.line.target.state !== "available") {
    fail(context, `${path}.facets`, "translation choice cannot be available without target text");
  }
  if (facets.some((facet) => facet.reasonCode === "target_unavailable" &&
      (facet.kind !== "translation_choice" || input.line.target.state === "available"))) {
    fail(context, `${path}.facets`, "target-unavailable abstention requires a translation-choice facet with unavailable target text");
  }
  return {
    schema: "studio.language-explanation.artifact.v1",
    jobId,
    runId,
    input,
    grant,
    executor,
    facets,
    result,
    semanticReview: { state: "not_reviewed", receiptId: null },
    rights: { sourceScope, publication: "private", exportEligibility: "unavailable" },
    nonClaims: validateNonClaims(item.nonClaims, context, `${path}.nonClaims`),
  };
}

export function validateLanguageExplanationReceipt(
  value: unknown,
  context = "Language-explanation receipt",
  path = "receipt",
): LanguageExplanationReceipt {
  const item = object(value, context, path);
  exact(item, ["schema", "receiptId", "jobId", "grant", "input", "producer", "limits", "execution", "result", "nonClaims"], context, path);
  literal(item.schema, "studio.language-explanation.receipt.v1", context, `${path}.schema`);
  const receiptId = stableIdentity(item.receiptId, context, `${path}.receiptId`);
  const jobId = stableIdentity(item.jobId, context, `${path}.jobId`);
  const grant = validateLanguageExplanationGrant(item.grant, context, `${path}.grant`);
  const input = validateLanguageExplanationInputAuthority(item.input, context, `${path}.input`);
  const producer = object(item.producer, context, `${path}.producer`);
  exact(producer, ["id", "version", "policy", "executor"], context, `${path}.producer`);
  literal(producer.id, "studio.host-language-explanation", context, `${path}.producer.id`);
  literal(producer.version, "1", context, `${path}.producer.version`);
  literal(producer.policy, "verified_current_caption_private_apply_only", context, `${path}.producer.policy`);
  const executor = validateLanguageExplanationExecutorDescriptor(producer.executor, context, `${path}.producer.executor`);
  const execution = object(item.execution, context, `${path}.execution`);
  exact(execution, ["providerResponseId", "inputTokens", "outputTokens"], context, `${path}.execution`);
  const resultValue = object(item.result, context, `${path}.result`);
  exact(resultValue, ["status", "requestedFacetCount", "availableFacetCount", "withheldFacetCount", "unavailableFacetCount", "artifactId", "contentId", "bytes", "facets"], context, `${path}.result`);
  const facets = array(resultValue.facets, context, `${path}.result.facets`).map((facet, index) => {
    const row = object(facet, context, `${path}.result.facets[${index}]`);
    exact(row, ["kind", "availability", "reasonCode"], context, `${path}.result.facets[${index}]`);
    const availability = oneOf<LanguageExplanationFacet["availability"]>(row.availability, new Set(["available", "withheld", "unavailable"]), context, `${path}.result.facets[${index}].availability`);
    return {
      kind: oneOf<LanguageExplanationFacetKind>(row.kind, FACET_KINDS, context, `${path}.result.facets[${index}].kind`),
      availability,
      reasonCode: availability === "available" ? (row.reasonCode === null ? null : fail(context, `${path}.result.facets[${index}].reasonCode`, "must be null")) : oneOf<MissingFacetReason>(row.reasonCode, MISSING_REASONS, context, `${path}.result.facets[${index}].reasonCode`),
    };
  });
  if (JSON.stringify(facets.map((facet) => facet.kind)) !== JSON.stringify(grant.facetKinds)) fail(context, `${path}.result.facets`, "must match the granted facet order");
  const result = {
    status: oneOf<LanguageExplanationArtifact["result"]["status"]>(resultValue.status, new Set(["completed", "partial", "unavailable"]), context, `${path}.result.status`),
    requestedFacetCount: integer(resultValue.requestedFacetCount, context, `${path}.result.requestedFacetCount`, 1),
    availableFacetCount: integer(resultValue.availableFacetCount, context, `${path}.result.availableFacetCount`),
    withheldFacetCount: integer(resultValue.withheldFacetCount, context, `${path}.result.withheldFacetCount`),
    unavailableFacetCount: integer(resultValue.unavailableFacetCount, context, `${path}.result.unavailableFacetCount`),
    artifactId: stableIdentity(resultValue.artifactId, context, `${path}.result.artifactId`),
    contentId: contentId(resultValue.contentId, context, `${path}.result.contentId`),
    bytes: integer(resultValue.bytes, context, `${path}.result.bytes`, 1),
    facets,
  };
  const counts = {
    status: result.status,
    requestedFacetCount: result.requestedFacetCount,
    availableFacetCount: result.availableFacetCount,
    withheldFacetCount: result.withheldFacetCount,
    unavailableFacetCount: result.unavailableFacetCount,
  };
  const derived = derivedResult(facets.map((facet) => ({ ...facet, content: null, executionAuthority: "host_receipted", semanticReview: "not_reviewed", grounding: "none", externalCitationIds: [] })) as LanguageExplanationFacet[]);
  if (JSON.stringify(counts) !== JSON.stringify(derived)) fail(context, `${path}.result`, "must be derived from the facet summary");
  if (
    jobId !== grant.grantId.replace(/^language-explanation-grant:/, "language-explanation:") ||
    JSON.stringify(input.caption) !== JSON.stringify(grant.caption) ||
    input.line.lineId !== grant.lineId ||
    JSON.stringify(input.selection) !== JSON.stringify(grant.selection) ||
    JSON.stringify(executor) !== JSON.stringify(grant.executor)
  ) fail(context, path, "receipt input, grant, executor, and job identity must agree");
  return {
    schema: "studio.language-explanation.receipt.v1",
    receiptId,
    jobId,
    grant,
    input,
    producer: { id: "studio.host-language-explanation", version: "1", policy: "verified_current_caption_private_apply_only", executor },
    limits: validateLanguageExplanationLimits(item.limits, context, `${path}.limits`),
    execution: {
      providerResponseId: execution.providerResponseId === null
        ? null
        : stableIdentity(execution.providerResponseId, context, `${path}.execution.providerResponseId`),
      inputTokens: nullableInteger(execution.inputTokens, context, `${path}.execution.inputTokens`),
      outputTokens: nullableInteger(execution.outputTokens, context, `${path}.execution.outputTokens`),
    },
    result,
    nonClaims: validateNonClaims(item.nonClaims, context, `${path}.nonClaims`),
  };
}
