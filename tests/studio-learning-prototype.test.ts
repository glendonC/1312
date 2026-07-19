import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  bindLearningPrototypeFixture,
  learningPrototypeFixture,
  readLearningPrototypeFixture,
} from "../src/studio/learning/prototypeFixture.ts";
import { projectPrototypeLearningPresentation } from "../src/studio/learning/prototypeAdapter.ts";
import { projectRecordedLearningPrep } from "../src/studio/learning/recordedLearningPrepAdapter.ts";
import {
  projectRecordedLearningSource,
  validateLearningSourceContext,
} from "../src/studio/learning/sourceAdapters.ts";
import { projectVerifiedProductionLearningSource } from "../src/studio/learning/productionSourceAdapter.ts";
import type { RunBundle } from "../src/studio/transport.ts";

const RUN_DIRECTORY = resolve("public/demo/runs/run-006");

function json(name: string): unknown {
  return JSON.parse(readFileSync(resolve(RUN_DIRECTORY, name), "utf8")) as unknown;
}

function recordedBundle(): RunBundle {
  return {
    run: json("run.json"),
    captions: json("captions.json"),
    evidence: json("evidence.json"),
    ingestReceipt: json("source.json"),
    mediaProbe: json("media-probe.json"),
  } as RunBundle;
}

function verifiedProductionResult(): unknown {
  const study = {
    studyId: "study-1",
    artifactId: "artifact-study-1",
    contentId: "sha256:study",
    executorReceiptId: "receipt-study-1",
    executorReceiptContentId: "sha256:study-receipt",
  };
  const readiness = {
    readinessId: "readiness-1",
    artifactId: "artifact-readiness-1",
    receiptId: "receipt-readiness-1",
    receiptContentId: "sha256:readiness-receipt",
  };
  const source = {
    artifactId: "artifact-source-1",
    contentId: "sha256:source",
    analysisRequestId: "analysis-request-1",
    range: { startMs: 0, endMs: 1_000 },
  };
  return {
    verification: {
      integrity: "stored_caption_and_receipt_with_verified_study_readiness_approval",
      jobId: "caption-job-1",
      captionArtifactId: "artifact-caption-1",
      captionContentId: "sha256:caption",
      receiptArtifactId: "artifact-caption-receipt-1",
      receiptId: "caption-receipt-1",
      receiptContentId: "sha256:caption-receipt",
      source,
      study,
      readiness,
    },
    artifact: {
      schema: "studio.caption-production.artifact.v1",
      jobId: "caption-job-1",
      runId: "runtime-run-1",
      input: {
        sourceArtifactId: source.artifactId,
        sourceContentId: source.contentId,
        analysisRequestId: source.analysisRequestId,
        range: source.range,
        sourceLanguage: "ko",
        targetLanguage: "en",
        study,
        readiness,
      },
      executor: {
        id: "studio.deterministic-current-run-caption-test-seam",
        version: "1",
        classification: "deterministic_current_run_test_seam",
        executionScope: "current_run",
        cognitionClaim: "none",
        recognizer: "test-recognizer",
        translator: "test-translator",
        sourceCaptionContentId: null,
      },
      lines: [{
        id: "line-1",
        startMs: 0,
        endMs: 1_000,
        source: { language: "ko", state: "available", text: "현재 실행", reasonCode: null },
        target: { language: "en", state: "available", text: "Current run", reasonCode: null },
      }],
    },
  };
}

test("recorded adapter preserves run-006 cue authority and never projects withheld baseline text", () => {
  const source = projectRecordedLearningSource(recordedBundle());
  assert.equal(source.context.origin, "recorded_fixture");
  assert.equal(source.context.identities.runId, "run-006");
  assert.equal(source.context.identities.sourceId, "Ux-TMWnmntM");
  assert.equal(
    source.context.identities.sourceContentId,
    "sha256:4f60799f8a71c7c6a19d05067eb7b74b74a9d0f2a32000ba6c1e341273c1905f",
  );
  assert.equal(source.context.identities.captionArtifactId, "captions");
  assert.equal(
    source.context.identities.captionContentId,
    "sha256:45b3ff96cef4a0112586e6bfb6e530e7cb227d48147f90a65e4ace3fd3f6690c",
  );

  const supported = source.moments.find((moment) => moment.lineId === "c01");
  assert.deepEqual(supported && {
    startMs: supported.startMs,
    endMs: supported.endMs,
    source: supported.source,
    target: supported.target,
  }, {
    startMs: 0,
    endMs: 1_550,
    source: {
      state: "available",
      text: "분들이 몇 분 계신데",
      reasonCode: null,
      upstreamReasonCode: null,
      detail: null,
    },
    target: {
      state: "available",
      text: "I know a few people.",
      reasonCode: null,
      upstreamReasonCode: null,
      detail: null,
    },
  });

  const withheld = source.moments.find((moment) => moment.lineId === "c07");
  assert.equal(withheld?.target.state, "withheld");
  assert.equal(withheld?.target.text, null);
  assert.equal(withheld?.target.reasonCode, "recorded_target_withheld");
  assert.equal(JSON.stringify(withheld).includes("Why?"), false);
});

test("design fixture binds exact code-point selections to the recorded c01 moment", () => {
  const source = projectRecordedLearningSource(recordedBundle());
  const projection = bindLearningPrototypeFixture(source, learningPrototypeFixture);
  assert.equal(projection.state, "ready");
  if (projection.state !== "ready") return;
  assert.deepEqual(projection.selections.map((selection) => ({
    id: selection.selectionId,
    lineId: selection.lineId,
    startMs: selection.startMs,
    endMs: selection.endMs,
    start: selection.span.start,
    end: selection.span.end,
    text: selection.span.text,
    authority: selection.authority,
  })), [
    {
      id: "run-006:c01:source:4-7",
      lineId: "c01",
      startMs: 0,
      endMs: 1_550,
      start: 4,
      end: 7,
      text: "몇 분",
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
    },
    {
      id: "run-006:c01:source:0-11",
      lineId: "c01",
      startMs: 0,
      endMs: 1_550,
      start: 0,
      end: 11,
      text: "분들이 몇 분 계신데",
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
    },
  ]);
  assert.deepEqual(projection.selections.map((selection) => selection.facets.map((facet) => facet.kind)), [
    ["meaning", "word"],
    ["meaning", "grammar", "translation_choice"],
  ]);
  assert.equal(JSON.stringify(projection).includes("listening_difficulty"), false);
  assert.equal(JSON.stringify(projection).includes("culture"), false);
});

test("recorded learning prep projects the shared overlay with design-fixture authority", () => {
  const source = projectRecordedLearningSource(recordedBundle());
  const projection = projectRecordedLearningPrep(source, learningPrototypeFixture, {
    armedLenses: ["grammar_salience", "situating", "culture_reference"],
    temperature: "medium",
  });

  assert.equal(projection.state, "ready");
  if (projection.state !== "ready") return;
  assert.deepEqual(projection.authority, {
    dataClass: "design_fixture",
    productionAuthority: false,
    executionAuthority: null,
    semanticReviewState: "not_reviewed",
    fixtureId: "learning-prototype:run-006:c01",
    artifactId: null,
    contentId: null,
    receiptId: null,
    receiptContentId: null,
  });
  assert.equal(projection.resultState, "partial");
  assert.deepEqual(projection.moments.map((moment) => ({
    lens: moment.lens,
    availability: moment.availability,
    dataClass: moment.dataClass,
    productionAuthority: moment.productionAuthority,
    executionAuthority: moment.executionAuthority,
  })), [
    {
      lens: "grammar_salience",
      availability: "available",
      dataClass: "design_fixture",
      productionAuthority: false,
      executionAuthority: null,
    },
    {
      lens: "situating",
      availability: "available",
      dataClass: "design_fixture",
      productionAuthority: false,
      executionAuthority: null,
    },
    {
      lens: "culture_reference",
      availability: "unavailable",
      dataClass: "design_fixture",
      productionAuthority: false,
      executionAuthority: null,
    },
  ]);
  assert.equal(JSON.stringify(projection).includes("host_receipted"), false);
  assert.equal(JSON.stringify(projection).includes("runtime_artifact"), false);
});

test("fixture validation rejects offset drift, unsupported facets, and fabricated support", () => {
  const offsetDrift = structuredClone(learningPrototypeFixture);
  offsetDrift.selections[0].span.start = 3;
  assert.throws(() => readLearningPrototypeFixture(offsetDrift), /does not reconstruct/);

  const unsupportedFacet = structuredClone(learningPrototypeFixture) as unknown as {
    selections: Array<{ insights: Array<Record<string, unknown>> }>;
  };
  unsupportedFacet.selections[0].insights.push({
    kind: "culture",
    availability: "available",
    authority: "design_fixture",
    semanticReviewState: "not_reviewed",
    reasonCode: null,
    claimIds: [],
    citationIds: [],
    content: { context: "Unsupported prose", sourceLabel: null },
  });
  assert.throws(() => readLearningPrototypeFixture(unsupportedFacet), /kind is invalid/);

  const fabricatedClaim = structuredClone(learningPrototypeFixture) as unknown as {
    selections: Array<{ insights: Array<{ claimIds: string[] }> }>;
  };
  fabricatedClaim.selections[0].insights[0].claimIds.push("claim:not-real");
  assert.throws(() => readLearningPrototypeFixture(fabricatedClaim), /claimIds must be empty/);

  const outOfRange = structuredClone(learningPrototypeFixture);
  outOfRange.selections[1].span.end = 999;
  assert.throws(() => readLearningPrototypeFixture(outOfRange), /does not reconstruct/);

  const duplicateInsight = structuredClone(learningPrototypeFixture);
  duplicateInsight.selections[0].insights.push(structuredClone(duplicateInsight.selections[0].insights[0]));
  assert.throws(() => readLearningPrototypeFixture(duplicateInsight), /duplicate insight kinds/);

  const overlappingInline = structuredClone(learningPrototypeFixture);
  overlappingInline.selections.push({
    ...structuredClone(overlappingInline.selections[0]),
    selectionId: "run-006:c01:source:6-7",
    span: { unit: "unicode_code_point", start: 6, end: 7, text: "분" },
  });
  assert.throws(() => readLearningPrototypeFixture(overlappingInline), /inline selections overlap/);
});

test("prototype presentation is selected explicitly and retains fixture-only authority", () => {
  const source = projectRecordedLearningSource(recordedBundle());
  const presentation = projectPrototypeLearningPresentation(source, learningPrototypeFixture);
  assert.equal(presentation.mode, "prototype");
  assert.deepEqual(presentation.savedItems, { state: "session" });
  assert.equal(presentation.explanations.state, "ready");
  assert.equal(JSON.stringify(presentation).includes("host_receipted"), false);
});

test("fixture binding fails closed when recorded content identity changes", () => {
  const source = projectRecordedLearningSource(recordedBundle());
  assert.equal(source.context.origin, "recorded_fixture");
  source.context.identities.captionContentId = "sha256:changed";
  assert.deepEqual(bindLearningPrototypeFixture(source, learningPrototypeFixture), {
    state: "failed",
    reasonCode: "invalid_source_binding",
  });

  const changedMedia = projectRecordedLearningSource(recordedBundle());
  assert.equal(changedMedia.context.origin, "recorded_fixture");
  changedMedia.context.identities.sourceContentId = "sha256:changed-media";
  assert.deepEqual(bindLearningPrototypeFixture(changedMedia, learningPrototypeFixture), {
    state: "failed",
    reasonCode: "invalid_source_binding",
  });
});

test("fixture binding revalidates mutated fixture authority instead of trusting a type", () => {
  const source = projectRecordedLearningSource(recordedBundle());
  const mutated = structuredClone(learningPrototypeFixture) as unknown as Record<string, unknown>;
  mutated.productionAuthority = true;
  assert.deepEqual(bindLearningPrototypeFixture(source, mutated), {
    state: "failed",
    reasonCode: "invalid_fixture_binding",
  });
});

test("source context validation rejects mixed recorded and production authority fields", () => {
  const source = projectRecordedLearningSource(recordedBundle());
  assert.throws(() => validateLearningSourceContext({
    ...source.context,
    identities: {
      ...source.context.identities,
      studyId: "study-from-another-authority",
    },
  }), /production authority fields/);

  assert.throws(() => validateLearningSourceContext({
    ...source.context,
    rights: {
      ...source.context.rights,
      basis: "production_private_source_policy",
    },
  }), /authority or rights fields/);
});

test("fixture binding rejects recorded moment identities and production support mixed into recorded authority", () => {
  const missingCueIdentity = projectRecordedLearningSource(recordedBundle());
  assert.equal(missingCueIdentity.context.origin, "recorded_fixture");
  missingCueIdentity.context.identities.cueIds = missingCueIdentity.context.identities.cueIds
    .filter((cueId) => cueId !== "c07");
  assert.deepEqual(bindLearningPrototypeFixture(missingCueIdentity, learningPrototypeFixture), {
    state: "failed",
    reasonCode: "mixed_authority",
  });

  const mixedSupport = projectRecordedLearningSource(recordedBundle());
  const supportedMoment = mixedSupport.moments.find((moment) => moment.lineId === "c01");
  assert.ok(supportedMoment);
  (supportedMoment as unknown as Record<string, unknown>).support = {
    state: "caption_line_support",
    claimIds: ["claim:production-only"],
    citationIds: ["citation:production-only"],
    semanticEvidenceArtifactIds: [],
    semanticEvidenceReceiptIds: [],
  };
  assert.deepEqual(bindLearningPrototypeFixture(mixedSupport, learningPrototypeFixture), {
    state: "failed",
    reasonCode: "mixed_authority",
  });
});

test("production adapter requires verified current-run caption authority", () => {
  const verified = verifiedProductionResult() as { artifact: unknown };
  assert.deepEqual(projectVerifiedProductionLearningSource(verified.artifact as never), {
    state: "failed",
    reasonCode: "invalid_source_binding",
  });

  assert.deepEqual(projectVerifiedProductionLearningSource(verifiedProductionResult() as never), {
    state: "failed",
    reasonCode: "invalid_source_binding",
  });

  const testDemoAuthority = structuredClone(verifiedProductionResult()) as {
    artifact: { executor: { executionScope: string } };
  };
  testDemoAuthority.artifact.executor.executionScope = "test_demo_only";
  assert.deepEqual(projectVerifiedProductionLearningSource(testDemoAuthority as never), {
    state: "failed",
    reasonCode: "invalid_source_binding",
  });
});
