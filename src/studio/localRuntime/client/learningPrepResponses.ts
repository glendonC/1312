import { canonicalJsonLine, identifyUtf8 } from "../../runtime/production/observability/hash.ts";
import { canonicalSha256 } from "../../runtime/production/canonicalIdentity.ts";
import type { LearningFineTune } from "../../runtime/production/model/learningPrep.ts";
import {
  LEARNING_PREP_LENS_KINDS,
  LEARNING_PREP_TEMPERATURES,
} from "../../runtime/production/model/learningPrep.ts";
import type { RuntimeHostLearningPrepResponse } from "../../runtime/production/runtimeHost/model.ts";
import {
  validateLearningPrepArtifact,
  validateLearningPrepExecutorDescriptor,
  validateLearningPrepReceipt,
} from "../../runtime/production/validation/learningPrep.ts";
import {
  contentId,
  exact,
  fail,
  identity,
  integer,
  object,
} from "./responseGuards.ts";

const LENS_KINDS = new Set<string>(LEARNING_PREP_LENS_KINDS);
const TEMPERATURES = new Set<string>(LEARNING_PREP_TEMPERATURES);

function parseExecutor(value: unknown, path: string) {
  try {
    return validateLearningPrepExecutorDescriptor(value, "Runtime host learning preps", path);
  } catch (error) {
    fail(path, `executor descriptor is invalid: ${error instanceof Error ? error.message : "validation failed"}`);
  }
}

function parseFineTune(value: unknown, path: string): LearningFineTune {
  const item = object(value, path);
  exact(item, ["schema", "armedLenses", "temperature"], path);
  if (item.schema !== "studio.learning-fine-tune.v1") fail(`${path}.schema`, "is unsupported.");
  if (
    !Array.isArray(item.armedLenses) || item.armedLenses.length === 0 ||
    item.armedLenses.length > LEARNING_PREP_LENS_KINDS.length ||
    item.armedLenses.some((lens) => !LENS_KINDS.has(lens as string)) ||
    new Set(item.armedLenses).size !== item.armedLenses.length
  ) fail(`${path}.armedLenses`, "must contain unique closed armed lenses.");
  if (typeof item.temperature !== "string" || !TEMPERATURES.has(item.temperature)) {
    fail(`${path}.temperature`, "is unsupported.");
  }
  return {
    schema: "studio.learning-fine-tune.v1",
    armedLenses: item.armedLenses as LearningFineTune["armedLenses"],
    temperature: item.temperature as LearningFineTune["temperature"],
  };
}

function parseCaptionIdentity(value: unknown, path: string) {
  const caption = object(value, path);
  exact(caption, ["jobId", "artifactId", "contentId", "receiptArtifactId", "receiptId", "receiptContentId"], path);
  return {
    jobId: identity(caption.jobId, `${path}.jobId`),
    artifactId: identity(caption.artifactId, `${path}.artifactId`),
    contentId: contentId(caption.contentId, `${path}.contentId`),
    receiptArtifactId: identity(caption.receiptArtifactId, `${path}.receiptArtifactId`),
    receiptId: identity(caption.receiptId, `${path}.receiptId`),
    receiptContentId: contentId(caption.receiptContentId, `${path}.receiptContentId`),
  };
}

function parseResultCounts(value: unknown, path: string) {
  const counts = object(value, path);
  exact(counts, [
    "status",
    "armedLensCount",
    "surfacedLensCount",
    "abstainedLensCount",
    "candidateCount",
    "availableCandidateCount",
    "withheldCandidateCount",
    "unavailableCandidateCount",
    "beatCount",
  ], path);
  if (!["completed", "partial", "unavailable"].includes(counts.status as string)) {
    fail(`${path}.status`, "is unsupported.");
  }
  return {
    status: counts.status as "completed" | "partial" | "unavailable",
    armedLensCount: integer(counts.armedLensCount, `${path}.armedLensCount`, 1),
    surfacedLensCount: integer(counts.surfacedLensCount, `${path}.surfacedLensCount`),
    abstainedLensCount: integer(counts.abstainedLensCount, `${path}.abstainedLensCount`),
    candidateCount: integer(counts.candidateCount, `${path}.candidateCount`),
    availableCandidateCount: integer(counts.availableCandidateCount, `${path}.availableCandidateCount`),
    withheldCandidateCount: integer(counts.withheldCandidateCount, `${path}.withheldCandidateCount`),
    unavailableCandidateCount: integer(counts.unavailableCandidateCount, `${path}.unavailableCandidateCount`),
    beatCount: counts.beatCount === null ? null : integer(counts.beatCount, `${path}.beatCount`, 1),
  };
}

export async function learningPrepResponse(
  value: unknown,
  expectedRuntimeId: string,
): Promise<RuntimeHostLearningPrepResponse> {
  const context = "Runtime host learning preps";
  const item = object(value, context);
  exact(item, ["schema", "commandId", "runtimeId", "journalHead", "attempts", "results"], context);
  if (item.schema !== "studio.local-runtime-learning-preps.v1") {
    fail(context, "schema is unsupported.");
  }
  const runtimeId = identity(item.runtimeId, `${context}.runtimeId`);
  if (runtimeId !== expectedRuntimeId) fail(context, "runtime identity changed.");
  if (!Array.isArray(item.attempts)) fail(`${context}.attempts`, "must be an array.");
  const attemptJobIds = new Set<string>();
  const attempts = item.attempts.map((candidate, index) => {
    const attemptPath = `${context}.attempts[${index}]`;
    const attempt = object(candidate, attemptPath);
    exact(attempt, ["jobId", "attempt", "caption", "fineTune", "status", "failure"], attemptPath);
    const jobId = identity(attempt.jobId, `${attemptPath}.jobId`);
    if (attemptJobIds.has(jobId)) fail(`${attemptPath}.jobId`, "is duplicated.");
    attemptJobIds.add(jobId);
    if (attempt.status !== "started" && attempt.status !== "completed" && attempt.status !== "failed") {
      fail(`${attemptPath}.status`, "is unsupported.");
    }
    const status = attempt.status as "started" | "completed" | "failed";
    if (
      (status === "failed" && (typeof attempt.failure !== "string" || attempt.failure.length === 0)) ||
      (status !== "failed" && attempt.failure !== null)
    ) {
      fail(`${attemptPath}.failure`, "must exist only for a failed attempt.");
    }
    return {
      jobId,
      attempt: integer(attempt.attempt, `${attemptPath}.attempt`),
      caption: parseCaptionIdentity(attempt.caption, `${attemptPath}.caption`),
      fineTune: parseFineTune(attempt.fineTune, `${attemptPath}.fineTune`),
      status,
      failure: status === "failed" ? attempt.failure as string : null,
    };
  });
  if (!Array.isArray(item.results)) fail(`${context}.results`, "must be an array.");
  const jobIds = new Set<string>();
  const results = await Promise.all(item.results.map(async (candidate, index) => {
    const resultPath = `${context}.results[${index}]`;
    const result = object(candidate, resultPath);
    exact(result, ["verification", "artifact", "receipt"], resultPath);
    const verification = object(result.verification, `${resultPath}.verification`);
    exact(verification, [
      "integrity",
      "jobId",
      "artifactId",
      "contentId",
      "receiptArtifactId",
      "receiptId",
      "receiptContentId",
      "caption",
      "fineTune",
      "executor",
      "result",
    ], `${resultPath}.verification`);
    if (verification.integrity !== "stored_learning_prep_and_receipt_with_verified_current_caption") {
      fail(`${resultPath}.verification.integrity`, "does not carry closed learning-prep verification.");
    }
    const jobId = identity(verification.jobId, `${resultPath}.verification.jobId`);
    if (jobIds.has(jobId)) fail(`${resultPath}.verification.jobId`, "is duplicated.");
    jobIds.add(jobId);
    const artifact = validateLearningPrepArtifact(
      result.artifact,
      context,
      `results[${index}].artifact`,
    );
    const receipt = validateLearningPrepReceipt(
      result.receipt,
      context,
      `results[${index}].receipt`,
    );
    const captionIdentity = parseCaptionIdentity(verification.caption, `${resultPath}.verification.caption`);
    const fineTune = parseFineTune(verification.fineTune, `${resultPath}.verification.fineTune`);
    const executor = parseExecutor(verification.executor, `${resultPath}.verification.executor`);
    const resultCounts = parseResultCounts(verification.result, `${resultPath}.verification.result`);
    const artifactId = identity(verification.artifactId, `${resultPath}.verification.artifactId`);
    const verifiedContentId = contentId(verification.contentId, `${resultPath}.verification.contentId`);
    const receiptArtifactId = identity(verification.receiptArtifactId, `${resultPath}.verification.receiptArtifactId`);
    const receiptContentId = contentId(verification.receiptContentId, `${resultPath}.verification.receiptContentId`);
    if (
      artifact.runId !== runtimeId || artifact.jobId !== jobId ||
      JSON.stringify(artifact.input.caption) !== JSON.stringify(captionIdentity) ||
      JSON.stringify(artifact.grant.fineTune) !== JSON.stringify(fineTune) ||
      JSON.stringify(artifact.executor) !== JSON.stringify(executor) ||
      JSON.stringify(artifact.result) !== JSON.stringify(resultCounts) ||
      artifactId !== `artifact:${canonicalSha256({
        runId: runtimeId,
        jobId,
        kind: "learning-prep-output",
        contentId: verifiedContentId,
      })}` ||
      receiptArtifactId !== `artifact:${canonicalSha256({
        runId: runtimeId,
        jobId,
        kind: "learning-prep-receipt",
        contentId: receiptContentId,
      })}`
    ) fail(resultPath, "verification identities, fine-tune, executor, or counts do not match the artifact.");
    const measured = await identifyUtf8(canonicalJsonLine(artifact));
    if (measured.contentId !== verifiedContentId) {
      fail(resultPath, "artifact bytes do not match the verified learning-prep content identity.");
    }
    const measuredReceipt = await identifyUtf8(canonicalJsonLine(receipt));
    const receiptBody = structuredClone(receipt) as unknown as Record<string, unknown>;
    delete receiptBody.schema;
    delete receiptBody.receiptId;
    if (
      measuredReceipt.contentId !== receiptContentId ||
      receipt.receiptId !== identity(verification.receiptId, `${resultPath}.verification.receiptId`) ||
      receipt.receiptId !== `learning-prep-receipt:${canonicalSha256(receiptBody)}` ||
      receipt.jobId !== jobId ||
      JSON.stringify(receipt.grant) !== JSON.stringify(artifact.grant) ||
      JSON.stringify(receipt.input) !== JSON.stringify(artifact.input) ||
      JSON.stringify(receipt.producer.executor) !== JSON.stringify(artifact.executor) ||
      receipt.result.artifactId !== artifactId ||
      receipt.result.contentId !== verifiedContentId ||
      receipt.result.bytes !== measured.bytes ||
      canonicalSha256({
        status: receipt.result.status,
        armedLensCount: receipt.result.armedLensCount,
        surfacedLensCount: receipt.result.surfacedLensCount,
        abstainedLensCount: receipt.result.abstainedLensCount,
        candidateCount: receipt.result.candidateCount,
        availableCandidateCount: receipt.result.availableCandidateCount,
        withheldCandidateCount: receipt.result.withheldCandidateCount,
        unavailableCandidateCount: receipt.result.unavailableCandidateCount,
        beatCount: receipt.result.beatCount,
      }) !== canonicalSha256(artifact.result) ||
      canonicalSha256(receipt.result.lenses) !== canonicalSha256(artifact.lenses.map((lens) => ({
        lens: lens.lens,
        state: lens.state,
        reasonCode: lens.reasonCode,
        candidateCount: lens.candidateCount,
      })))
    ) fail(resultPath, "receipt bytes or closure do not match the verified learning prep.");
    return {
      verification: {
        integrity: "stored_learning_prep_and_receipt_with_verified_current_caption" as const,
        jobId,
        artifactId,
        contentId: verifiedContentId,
        receiptArtifactId,
        receiptId: identity(verification.receiptId, `${resultPath}.verification.receiptId`),
        receiptContentId,
        caption: captionIdentity,
        fineTune,
        executor,
        result: resultCounts,
      },
      artifact,
      receipt,
    };
  }));
  for (const attempt of attempts) {
    const result = results.find((candidate) => candidate.verification.jobId === attempt.jobId);
    if ((attempt.status === "completed") !== Boolean(result)) {
      fail(context, "completed attempts and verified results do not close one-to-one.");
    }
    if (result && (
      result.artifact.grant.attempt !== attempt.attempt ||
      canonicalSha256(result.verification.caption) !== canonicalSha256(attempt.caption) ||
      canonicalSha256(result.verification.fineTune) !== canonicalSha256(attempt.fineTune)
    )) fail(context, "a completed attempt does not match its verified result.");
  }
  if (results.some((result) => !attempts.some((attempt) =>
    attempt.status === "completed" && attempt.jobId === result.verification.jobId))) {
    fail(context, "a verified result has no completed attempt.");
  }
  return {
    schema: "studio.local-runtime-learning-preps.v1",
    commandId: identity(item.commandId, `${context}.commandId`),
    runtimeId,
    journalHead: integer(item.journalHead, `${context}.journalHead`),
    attempts,
    results,
  };
}
