import type {
  GeneratedLearningPrepCandidate,
  GeneratedLearningPrepOutput,
  LearningFineTune,
  LearningPrepArtifact,
  LearningPrepCandidate,
  LearningPrepCandidateMissingReasonCode,
  LearningPrepCaptionIdentity,
  LearningPrepContextLine,
  LearningPrepExecutorDescriptor,
  LearningPrepGrant,
  LearningPrepInputAuthority,
  LearningPrepLensAbstentionReasonCode,
  LearningPrepLensKind,
  LearningPrepLensOutcome,
  LearningPrepReceipt,
  LearningPrepRequest,
  LearningPrepSegmentation,
} from "../model.ts";
import {
  LEARNING_PREP_LENS_KINDS,
  LEARNING_PREP_LIMITS,
  LEARNING_PREP_NON_CLAIMS,
  LEARNING_PREP_TEMPERATURES,
  LEARNING_PREP_TEMPERATURE_CEILINGS,
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
  nullableString,
  object,
  oneOf,
  string,
  uniqueStrings,
} from "./primitives.ts";

const LENS_KINDS = new Set<string>(LEARNING_PREP_LENS_KINDS);
const TEMPERATURES = new Set<string>(LEARNING_PREP_TEMPERATURES);
const CANDIDATE_MISSING_REASONS = new Set<LearningPrepCandidateMissingReasonCode>([
  "generator_abstained",
  "insufficient_caption_context",
  "external_grounding_unavailable",
]);
const LENS_ABSTENTION_REASONS = new Set<LearningPrepLensAbstentionReasonCode>([
  "generator_abstained",
  "insufficient_caption_context",
  "no_reference_detected",
]);
const WATCH_THROUGH_REASONS = new Set<
  Extract<LearningPrepSegmentation, { mode: "watch_through" }>["reasonCode"]
>(["no_beat_boundaries_warranted", "insufficient_caption_context"]);
const NON_CLAIMS = new Set<string>(LEARNING_PREP_NON_CLAIMS);

function stableIdentity(value: unknown, context: string, path: string): string {
  const identity = string(value, context, path);
  if (identity.length > 240 || identity.trim() !== identity || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(identity)) {
    fail(context, path, "must be a bounded path-free identity");
  }
  return identity;
}

function boundedCandidateText(value: unknown, context: string, path: string): string {
  const text = string(value, context, path);
  if (
    text.trim() !== text ||
    new TextEncoder().encode(text).byteLength > LEARNING_PREP_LIMITS.maxCandidateTextBytes ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
  ) fail(context, path, "must be bounded, trimmed, printable text");
  return text;
}

function validateCaptionIdentity(
  value: unknown,
  context: string,
  path: string,
): LearningPrepCaptionIdentity {
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

export function validateLearningFineTune(
  value: unknown,
  context: string,
  path: string,
): LearningFineTune {
  const item = object(value, context, path);
  exact(item, ["schema", "armedLenses", "temperature"], context, path);
  const armedLenses = array(item.armedLenses, context, `${path}.armedLenses`).map((lens, index) =>
    oneOf<LearningPrepLensKind>(lens, LENS_KINDS, context, `${path}.armedLenses[${index}]`));
  if (
    armedLenses.length === 0 || armedLenses.length > LEARNING_PREP_LIMITS.maxArmedLenses ||
    new Set(armedLenses).size !== armedLenses.length
  ) fail(context, `${path}.armedLenses`, "must arm a bounded non-empty set of unique supported lenses");
  return {
    schema: literal(item.schema, "studio.learning-fine-tune.v1", context, `${path}.schema`),
    armedLenses,
    temperature: oneOf(item.temperature, TEMPERATURES, context, `${path}.temperature`),
  };
}

export function assertLearningPrepRequest(value: unknown): LearningPrepRequest {
  const context = "Learning-prep request";
  const item = object(value, context, "request");
  exact(item, ["caption", "fineTune"], context, "request");
  return {
    caption: validateCaptionIdentity(item.caption, context, "request.caption"),
    fineTune: validateLearningFineTune(item.fineTune, context, "request.fineTune"),
  };
}

export function validateLearningPrepLimits(
  value: unknown,
  context: string,
  path: string,
): typeof LEARNING_PREP_LIMITS {
  const item = object(value, context, path);
  const keys = Object.keys(LEARNING_PREP_LIMITS) as Array<Extract<keyof typeof LEARNING_PREP_LIMITS, string>>;
  exact(item, keys, context, path);
  for (const key of keys) {
    const measured = integer(item[key], context, `${path}.${key}`, 1);
    if (measured !== LEARNING_PREP_LIMITS[key]) fail(context, `${path}.${key}`, "must equal the fixed host limit");
  }
  return LEARNING_PREP_LIMITS;
}

export function validateLearningPrepExecutorDescriptor(
  value: unknown,
  context: string,
  path: string,
): LearningPrepExecutorDescriptor {
  const item = object(value, context, path);
  exact(item, ["id", "version", "classification", "executionScope", "model", "promptContractContentId", "configurationContentId"], context, path);
  literal(item.version, "1", context, `${path}.version`);
  literal(item.executionScope, "current_run", context, `${path}.executionScope`);
  const id = oneOf<LearningPrepExecutorDescriptor["id"]>(item.id, new Set([
    "studio.unavailable-learning-prep-generator",
    "studio.deterministic-learning-prep-test-seam",
    "studio.openai-learning-prep-generator",
  ]), context, `${path}.id`);
  const classification = oneOf<LearningPrepExecutorDescriptor["classification"]>(item.classification, new Set([
    "unavailable", "deterministic_test", "real_model",
  ]), context, `${path}.classification`);
  const model = nullableString(item.model, context, `${path}.model`);
  const promptContractContentId = contentId(item.promptContractContentId, context, `${path}.promptContractContentId`);
  const configurationContentId = contentId(item.configurationContentId, context, `${path}.configurationContentId`);
  if (
    (classification === "unavailable" && (id !== "studio.unavailable-learning-prep-generator" || model !== null)) ||
    (classification === "deterministic_test" && (id !== "studio.deterministic-learning-prep-test-seam" || model !== "deterministic-test-model")) ||
    (classification === "real_model" && (id !== "studio.openai-learning-prep-generator" || model === null))
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
  } as LearningPrepExecutorDescriptor;
}

export function validateLearningPrepContextLines(
  value: unknown,
  context: string,
  path: string,
): LearningPrepContextLine[] {
  const lines = array(value, context, path).map((line, index) =>
    validateLanguageExplanationContextLine(line, context, `${path}[${index}]`));
  if (lines.length === 0 || lines.length > LEARNING_PREP_LIMITS.maxLines) {
    fail(context, path, "must contain a bounded non-empty caption line snapshot");
  }
  if (new Set(lines.map((line) => line.lineId)).size !== lines.length) fail(context, path, "must not repeat line identities");
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].startMs < lines[index - 1].startMs) fail(context, path, "must be ordered by media time");
  }
  return lines;
}

export function validateLearningPrepGrant(
  value: unknown,
  context: string,
  path: string,
): LearningPrepGrant {
  const item = object(value, context, path);
  exact(item, ["schema", "grantId", "attempt", "runId", "requestFingerprint", "caption", "fineTune", "rightsScope", "disposition", "executor", "limits"], context, path);
  const attempt = integer(item.attempt, context, `${path}.attempt`);
  if (attempt >= LEARNING_PREP_LIMITS.maxAttemptsPerRequest) {
    fail(context, `${path}.attempt`, "must remain below the fixed retry ceiling");
  }
  return {
    schema: literal(item.schema, "studio.learning-prep.grant.v1", context, `${path}.schema`),
    grantId: stableIdentity(item.grantId, context, `${path}.grantId`),
    attempt,
    runId: stableIdentity(item.runId, context, `${path}.runId`),
    requestFingerprint: stableIdentity(item.requestFingerprint, context, `${path}.requestFingerprint`),
    caption: validateCaptionIdentity(item.caption, context, `${path}.caption`),
    fineTune: validateLearningFineTune(item.fineTune, context, `${path}.fineTune`),
    rightsScope: oneOf(item.rightsScope, new Set(["local_processing", "redistribution"]), context, `${path}.rightsScope`),
    disposition: literal(item.disposition, "private_apply_output", context, `${path}.disposition`),
    executor: validateLearningPrepExecutorDescriptor(item.executor, context, `${path}.executor`),
    limits: validateLearningPrepLimits(item.limits, context, `${path}.limits`),
  };
}

export function validateLearningPrepInputAuthority(
  value: unknown,
  context: string,
  path: string,
): LearningPrepInputAuthority {
  const item = object(value, context, path);
  exact(item, ["source", "study", "readiness", "approval", "caption", "lines"], context, path);
  const source = object(item.source, context, `${path}.source`);
  exact(source, ["artifactId", "contentId", "analysisRequestId", "rightsScope"], context, `${path}.source`);
  const study = object(item.study, context, `${path}.study`);
  exact(study, ["studyId", "artifactId", "contentId"], context, `${path}.study`);
  const approval = object(item.approval, context, `${path}.approval`);
  exact(approval, ["reviewId", "artifactId", "receiptId", "receiptContentId"], context, `${path}.approval`);
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
    lines: validateLearningPrepContextLines(item.lines, context, `${path}.lines`),
  };
}

function validateCandidateContent(
  lens: LearningPrepLensKind,
  value: unknown,
  context: string,
  path: string,
): unknown {
  const item = object(value, context, path);
  if (lens === "word_order") {
    exact(item, ["sourcePhrase", "targetPhrase", "note"], context, path);
    return {
      sourcePhrase: boundedCandidateText(item.sourcePhrase, context, `${path}.sourcePhrase`),
      targetPhrase: boundedCandidateText(item.targetPhrase, context, `${path}.targetPhrase`),
      note: boundedCandidateText(item.note, context, `${path}.note`),
    };
  }
  if (lens === "grammar_salience") {
    exact(item, ["construction", "note"], context, path);
    return {
      construction: boundedCandidateText(item.construction, context, `${path}.construction`),
      note: boundedCandidateText(item.note, context, `${path}.note`),
    };
  }
  if (lens === "situating") {
    exact(item, ["situation"], context, path);
    return { situation: boundedCandidateText(item.situation, context, `${path}.situation`) };
  }
  exact(item, ["referent", "note"], context, path);
  return {
    referent: boundedCandidateText(item.referent, context, `${path}.referent`),
    note: boundedCandidateText(item.note, context, `${path}.note`),
  };
}

function generatedCandidate(value: unknown, context: string, path: string): GeneratedLearningPrepCandidate {
  const item = object(value, context, path);
  exact(item, ["lens", "lineId", "availability", "reasonCode", "content"], context, path);
  const lens = oneOf<LearningPrepLensKind>(item.lens, LENS_KINDS, context, `${path}.lens`);
  const lineId = stableIdentity(item.lineId, context, `${path}.lineId`);
  const availability = oneOf<GeneratedLearningPrepCandidate["availability"]>(item.availability, new Set(["available", "withheld", "unavailable"]), context, `${path}.availability`);
  if (availability === "available") {
    if (item.reasonCode !== null) fail(context, `${path}.reasonCode`, "must be null for an available candidate");
    return {
      lens,
      lineId,
      availability,
      reasonCode: null,
      content: validateCandidateContent(lens, item.content, context, `${path}.content`),
    } as GeneratedLearningPrepCandidate;
  }
  if (item.content !== null) fail(context, `${path}.content`, "must be null for a missing candidate");
  return {
    lens,
    lineId,
    availability,
    reasonCode: oneOf(item.reasonCode, CANDIDATE_MISSING_REASONS, context, `${path}.reasonCode`),
    content: null,
  };
}

function beatIndexByLine(
  segmentation: { mode: "beats"; beats: Array<{ lineIds: string[] }> } | { mode: "watch_through" },
  lineId: string,
): string {
  if (segmentation.mode === "watch_through") return `line:${lineId}`;
  const index = segmentation.beats.findIndex((beat) => beat.lineIds.includes(lineId));
  return `beat:${index}`;
}

export function validateGeneratedLearningPrepOutput(
  value: unknown,
  fineTune: LearningFineTune,
  lines: readonly LearningPrepContextLine[],
  context = "Learning-prep generator output",
  path = "output",
): GeneratedLearningPrepOutput {
  const item = object(value, context, path);
  exact(item, ["segmentation", "candidates", "lensAbstentions"], context, path);

  const segmentationItem = object(item.segmentation, context, `${path}.segmentation`);
  let segmentation: GeneratedLearningPrepOutput["segmentation"];
  const mode = oneOf<"beats" | "watch_through">(segmentationItem.mode, new Set(["beats", "watch_through"]), context, `${path}.segmentation.mode`);
  if (mode === "beats") {
    exact(segmentationItem, ["mode", "beats"], context, `${path}.segmentation`);
    const beats = array(segmentationItem.beats, context, `${path}.segmentation.beats`).map((beat, index) => {
      const row = object(beat, context, `${path}.segmentation.beats[${index}]`);
      exact(row, ["lineIds"], context, `${path}.segmentation.beats[${index}]`);
      const lineIds = uniqueStrings(row.lineIds, context, `${path}.segmentation.beats[${index}].lineIds`);
      if (lineIds.length === 0) fail(context, `${path}.segmentation.beats[${index}].lineIds`, "must contain at least one line");
      return { lineIds };
    });
    if (beats.length === 0 || beats.length > LEARNING_PREP_LIMITS.maxBeats) {
      fail(context, `${path}.segmentation.beats`, "must contain a bounded non-empty beat list");
    }
    const flattened = beats.flatMap((beat) => beat.lineIds);
    if (JSON.stringify(flattened) !== JSON.stringify(lines.map((line) => line.lineId))) {
      fail(context, `${path}.segmentation.beats`, "must partition every caption line contiguously, completely, and in order");
    }
    segmentation = { mode: "beats", beats };
  } else {
    exact(segmentationItem, ["mode", "reasonCode"], context, `${path}.segmentation`);
    segmentation = {
      mode: "watch_through",
      reasonCode: oneOf(segmentationItem.reasonCode, WATCH_THROUGH_REASONS, context, `${path}.segmentation.reasonCode`),
    };
  }

  const lineIndexById = new Map(lines.map((line, index) => [line.lineId, index]));
  const lensOrder = new Map(fineTune.armedLenses.map((lens, index) => [lens, index]));
  const candidates = array(item.candidates, context, `${path}.candidates`).map((candidate, index) =>
    generatedCandidate(candidate, context, `${path}.candidates[${index}]`));
  if (candidates.length > LEARNING_PREP_LIMITS.maxCandidates) {
    fail(context, `${path}.candidates`, "must remain below the fixed candidate ceiling");
  }
  const seen = new Set<string>();
  let previousOrder = -1;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const candidatePath = `${path}.candidates[${index}]`;
    if (!lensOrder.has(candidate.lens)) fail(context, `${candidatePath}.lens`, "must be an armed lens");
    const lineIndex = lineIndexById.get(candidate.lineId);
    if (lineIndex === undefined) fail(context, `${candidatePath}.lineId`, "must anchor an exact caption line");
    const key = `${candidate.lens}${candidate.lineId}`;
    if (seen.has(key)) fail(context, candidatePath, "must not repeat a lens on the same line");
    seen.add(key);
    const order = lineIndex * LEARNING_PREP_LENS_KINDS.length + lensOrder.get(candidate.lens)!;
    if (order <= previousOrder) fail(context, `${path}.candidates`, "must be ordered by line time and armed lens order");
    previousOrder = order;
    if (candidate.availability === "available") {
      const line = lines[lineIndex];
      if (line.source.state !== "available") {
        fail(context, candidatePath, "cannot be available on a line without available source text");
      }
      if (candidate.lens === "word_order" && line.target.state !== "available") {
        fail(context, candidatePath, "word-order help cannot be available without available target text");
      }
    }
  }

  const ceilings = LEARNING_PREP_TEMPERATURE_CEILINGS[fineTune.temperature];
  const available = candidates.filter((candidate) => candidate.availability === "available");
  if (available.length > ceilings.maxAvailableTotal) {
    fail(context, `${path}.candidates`, "must respect the armed temperature's total available ceiling");
  }
  const availablePerBeat = new Map<string, number>();
  for (const candidate of available) {
    const beatKey = beatIndexByLine(segmentation, candidate.lineId);
    const count = (availablePerBeat.get(beatKey) ?? 0) + 1;
    if (count > ceilings.maxAvailablePerBeat) {
      fail(context, `${path}.candidates`, "must respect the armed temperature's per-beat available ceiling");
    }
    availablePerBeat.set(beatKey, count);
  }

  const surfacedLenses = new Set(candidates.map((candidate) => candidate.lens));
  const abstentions = array(item.lensAbstentions, context, `${path}.lensAbstentions`).map((entry, index) => {
    const row = object(entry, context, `${path}.lensAbstentions[${index}]`);
    exact(row, ["lens", "reasonCode"], context, `${path}.lensAbstentions[${index}]`);
    return {
      lens: oneOf<LearningPrepLensKind>(row.lens, LENS_KINDS, context, `${path}.lensAbstentions[${index}].lens`),
      reasonCode: oneOf<LearningPrepLensAbstentionReasonCode>(row.reasonCode, LENS_ABSTENTION_REASONS, context, `${path}.lensAbstentions[${index}].reasonCode`),
    };
  });
  const expectedAbstained = fineTune.armedLenses.filter((lens) => !surfacedLenses.has(lens));
  if (JSON.stringify(abstentions.map((entry) => entry.lens)) !== JSON.stringify(expectedAbstained)) {
    fail(context, `${path}.lensAbstentions`, "must name exactly the armed lenses without candidates, in armed order");
  }

  return { segmentation, candidates, lensAbstentions: abstentions };
}

function validateStoredSegmentation(
  value: unknown,
  lines: readonly LearningPrepContextLine[],
  context: string,
  path: string,
): LearningPrepSegmentation {
  const item = object(value, context, path);
  const mode = oneOf<"beats" | "watch_through">(item.mode, new Set(["beats", "watch_through"]), context, `${path}.mode`);
  if (mode === "watch_through") {
    exact(item, ["mode", "reasonCode"], context, path);
    return { mode, reasonCode: oneOf(item.reasonCode, WATCH_THROUGH_REASONS, context, `${path}.reasonCode`) };
  }
  exact(item, ["mode", "beats"], context, path);
  const lineById = new Map(lines.map((line) => [line.lineId, line]));
  const beats = array(item.beats, context, `${path}.beats`).map((beat, index) => {
    const row = object(beat, context, `${path}.beats[${index}]`);
    exact(row, ["beatId", "startMs", "endMs", "lineIds"], context, `${path}.beats[${index}]`);
    const lineIds = uniqueStrings(row.lineIds, context, `${path}.beats[${index}].lineIds`);
    if (lineIds.length === 0) fail(context, `${path}.beats[${index}].lineIds`, "must contain at least one line");
    const first = lineById.get(lineIds[0]);
    const last = lineById.get(lineIds[lineIds.length - 1]);
    if (!first || !last) fail(context, `${path}.beats[${index}].lineIds`, "must reference exact caption lines");
    return {
      beatId: literal(row.beatId, `beat:${index}`, context, `${path}.beats[${index}].beatId`),
      startMs: (() => {
        const startMs = integer(row.startMs, context, `${path}.beats[${index}].startMs`);
        if (startMs !== first!.startMs) fail(context, `${path}.beats[${index}].startMs`, "must equal the first line's start");
        return startMs;
      })(),
      endMs: (() => {
        const endMs = integer(row.endMs, context, `${path}.beats[${index}].endMs`, 1);
        if (endMs !== last!.endMs) fail(context, `${path}.beats[${index}].endMs`, "must equal the last line's end");
        return endMs;
      })(),
      lineIds,
    };
  });
  if (beats.length === 0 || beats.length > LEARNING_PREP_LIMITS.maxBeats) {
    fail(context, `${path}.beats`, "must contain a bounded non-empty beat list");
  }
  const flattened = beats.flatMap((beat) => beat.lineIds);
  if (JSON.stringify(flattened) !== JSON.stringify(lines.map((line) => line.lineId))) {
    fail(context, `${path}.beats`, "must partition every caption line contiguously, completely, and in order");
  }
  return { mode: "beats", beats };
}

function validateStoredCandidate(
  value: unknown,
  lines: readonly LearningPrepContextLine[],
  context: string,
  path: string,
): LearningPrepCandidate {
  const item = object(value, context, path);
  exact(item, ["lens", "anchor", "availability", "reasonCode", "content", "executionAuthority", "semanticReview", "grounding", "externalCitationIds"], context, path);
  literal(item.executionAuthority, "host_receipted", context, `${path}.executionAuthority`);
  literal(item.semanticReview, "not_reviewed", context, `${path}.semanticReview`);
  const citations = array(item.externalCitationIds, context, `${path}.externalCitationIds`);
  if (citations.length !== 0) fail(context, `${path}.externalCitationIds`, "must remain empty in v1");
  const anchor = object(item.anchor, context, `${path}.anchor`);
  exact(anchor, ["lineId", "startMs", "endMs"], context, `${path}.anchor`);
  const lineId = stableIdentity(anchor.lineId, context, `${path}.anchor.lineId`);
  const line = lines.find((candidateLine) => candidateLine.lineId === lineId);
  if (!line) fail(context, `${path}.anchor.lineId`, "must anchor an exact caption line");
  if (
    integer(anchor.startMs, context, `${path}.anchor.startMs`) !== line!.startMs ||
    integer(anchor.endMs, context, `${path}.anchor.endMs`, 1) !== line!.endMs
  ) fail(context, `${path}.anchor`, "must carry the exact stored line media range");
  const generated = generatedCandidate(
    { lens: item.lens, lineId, availability: item.availability, reasonCode: item.reasonCode, content: item.content },
    context,
    path,
  );
  if (generated.availability === "available") {
    literal(item.grounding, "caption_context_inference", context, `${path}.grounding`);
    return {
      lens: generated.lens,
      anchor: { lineId, startMs: line!.startMs, endMs: line!.endMs },
      availability: "available",
      reasonCode: null,
      content: generated.content,
      executionAuthority: "host_receipted",
      semanticReview: "not_reviewed",
      grounding: "caption_context_inference",
      externalCitationIds: [],
    } as LearningPrepCandidate;
  }
  literal(item.grounding, "none", context, `${path}.grounding`);
  return {
    lens: generated.lens,
    anchor: { lineId, startMs: line!.startMs, endMs: line!.endMs },
    availability: generated.availability,
    reasonCode: generated.reasonCode,
    content: null,
    executionAuthority: "host_receipted",
    semanticReview: "not_reviewed",
    grounding: "none",
    externalCitationIds: [],
  };
}

function validateLensOutcomes(
  value: unknown,
  fineTune: LearningFineTune,
  candidates: readonly LearningPrepCandidate[],
  context: string,
  path: string,
): LearningPrepLensOutcome[] {
  const outcomes = array(value, context, path).map((entry, index) => {
    const row = object(entry, context, `${path}[${index}]`);
    exact(row, ["lens", "state", "reasonCode", "candidateCount"], context, `${path}[${index}]`);
    const lens = oneOf<LearningPrepLensKind>(row.lens, LENS_KINDS, context, `${path}[${index}].lens`);
    const state = oneOf<"surfaced" | "abstained">(row.state, new Set(["surfaced", "abstained"]), context, `${path}[${index}].state`);
    const candidateCount = integer(row.candidateCount, context, `${path}[${index}].candidateCount`);
    const actual = candidates.filter((candidate) => candidate.lens === lens).length;
    if (state === "surfaced") {
      if (row.reasonCode !== null) fail(context, `${path}[${index}].reasonCode`, "must be null for a surfaced lens");
      if (candidateCount === 0 || candidateCount !== actual) {
        fail(context, `${path}[${index}].candidateCount`, "must equal the stored candidate count for this lens");
      }
      return { lens, state, reasonCode: null, candidateCount } as LearningPrepLensOutcome;
    }
    if (candidateCount !== 0 || actual !== 0) {
      fail(context, `${path}[${index}]`, "an abstained lens must have zero candidates");
    }
    return {
      lens,
      state,
      reasonCode: oneOf(row.reasonCode, LENS_ABSTENTION_REASONS, context, `${path}[${index}].reasonCode`),
      candidateCount: 0,
    } as LearningPrepLensOutcome;
  });
  if (JSON.stringify(outcomes.map((outcome) => outcome.lens)) !== JSON.stringify(fineTune.armedLenses)) {
    fail(context, path, "must record every armed lens exactly once and in armed order");
  }
  return outcomes;
}

export function deriveLearningPrepResult(
  fineTune: LearningFineTune,
  candidates: readonly LearningPrepCandidate[],
  lenses: readonly LearningPrepLensOutcome[],
  segmentation: LearningPrepSegmentation,
): LearningPrepArtifact["result"] {
  const availableCandidateCount = candidates.filter((candidate) => candidate.availability === "available").length;
  const withheldCandidateCount = candidates.filter((candidate) => candidate.availability === "withheld").length;
  const unavailableCandidateCount = candidates.filter((candidate) => candidate.availability === "unavailable").length;
  const everyLensAvailable = fineTune.armedLenses.every((lens) =>
    candidates.some((candidate) => candidate.lens === lens && candidate.availability === "available"));
  return {
    status: availableCandidateCount === 0 ? "unavailable" : everyLensAvailable ? "completed" : "partial",
    armedLensCount: fineTune.armedLenses.length,
    surfacedLensCount: lenses.filter((lens) => lens.state === "surfaced").length,
    abstainedLensCount: lenses.filter((lens) => lens.state === "abstained").length,
    candidateCount: candidates.length,
    availableCandidateCount,
    withheldCandidateCount,
    unavailableCandidateCount,
    beatCount: segmentation.mode === "beats" ? segmentation.beats.length : null,
  };
}

function validateNonClaims(value: unknown, context: string, path: string): typeof LEARNING_PREP_NON_CLAIMS {
  const claims = uniqueStrings(value, context, path);
  if (claims.length !== NON_CLAIMS.size || claims.some((claim) => !NON_CLAIMS.has(claim))) {
    fail(context, path, "must retain the complete closed learning-prep non-claim set");
  }
  return [...LEARNING_PREP_NON_CLAIMS];
}

function validateResultCounts(
  value: unknown,
  context: string,
  path: string,
): LearningPrepArtifact["result"] {
  const item = object(value, context, path);
  const beatCount = item.beatCount === null ? null : integer(item.beatCount, context, `${path}.beatCount`, 1);
  return {
    status: oneOf<LearningPrepArtifact["result"]["status"]>(item.status, new Set(["completed", "partial", "unavailable"]), context, `${path}.status`),
    armedLensCount: integer(item.armedLensCount, context, `${path}.armedLensCount`, 1),
    surfacedLensCount: integer(item.surfacedLensCount, context, `${path}.surfacedLensCount`),
    abstainedLensCount: integer(item.abstainedLensCount, context, `${path}.abstainedLensCount`),
    candidateCount: integer(item.candidateCount, context, `${path}.candidateCount`),
    availableCandidateCount: integer(item.availableCandidateCount, context, `${path}.availableCandidateCount`),
    withheldCandidateCount: integer(item.withheldCandidateCount, context, `${path}.withheldCandidateCount`),
    unavailableCandidateCount: integer(item.unavailableCandidateCount, context, `${path}.unavailableCandidateCount`),
    beatCount,
  };
}

export function validateLearningPrepArtifact(
  value: unknown,
  context = "Learning-prep artifact",
  path = "artifact",
): LearningPrepArtifact {
  const item = object(value, context, path);
  exact(item, ["schema", "jobId", "runId", "input", "grant", "executor", "segmentation", "lenses", "candidates", "result", "semanticReview", "rights", "nonClaims"], context, path);
  literal(item.schema, "studio.learning-prep.artifact.v1", context, `${path}.schema`);
  const jobId = stableIdentity(item.jobId, context, `${path}.jobId`);
  const runId = stableIdentity(item.runId, context, `${path}.runId`);
  const input = validateLearningPrepInputAuthority(item.input, context, `${path}.input`);
  const grant = validateLearningPrepGrant(item.grant, context, `${path}.grant`);
  const executor = validateLearningPrepExecutorDescriptor(item.executor, context, `${path}.executor`);
  const segmentation = validateStoredSegmentation(item.segmentation, input.lines, context, `${path}.segmentation`);
  const candidates = array(item.candidates, context, `${path}.candidates`).map((candidate, index) =>
    validateStoredCandidate(candidate, input.lines, context, `${path}.candidates[${index}]`));
  validateGeneratedLearningPrepOutput(
    {
      segmentation: segmentation.mode === "beats"
        ? { mode: "beats", beats: segmentation.beats.map((beat) => ({ lineIds: beat.lineIds })) }
        : segmentation,
      candidates: candidates.map((candidate) => ({
        lens: candidate.lens,
        lineId: candidate.anchor.lineId,
        availability: candidate.availability,
        reasonCode: candidate.reasonCode,
        content: candidate.content,
      })),
      lensAbstentions: array(item.lenses, context, `${path}.lenses`)
        .map((entry) => object(entry, context, `${path}.lenses`))
        .filter((entry) => entry.state === "abstained")
        .map((entry) => ({ lens: entry.lens, reasonCode: entry.reasonCode })),
    },
    grant.fineTune,
    input.lines,
    context,
    `${path}.candidates`,
  );
  const lenses = validateLensOutcomes(item.lenses, grant.fineTune, candidates, context, `${path}.lenses`);
  const result = validateResultCounts(item.result, context, `${path}.result`);
  exact(object(item.result, context, `${path}.result`), ["status", "armedLensCount", "surfacedLensCount", "abstainedLensCount", "candidateCount", "availableCandidateCount", "withheldCandidateCount", "unavailableCandidateCount", "beatCount"], context, `${path}.result`);
  if (JSON.stringify(result) !== JSON.stringify(deriveLearningPrepResult(grant.fineTune, candidates, lenses, segmentation))) {
    fail(context, `${path}.result`, "must be derived from lenses, candidates, and segmentation");
  }
  const review = object(item.semanticReview, context, `${path}.semanticReview`);
  exact(review, ["state", "receiptId"], context, `${path}.semanticReview`);
  literal(review.state, "not_reviewed", context, `${path}.semanticReview.state`);
  if (review.receiptId !== null) fail(context, `${path}.semanticReview.receiptId`, "must remain null without a review producer");
  const rights = object(item.rights, context, `${path}.rights`);
  exact(rights, ["sourceScope", "publication", "exportEligibility"], context, `${path}.rights`);
  const sourceScope = oneOf<LearningPrepArtifact["rights"]["sourceScope"]>(rights.sourceScope, new Set(["local_processing", "redistribution"]), context, `${path}.rights.sourceScope`);
  literal(rights.publication, "private", context, `${path}.rights.publication`);
  literal(rights.exportEligibility, "unavailable", context, `${path}.rights.exportEligibility`);
  if (
    jobId !== grant.grantId.replace(/^learning-prep-grant:/, "learning-prep:") ||
    runId !== grant.runId ||
    JSON.stringify(input.caption) !== JSON.stringify(grant.caption) ||
    JSON.stringify(executor) !== JSON.stringify(grant.executor) ||
    input.source.rightsScope !== grant.rightsScope || sourceScope !== grant.rightsScope
  ) fail(context, path, "artifact input, grant, executor, rights, and job identity must agree");
  return {
    schema: "studio.learning-prep.artifact.v1",
    jobId,
    runId,
    input,
    grant,
    executor,
    segmentation,
    lenses,
    candidates,
    result,
    semanticReview: { state: "not_reviewed", receiptId: null },
    rights: { sourceScope, publication: "private", exportEligibility: "unavailable" },
    nonClaims: validateNonClaims(item.nonClaims, context, `${path}.nonClaims`),
  };
}

export function validateLearningPrepReceipt(
  value: unknown,
  context = "Learning-prep receipt",
  path = "receipt",
): LearningPrepReceipt {
  const item = object(value, context, path);
  exact(item, ["schema", "receiptId", "jobId", "grant", "input", "producer", "limits", "execution", "result", "nonClaims"], context, path);
  literal(item.schema, "studio.learning-prep.receipt.v1", context, `${path}.schema`);
  const receiptId = stableIdentity(item.receiptId, context, `${path}.receiptId`);
  const jobId = stableIdentity(item.jobId, context, `${path}.jobId`);
  const grant = validateLearningPrepGrant(item.grant, context, `${path}.grant`);
  const input = validateLearningPrepInputAuthority(item.input, context, `${path}.input`);
  const producer = object(item.producer, context, `${path}.producer`);
  exact(producer, ["id", "version", "policy", "executor"], context, `${path}.producer`);
  literal(producer.id, "studio.host-learning-prep", context, `${path}.producer.id`);
  literal(producer.version, "1", context, `${path}.producer.version`);
  literal(producer.policy, "verified_current_caption_post_study_apply_only", context, `${path}.producer.policy`);
  const executor = validateLearningPrepExecutorDescriptor(producer.executor, context, `${path}.producer.executor`);
  const execution = object(item.execution, context, `${path}.execution`);
  exact(execution, ["providerResponseId", "inputTokens", "outputTokens"], context, `${path}.execution`);
  const resultValue = object(item.result, context, `${path}.result`);
  exact(resultValue, ["status", "armedLensCount", "surfacedLensCount", "abstainedLensCount", "candidateCount", "availableCandidateCount", "withheldCandidateCount", "unavailableCandidateCount", "beatCount", "artifactId", "contentId", "bytes", "lenses"], context, `${path}.result`);
  const counts = validateResultCounts(resultValue, context, `${path}.result`);
  const lenses = array(resultValue.lenses, context, `${path}.result.lenses`).map((entry, index) => {
    const row = object(entry, context, `${path}.result.lenses[${index}]`);
    exact(row, ["lens", "state", "reasonCode", "candidateCount"], context, `${path}.result.lenses[${index}]`);
    const state = oneOf<"surfaced" | "abstained">(row.state, new Set(["surfaced", "abstained"]), context, `${path}.result.lenses[${index}].state`);
    const candidateCount = integer(row.candidateCount, context, `${path}.result.lenses[${index}].candidateCount`);
    if (state === "surfaced" && (row.reasonCode !== null || candidateCount === 0)) {
      fail(context, `${path}.result.lenses[${index}]`, "a surfaced lens must have candidates and no reason code");
    }
    if (state === "abstained" && candidateCount !== 0) {
      fail(context, `${path}.result.lenses[${index}]`, "an abstained lens must have zero candidates");
    }
    return {
      lens: oneOf<LearningPrepLensKind>(row.lens, LENS_KINDS, context, `${path}.result.lenses[${index}].lens`),
      state,
      reasonCode: state === "abstained"
        ? oneOf<LearningPrepLensAbstentionReasonCode>(row.reasonCode, LENS_ABSTENTION_REASONS, context, `${path}.result.lenses[${index}].reasonCode`)
        : null,
      candidateCount,
    };
  });
  if (JSON.stringify(lenses.map((entry) => entry.lens)) !== JSON.stringify(grant.fineTune.armedLenses)) {
    fail(context, `${path}.result.lenses`, "must record every armed lens exactly once and in armed order");
  }
  if (
    counts.armedLensCount !== grant.fineTune.armedLenses.length ||
    counts.surfacedLensCount !== lenses.filter((entry) => entry.state === "surfaced").length ||
    counts.abstainedLensCount !== lenses.filter((entry) => entry.state === "abstained").length ||
    counts.candidateCount !== lenses.reduce((total, entry) => total + entry.candidateCount, 0) ||
    counts.availableCandidateCount + counts.withheldCandidateCount + counts.unavailableCandidateCount !== counts.candidateCount ||
    (counts.status === "unavailable") !== (counts.availableCandidateCount === 0)
  ) fail(context, `${path}.result`, "must be internally consistent with the lens summary");
  const result = {
    ...counts,
    artifactId: stableIdentity(resultValue.artifactId, context, `${path}.result.artifactId`),
    contentId: contentId(resultValue.contentId, context, `${path}.result.contentId`),
    bytes: integer(resultValue.bytes, context, `${path}.result.bytes`, 1),
    lenses,
  };
  if (
    jobId !== grant.grantId.replace(/^learning-prep-grant:/, "learning-prep:") ||
    JSON.stringify(input.caption) !== JSON.stringify(grant.caption) ||
    JSON.stringify(executor) !== JSON.stringify(grant.executor)
  ) fail(context, path, "receipt input, grant, executor, and job identity must agree");
  return {
    schema: "studio.learning-prep.receipt.v1",
    receiptId,
    jobId,
    grant,
    input,
    producer: { id: "studio.host-learning-prep", version: "1", policy: "verified_current_caption_post_study_apply_only", executor },
    limits: validateLearningPrepLimits(item.limits, context, `${path}.limits`),
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
