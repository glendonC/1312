import fixtureData from "./fixtures/run-006.learning-prototype.json" with { type: "json" };
import {
  codePointSlice,
  type LearningViewingSource,
  type PresentedText,
  type SelectedLanguageSpan,
} from "./model.ts";
import type {
  LearningFacet,
  LearningFacetKind,
  LearningPrototypeProjection,
  PreparedLearningSelection,
} from "./presentation.ts";
import { validateLearningViewingSource } from "./sourceAdapters.ts";

export interface LearningPrototypeFixtureV1 {
  schema: "studio.learning-prototype-fixture.v1";
  dataClass: "design_fixture";
  productionAuthority: false;
  fixtureId: string;
  binding: {
    origin: "recorded_fixture";
    runId: string;
    sourceId: string;
    sourceContentId: string;
    captionArtifactId: string;
    captionContentId: string;
    lineId: string;
    startMs: number;
    endMs: number;
    sourceLanguage: string;
    targetLanguage: string;
    sourceText: string;
    target: { state: "available"; text: string };
  };
  semanticReview: { state: "not_reviewed"; receiptId: null };
  semanticSupport: {
    state: "none";
    reasonCode: "design_fixture_has_no_semantic_evidence";
    claimIds: [];
    citationIds: [];
  };
  selections: Array<{
    selectionId: string;
    side: "source";
    span: Omit<SelectedLanguageSpan, "side">;
    insights: LearningFacet[];
  }>;
  nonClaims: string[];
}

const INSIGHT_KINDS = new Set<LearningFacetKind>([
  "meaning",
  "word",
  "phrase",
  "grammar",
  "translation_choice",
]);
const NON_CLAIMS = new Set([
  "not_runtime_generated",
  "not_semantically_verified",
  "not_follow_up_capable",
  "not_grading_capable",
]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], context: string): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    throw new Error(`${context} has unexpected fields`);
  }
}

function nonEmptyString(value: unknown, context: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${context} must be a non-empty string`);
}

function integer(value: unknown, context: string): asserts value is number {
  if (!Number.isInteger(value)) throw new Error(`${context} must be an integer`);
}

function emptyStrings(value: unknown, context: string): asserts value is [] {
  if (!Array.isArray(value) || value.length !== 0) throw new Error(`${context} must be empty for design-fixture prose`);
}

function stringFields(value: unknown, fields: readonly string[], context: string): value is Record<string, string> {
  if (!record(value)) return false;
  exactKeys(value, fields, context);
  return fields.every((field) => typeof value[field] === "string" && value[field].length > 0);
}

function validContent(kind: LearningFacetKind, value: unknown): boolean {
  switch (kind) {
    case "meaning":
      return stringFields(value, ["sceneMeaning"], `${kind} content`);
    case "word":
      return stringFields(value, ["form", "sense", "role"], `${kind} content`);
    case "phrase":
      return stringFields(value, ["form", "function"], `${kind} content`);
    case "translation_choice":
      return stringFields(value, ["sourceChoice", "targetChoice", "rationale"], `${kind} content`);
    case "grammar": {
      if (!record(value)) return false;
      exactKeys(value, ["construction", "explanation", "segments"], `${kind} content`);
      if (
        typeof value.construction !== "string" || value.construction.length === 0 ||
        typeof value.explanation !== "string" || value.explanation.length === 0 ||
        !Array.isArray(value.segments) || value.segments.length === 0
      ) return false;
      return value.segments.every((segment, index) =>
        stringFields(segment, ["form", "role"], `${kind} segment ${index}`));
    }
  }
}

function insight(value: unknown, context: string): LearningFacet {
  if (!record(value)) throw new Error(`${context} must be an object`);
  exactKeys(value, [
    "kind",
    "availability",
    "authority",
    "semanticReviewState",
    "reasonCode",
    "claimIds",
    "citationIds",
    "content",
  ], context);
  if (typeof value.kind !== "string" || !INSIGHT_KINDS.has(value.kind as LearningFacetKind)) {
    throw new Error(`${context}.kind is invalid`);
  }
  const kind = value.kind as LearningFacetKind;
  if (value.authority !== "design_fixture" || value.semanticReviewState !== "not_reviewed") {
    throw new Error(`${context} cannot claim producer or semantic-review authority`);
  }
  emptyStrings(value.claimIds, `${context}.claimIds`);
  emptyStrings(value.citationIds, `${context}.citationIds`);
  if (value.availability !== "available" || value.reasonCode !== null || !validContent(kind, value.content)) {
    throw new Error(`${context} must contain prepared content for a supported facet`);
  }
  return value as unknown as LearningFacet;
}

export function readLearningPrototypeFixture(value: unknown): LearningPrototypeFixtureV1 {
  if (!record(value)) throw new Error("Learning prototype fixture must be an object");
  exactKeys(value, [
    "schema",
    "dataClass",
    "productionAuthority",
    "fixtureId",
    "binding",
    "semanticReview",
    "semanticSupport",
    "selections",
    "nonClaims",
  ], "Learning prototype fixture");
  if (
    value.schema !== "studio.learning-prototype-fixture.v1" ||
    value.dataClass !== "design_fixture" ||
    value.productionAuthority !== false
  ) throw new Error("Learning prototype fixture authority is invalid");
  nonEmptyString(value.fixtureId, "Learning prototype fixture id");

  if (!record(value.binding)) throw new Error("Learning prototype fixture binding must be an object");
  exactKeys(value.binding, [
    "origin",
    "runId",
    "sourceId",
    "sourceContentId",
    "captionArtifactId",
    "captionContentId",
    "lineId",
    "startMs",
    "endMs",
    "sourceLanguage",
    "targetLanguage",
    "sourceText",
    "target",
  ], "Learning prototype fixture binding");
  if (value.binding.origin !== "recorded_fixture") throw new Error("Learning prototype fixture must bind recorded authority");
  for (const field of [
    "runId",
    "sourceId",
    "sourceContentId",
    "captionArtifactId",
    "captionContentId",
    "lineId",
    "sourceLanguage",
    "targetLanguage",
    "sourceText",
  ] as const) nonEmptyString(value.binding[field], `Learning prototype fixture binding.${field}`);
  integer(value.binding.startMs, "Learning prototype fixture binding.startMs");
  integer(value.binding.endMs, "Learning prototype fixture binding.endMs");
  if (value.binding.startMs < 0 || value.binding.endMs <= value.binding.startMs) {
    throw new Error("Learning prototype fixture binding range is invalid");
  }
  if (!record(value.binding.target)) throw new Error("Learning prototype target must be an object");
  exactKeys(value.binding.target, ["state", "text"], "Learning prototype target");
  if (value.binding.target.state !== "available") throw new Error("Learning prototype target state is invalid");
  nonEmptyString(value.binding.target.text, "Learning prototype target text");

  if (!record(value.semanticReview)) throw new Error("Learning prototype semantic review must be an object");
  exactKeys(value.semanticReview, ["state", "receiptId"], "Learning prototype semantic review");
  if (value.semanticReview.state !== "not_reviewed" || value.semanticReview.receiptId !== null) {
    throw new Error("Learning prototype fixture cannot claim semantic review");
  }
  if (!record(value.semanticSupport)) throw new Error("Learning prototype semantic support must be an object");
  exactKeys(value.semanticSupport, ["state", "reasonCode", "claimIds", "citationIds"], "Learning prototype semantic support");
  if (
    value.semanticSupport.state !== "none" ||
    value.semanticSupport.reasonCode !== "design_fixture_has_no_semantic_evidence"
  ) throw new Error("Learning prototype fixture cannot claim semantic support");
  emptyStrings(value.semanticSupport.claimIds, "Learning prototype semantic support claimIds");
  emptyStrings(value.semanticSupport.citationIds, "Learning prototype semantic support citationIds");

  if (!Array.isArray(value.selections) || value.selections.length === 0) {
    throw new Error("Learning prototype fixture needs at least one selection");
  }
  const boundSourceText = value.binding.sourceText as string;
  const boundSourceLength = Array.from(boundSourceText).length;
  const selectionIds = new Set<string>();
  const selections = value.selections.map((candidate, selectionIndex) => {
    const context = `Learning prototype selection ${selectionIndex}`;
    if (!record(candidate)) throw new Error(`${context} must be an object`);
    exactKeys(candidate, ["selectionId", "side", "span", "insights"], context);
    nonEmptyString(candidate.selectionId, `${context}.selectionId`);
    if (selectionIds.has(candidate.selectionId)) throw new Error(`${context}.selectionId is duplicated`);
    selectionIds.add(candidate.selectionId);
    if (candidate.side !== "source" || !record(candidate.span)) throw new Error(`${context} must select source text`);
    exactKeys(candidate.span, ["unit", "start", "end", "text"], `${context}.span`);
    if (candidate.span.unit !== "unicode_code_point") throw new Error(`${context}.span must use code points`);
    integer(candidate.span.start, `${context}.span.start`);
    integer(candidate.span.end, `${context}.span.end`);
    nonEmptyString(candidate.span.text, `${context}.span.text`);
    if (
      candidate.span.start < 0 || candidate.span.end <= candidate.span.start || candidate.span.end > boundSourceLength ||
      codePointSlice(boundSourceText, candidate.span.start, candidate.span.end) !== candidate.span.text
    ) throw new Error(`${context}.span does not reconstruct its selected text`);
    if (!Array.isArray(candidate.insights) || candidate.insights.length === 0) {
      throw new Error(`${context} needs at least one insight`);
    }
    const insights = candidate.insights.map((item, insightIndex) => insight(item, `${context}.insight ${insightIndex}`));
    if (new Set(insights.map((item) => item.kind)).size !== insights.length) {
      throw new Error(`${context} has duplicate insight kinds`);
    }
    return {
      selectionId: candidate.selectionId,
      side: "source" as const,
      span: {
        unit: "unicode_code_point" as const,
        start: candidate.span.start,
        end: candidate.span.end,
        text: candidate.span.text,
      },
      insights,
    };
  });
  const inlineSelections = selections
    .filter((selection) => selection.span.start !== 0 || selection.span.end !== boundSourceLength)
    .sort((left, right) => left.span.start - right.span.start || left.span.end - right.span.end);
  for (let index = 1; index < inlineSelections.length; index += 1) {
    if (inlineSelections[index].span.start < inlineSelections[index - 1].span.end) {
      throw new Error("Learning prototype inline selections overlap");
    }
  }

  if (
    !Array.isArray(value.nonClaims) || value.nonClaims.length !== NON_CLAIMS.size ||
    value.nonClaims.some((claim) => typeof claim !== "string" || !NON_CLAIMS.has(claim)) ||
    new Set(value.nonClaims).size !== NON_CLAIMS.size
  ) throw new Error("Learning prototype fixture non-claims are invalid");

  return {
    ...value,
    binding: value.binding as unknown as LearningPrototypeFixtureV1["binding"],
    semanticReview: value.semanticReview as unknown as LearningPrototypeFixtureV1["semanticReview"],
    semanticSupport: value.semanticSupport as unknown as LearningPrototypeFixtureV1["semanticSupport"],
    selections,
    nonClaims: [...value.nonClaims] as string[],
  } as LearningPrototypeFixtureV1;
}

function samePresentedText(snapshot: LearningPrototypeFixtureV1["binding"]["target"], target: PresentedText): boolean {
  return target.state === snapshot.state && target.text === snapshot.text;
}

export function bindLearningPrototypeFixture(
  source: LearningViewingSource,
  fixtureInput: unknown,
): LearningPrototypeProjection {
  try {
    validateLearningViewingSource(source);
  } catch {
    return { state: "failed", reasonCode: "mixed_authority" };
  }
  if (source.context.origin !== "recorded_fixture") return { state: "failed", reasonCode: "mixed_authority" };
  let fixture: LearningPrototypeFixtureV1;
  try {
    fixture = readLearningPrototypeFixture(fixtureInput);
  } catch {
    return { state: "failed", reasonCode: "invalid_fixture_binding" };
  }
  const { binding } = fixture;
  const identities = source.context.identities;
  if (
    identities.runId !== binding.runId ||
    identities.sourceId !== binding.sourceId ||
    identities.sourceContentId !== binding.sourceContentId ||
    identities.captionArtifactId !== binding.captionArtifactId ||
    identities.captionContentId !== binding.captionContentId ||
    !identities.cueIds.includes(binding.lineId)
  ) return { state: "failed", reasonCode: "invalid_source_binding" };
  const moment = source.moments.find((candidate) => candidate.lineId === binding.lineId);
  if (
    !moment || moment.startMs !== binding.startMs || moment.endMs !== binding.endMs ||
    moment.sourceLanguage !== binding.sourceLanguage || moment.targetLanguage !== binding.targetLanguage ||
    moment.source.state !== "available" || moment.source.text !== binding.sourceText ||
    !samePresentedText(binding.target, moment.target)
  ) return { state: "failed", reasonCode: "invalid_fixture_binding" };

  const selections: PreparedLearningSelection[] = fixture.selections.map((selection) => ({
    selectionId: selection.selectionId,
    lineId: moment.lineId,
    startMs: moment.startMs,
    endMs: moment.endMs,
    sourceLanguage: moment.sourceLanguage,
    targetLanguage: moment.targetLanguage,
    source: moment.source,
    target: moment.target,
    span: { side: selection.side, ...selection.span },
    facets: selection.insights,
    authority: {
      dataClass: "design_fixture",
      productionAuthority: false,
      executionAuthority: null,
      semanticReviewState: "not_reviewed",
      artifactId: null,
      contentId: null,
      receiptId: null,
      receiptContentId: null,
    },
    nonClaims: fixture.nonClaims,
  }));
  return {
    state: "ready",
    selections,
  };
}

export const learningPrototypeFixture = readLearningPrototypeFixture(fixtureData);
