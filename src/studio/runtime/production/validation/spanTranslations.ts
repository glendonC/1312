import type {
  GeneratedSpanTranslation,
  SpanTranslationArtifact,
  SpanTranslationBody,
  SpanTranslationCaptionIdentity,
  SpanTranslationContextLine,
  SpanTranslationExecutorDescriptor,
  SpanTranslationGrant,
  SpanTranslationInputAuthority,
  SpanTranslationReceipt,
  SpanTranslationRequest,
} from "../model.ts";
import {
  SPAN_TRANSLATION_LIMITS,
  SPAN_TRANSLATION_NON_CLAIMS,
} from "../model.ts";
import { validateLanguageExplanationContextLine } from "./languageExplanations.ts";
import { validateStudyReadinessReceiptIdentity } from "./publishReview.ts";
import {
  array,
  contentId,
  exact,
  fail,
  integer,
  literal,
  nullableInteger,
  object,
  oneOf,
  string,
  uniqueStrings,
} from "./primitives.ts";

type MissingTranslationReason = Exclude<SpanTranslationBody["reasonCode"], null>;

const MISSING_REASONS = new Set<MissingTranslationReason>([
  "generator_abstained",
  "insufficient_caption_context",
]);
const NON_CLAIMS = new Set<string>(SPAN_TRANSLATION_NON_CLAIMS);

function stableIdentity(value: unknown, context: string, path: string): string {
  const identity = string(value, context, path);
  if (identity.length > 240 || identity.trim() !== identity || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(identity)) {
    fail(context, path, "must be a bounded path-free identity");
  }
  return identity;
}

function boundedTranslationText(value: unknown, context: string, path: string): string {
  const text = string(value, context, path);
  if (
    text.trim() !== text || text.length === 0 ||
    new TextEncoder().encode(text).byteLength > SPAN_TRANSLATION_LIMITS.maxTranslationTextBytes ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
  ) fail(context, path, "must be bounded, trimmed, printable text");
  return text;
}

function validateCaptionIdentity(
  value: unknown,
  context: string,
  path: string,
): SpanTranslationCaptionIdentity {
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
): SpanTranslationRequest["selection"] {
  const item = object(value, context, path);
  exact(item, ["side", "unit", "start", "end", "text"], context, path);
  const start = integer(item.start, context, `${path}.start`);
  const end = integer(item.end, context, `${path}.end`, 1);
  const text = string(item.text, context, `${path}.text`);
  if (
    text.trim() !== text || text.length === 0 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
  ) fail(context, `${path}.text`, "must be trimmed printable selected text");
  if (end <= start || end - start > SPAN_TRANSLATION_LIMITS.maxSelectionCodePoints) {
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

export function assertSpanTranslationRequest(value: unknown): SpanTranslationRequest {
  const context = "Span-translation request";
  const item = object(value, context, "request");
  exact(item, ["caption", "lineId", "selection"], context, "request");
  return {
    caption: validateCaptionIdentity(item.caption, context, "request.caption"),
    lineId: stableIdentity(item.lineId, context, "request.lineId"),
    selection: validateSelection(item.selection, context, "request.selection"),
  };
}

export function validateSpanTranslationLimits(
  value: unknown,
  context: string,
  path: string,
): typeof SPAN_TRANSLATION_LIMITS {
  const item = object(value, context, path);
  const keys = Object.keys(SPAN_TRANSLATION_LIMITS) as Array<Extract<keyof typeof SPAN_TRANSLATION_LIMITS, string>>;
  exact(item, keys, context, path);
  for (const key of keys) {
    const measured = integer(item[key], context, `${path}.${key}`, 1);
    if (measured !== SPAN_TRANSLATION_LIMITS[key]) fail(context, `${path}.${key}`, "must equal the fixed host limit");
  }
  return SPAN_TRANSLATION_LIMITS;
}

export function validateSpanTranslationExecutorDescriptor(
  value: unknown,
  context: string,
  path: string,
): SpanTranslationExecutorDescriptor {
  const item = object(value, context, path);
  exact(item, ["id", "version", "classification", "executionScope", "model", "promptContractContentId", "configurationContentId"], context, path);
  literal(item.version, "1", context, `${path}.version`);
  literal(item.executionScope, "current_run", context, `${path}.executionScope`);
  const id = oneOf<SpanTranslationExecutorDescriptor["id"]>(item.id, new Set([
    "studio.unavailable-span-translation-generator",
    "studio.deterministic-span-translation-test-seam",
    "studio.ollama-span-translation-generator",
  ]), context, `${path}.id`);
  const classification = oneOf<SpanTranslationExecutorDescriptor["classification"]>(item.classification, new Set([
    "unavailable", "deterministic_test", "real_model",
  ]), context, `${path}.classification`);
  const model = item.model === null ? null : string(item.model, context, `${path}.model`);
  const promptContractContentId = contentId(item.promptContractContentId, context, `${path}.promptContractContentId`);
  const configurationContentId = contentId(item.configurationContentId, context, `${path}.configurationContentId`);
  if (
    (classification === "unavailable" && (id !== "studio.unavailable-span-translation-generator" || model !== null)) ||
    (classification === "deterministic_test" && (id !== "studio.deterministic-span-translation-test-seam" || model !== "deterministic-test-model")) ||
    (classification === "real_model" && (id !== "studio.ollama-span-translation-generator" || model === null))
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
  } as SpanTranslationExecutorDescriptor;
}

function validateContextLines(value: unknown, context: string, path: string): SpanTranslationContextLine[] {
  const lines = array(value, context, path).map((line, index) =>
    validateLanguageExplanationContextLine(line, context, `${path}[${index}]`));
  if (lines.length === 0 || lines.length > SPAN_TRANSLATION_LIMITS.maxContextLines) {
    fail(context, path, "must contain a bounded non-empty context window");
  }
  if (new Set(lines.map((line) => line.lineId)).size !== lines.length) fail(context, path, "must not repeat line identities");
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].startMs < lines[index - 1].startMs) fail(context, path, "must be ordered by media time");
  }
  return lines;
}

export function validateSpanTranslationGrant(
  value: unknown,
  context: string,
  path: string,
): SpanTranslationGrant {
  const item = object(value, context, path);
  exact(item, ["schema", "grantId", "attempt", "runId", "requestFingerprint", "caption", "lineId", "selection", "rightsScope", "disposition", "executor", "limits"], context, path);
  const attempt = integer(item.attempt, context, `${path}.attempt`);
  if (attempt >= SPAN_TRANSLATION_LIMITS.maxAttemptsPerRequest) {
    fail(context, `${path}.attempt`, "must remain below the fixed retry ceiling");
  }
  return {
    schema: literal(item.schema, "studio.span-translation.grant.v1", context, `${path}.schema`),
    grantId: stableIdentity(item.grantId, context, `${path}.grantId`),
    attempt,
    runId: stableIdentity(item.runId, context, `${path}.runId`),
    requestFingerprint: stableIdentity(item.requestFingerprint, context, `${path}.requestFingerprint`),
    caption: validateCaptionIdentity(item.caption, context, `${path}.caption`),
    lineId: stableIdentity(item.lineId, context, `${path}.lineId`),
    selection: validateSelection(item.selection, context, `${path}.selection`),
    rightsScope: oneOf(item.rightsScope, new Set(["local_processing", "redistribution"]), context, `${path}.rightsScope`),
    disposition: literal(item.disposition, "private_apply_output", context, `${path}.disposition`),
    executor: validateSpanTranslationExecutorDescriptor(item.executor, context, `${path}.executor`),
    limits: validateSpanTranslationLimits(item.limits, context, `${path}.limits`),
  };
}

export function validateSpanTranslationInputAuthority(
  value: unknown,
  context: string,
  path: string,
): SpanTranslationInputAuthority {
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

export function validateGeneratedSpanTranslation(
  value: unknown,
  context = "Span-translation generator output",
  path = "output.translation",
): GeneratedSpanTranslation {
  const item = object(value, context, path);
  exact(item, ["availability", "reasonCode", "text"], context, path);
  const availability = oneOf<GeneratedSpanTranslation["availability"]>(item.availability, new Set(["available", "withheld", "unavailable"]), context, `${path}.availability`);
  if (availability === "available") {
    if (item.reasonCode !== null) fail(context, `${path}.reasonCode`, "must be null for an available translation");
    return { availability, reasonCode: null, text: boundedTranslationText(item.text, context, `${path}.text`) };
  }
  if (item.text !== null) fail(context, `${path}.text`, "must be null for a missing translation");
  return {
    availability,
    reasonCode: oneOf<MissingTranslationReason>(item.reasonCode, MISSING_REASONS, context, `${path}.reasonCode`),
    text: null,
  };
}

function validateStoredTranslation(
  value: unknown,
  expectedLanguage: "ko" | "en",
  context: string,
  path: string,
): SpanTranslationBody {
  const item = object(value, context, path);
  exact(item, ["language", "availability", "reasonCode", "text", "executionAuthority", "semanticReview", "grounding", "externalCitationIds"], context, path);
  literal(item.language, expectedLanguage, context, `${path}.language`);
  literal(item.executionAuthority, "host_receipted", context, `${path}.executionAuthority`);
  literal(item.semanticReview, "not_reviewed", context, `${path}.semanticReview`);
  const generated = validateGeneratedSpanTranslation(
    { availability: item.availability, reasonCode: item.reasonCode, text: item.text },
    context,
    path,
  );
  const citations = array(item.externalCitationIds, context, `${path}.externalCitationIds`);
  if (citations.length !== 0) fail(context, `${path}.externalCitationIds`, "must remain empty in v1");
  if (generated.availability === "available") {
    literal(item.grounding, "caption_context_inference", context, `${path}.grounding`);
    return {
      language: expectedLanguage,
      ...generated,
      executionAuthority: "host_receipted",
      semanticReview: "not_reviewed",
      grounding: "caption_context_inference",
      externalCitationIds: [],
    };
  }
  literal(item.grounding, "none", context, `${path}.grounding`);
  return {
    language: expectedLanguage,
    ...generated,
    executionAuthority: "host_receipted",
    semanticReview: "not_reviewed",
    grounding: "none",
    externalCitationIds: [],
  };
}

function validateNonClaims(value: unknown, context: string, path: string): typeof SPAN_TRANSLATION_NON_CLAIMS {
  const claims = uniqueStrings(value, context, path);
  if (claims.length !== NON_CLAIMS.size || claims.some((claim) => !NON_CLAIMS.has(claim))) {
    fail(context, path, "must retain the complete closed span-translation non-claim set");
  }
  return [...SPAN_TRANSLATION_NON_CLAIMS];
}

export function spanTranslationTargetLanguage(side: "source" | "target"): "ko" | "en" {
  return side === "source" ? "en" : "ko";
}

function derivedStatus(availability: SpanTranslationBody["availability"]): SpanTranslationArtifact["result"]["status"] {
  return availability === "available" ? "completed" : availability;
}

export function validateSpanTranslationArtifact(
  value: unknown,
  context = "Span-translation artifact",
  path = "artifact",
): SpanTranslationArtifact {
  const item = object(value, context, path);
  exact(item, ["schema", "jobId", "runId", "input", "grant", "executor", "translation", "result", "semanticReview", "rights", "nonClaims"], context, path);
  literal(item.schema, "studio.span-translation.artifact.v1", context, `${path}.schema`);
  const jobId = stableIdentity(item.jobId, context, `${path}.jobId`);
  const runId = stableIdentity(item.runId, context, `${path}.runId`);
  const input = validateSpanTranslationInputAuthority(item.input, context, `${path}.input`);
  const grant = validateSpanTranslationGrant(item.grant, context, `${path}.grant`);
  const executor = validateSpanTranslationExecutorDescriptor(item.executor, context, `${path}.executor`);
  const translation = validateStoredTranslation(
    item.translation,
    spanTranslationTargetLanguage(input.selection.side),
    context,
    `${path}.translation`,
  );
  const resultValue = object(item.result, context, `${path}.result`);
  exact(resultValue, ["status"], context, `${path}.result`);
  const status = oneOf<SpanTranslationArtifact["result"]["status"]>(resultValue.status, new Set(["completed", "withheld", "unavailable"]), context, `${path}.result.status`);
  if (status !== derivedStatus(translation.availability)) {
    fail(context, `${path}.result`, "must be derived from translation availability");
  }
  const review = object(item.semanticReview, context, `${path}.semanticReview`);
  exact(review, ["state", "receiptId"], context, `${path}.semanticReview`);
  literal(review.state, "not_reviewed", context, `${path}.semanticReview.state`);
  if (review.receiptId !== null) fail(context, `${path}.semanticReview.receiptId`, "must remain null without a review producer");
  const rights = object(item.rights, context, `${path}.rights`);
  exact(rights, ["sourceScope", "publication", "exportEligibility"], context, `${path}.rights`);
  const sourceScope = oneOf<SpanTranslationArtifact["rights"]["sourceScope"]>(rights.sourceScope, new Set(["local_processing", "redistribution"]), context, `${path}.rights.sourceScope`);
  literal(rights.publication, "private", context, `${path}.rights.publication`);
  literal(rights.exportEligibility, "unavailable", context, `${path}.rights.exportEligibility`);
  if (
    jobId !== grant.grantId.replace(/^span-translation-grant:/, "span-translation:") ||
    runId !== grant.runId ||
    JSON.stringify(input.caption) !== JSON.stringify(grant.caption) ||
    input.line.lineId !== grant.lineId ||
    JSON.stringify(input.selection) !== JSON.stringify(grant.selection) ||
    JSON.stringify(executor) !== JSON.stringify(grant.executor) ||
    input.source.rightsScope !== grant.rightsScope || sourceScope !== grant.rightsScope
  ) fail(context, path, "artifact input, grant, executor, rights, and job identity must agree");
  return {
    schema: "studio.span-translation.artifact.v1",
    jobId,
    runId,
    input,
    grant,
    executor,
    translation,
    result: { status },
    semanticReview: { state: "not_reviewed", receiptId: null },
    rights: { sourceScope, publication: "private", exportEligibility: "unavailable" },
    nonClaims: validateNonClaims(item.nonClaims, context, `${path}.nonClaims`),
  };
}

export function validateSpanTranslationReceipt(
  value: unknown,
  context = "Span-translation receipt",
  path = "receipt",
): SpanTranslationReceipt {
  const item = object(value, context, path);
  exact(item, ["schema", "receiptId", "jobId", "grant", "input", "producer", "limits", "execution", "result", "nonClaims"], context, path);
  literal(item.schema, "studio.span-translation.receipt.v1", context, `${path}.schema`);
  const receiptId = stableIdentity(item.receiptId, context, `${path}.receiptId`);
  const jobId = stableIdentity(item.jobId, context, `${path}.jobId`);
  const grant = validateSpanTranslationGrant(item.grant, context, `${path}.grant`);
  const input = validateSpanTranslationInputAuthority(item.input, context, `${path}.input`);
  const producer = object(item.producer, context, `${path}.producer`);
  exact(producer, ["id", "version", "policy", "executor"], context, `${path}.producer`);
  literal(producer.id, "studio.host-span-translation", context, `${path}.producer.id`);
  literal(producer.version, "1", context, `${path}.producer.version`);
  literal(producer.policy, "verified_current_caption_private_apply_only", context, `${path}.producer.policy`);
  const executor = validateSpanTranslationExecutorDescriptor(producer.executor, context, `${path}.producer.executor`);
  const execution = object(item.execution, context, `${path}.execution`);
  exact(execution, ["providerResponseId", "inputTokens", "outputTokens"], context, `${path}.execution`);
  const resultValue = object(item.result, context, `${path}.result`);
  exact(resultValue, ["status", "availability", "reasonCode", "artifactId", "contentId", "bytes"], context, `${path}.result`);
  const availability = oneOf<SpanTranslationBody["availability"]>(resultValue.availability, new Set(["available", "withheld", "unavailable"]), context, `${path}.result.availability`);
  const reasonCode = availability === "available"
    ? (resultValue.reasonCode === null ? null : fail(context, `${path}.result.reasonCode`, "must be null"))
    : oneOf<MissingTranslationReason>(resultValue.reasonCode, MISSING_REASONS, context, `${path}.result.reasonCode`);
  const status = oneOf<SpanTranslationArtifact["result"]["status"]>(resultValue.status, new Set(["completed", "withheld", "unavailable"]), context, `${path}.result.status`);
  if (status !== derivedStatus(availability)) fail(context, `${path}.result`, "must be derived from the translation availability");
  if (
    jobId !== grant.grantId.replace(/^span-translation-grant:/, "span-translation:") ||
    JSON.stringify(input.caption) !== JSON.stringify(grant.caption) ||
    input.line.lineId !== grant.lineId ||
    JSON.stringify(input.selection) !== JSON.stringify(grant.selection) ||
    JSON.stringify(executor) !== JSON.stringify(grant.executor)
  ) fail(context, path, "receipt input, grant, executor, and job identity must agree");
  return {
    schema: "studio.span-translation.receipt.v1",
    receiptId,
    jobId,
    grant,
    input,
    producer: { id: "studio.host-span-translation", version: "1", policy: "verified_current_caption_private_apply_only", executor },
    limits: validateSpanTranslationLimits(item.limits, context, `${path}.limits`),
    execution: {
      providerResponseId: execution.providerResponseId === null
        ? null
        : stableIdentity(execution.providerResponseId, context, `${path}.execution.providerResponseId`),
      inputTokens: nullableInteger(execution.inputTokens, context, `${path}.execution.inputTokens`),
      outputTokens: nullableInteger(execution.outputTokens, context, `${path}.execution.outputTokens`),
    },
    result: {
      status,
      availability,
      reasonCode,
      artifactId: stableIdentity(resultValue.artifactId, context, `${path}.result.artifactId`),
      contentId: contentId(resultValue.contentId, context, `${path}.result.contentId`),
      bytes: integer(resultValue.bytes, context, `${path}.result.bytes`, 1),
    },
    nonClaims: validateNonClaims(item.nonClaims, context, `${path}.nonClaims`),
  };
}
