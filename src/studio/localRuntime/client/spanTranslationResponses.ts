import { canonicalJsonLine, identifyUtf8 } from "../../runtime/production/observability/hash.ts";
import { canonicalSha256 } from "../../runtime/production/canonicalIdentity.ts";
import type { RuntimeHostSpanTranslationResponse } from "../../runtime/production/runtimeHost/model.ts";
import {
  validateSpanTranslationArtifact,
  validateSpanTranslationExecutorDescriptor,
  validateSpanTranslationReceipt,
} from "../../runtime/production/validation/spanTranslations.ts";
import {
  contentId,
  exact,
  fail,
  identity,
  integer,
  object,
} from "./responseGuards.ts";

function parseExecutor(value: unknown, path: string) {
  try {
    return validateSpanTranslationExecutorDescriptor(value, "Runtime host span translations", path);
  } catch (error) {
    fail(path, `executor descriptor is invalid: ${error instanceof Error ? error.message : "validation failed"}`);
  }
}

function parseSelection(value: unknown, path: string) {
  const selection = object(value, path);
  exact(selection, ["side", "unit", "start", "end", "text"], path);
  if ((selection.side !== "source" && selection.side !== "target") || selection.unit !== "unicode_code_point" || typeof selection.text !== "string") {
    fail(path, "is not a closed code-point span.");
  }
  const selectionValue = {
    side: selection.side as "source" | "target",
    unit: "unicode_code_point" as const,
    start: integer(selection.start, `${path}.start`),
    end: integer(selection.end, `${path}.end`, 1),
    text: selection.text,
  };
  if (selectionValue.end <= selectionValue.start || Array.from(selectionValue.text).length !== selectionValue.end - selectionValue.start) {
    fail(path, "does not close its exact code-point count.");
  }
  return selectionValue;
}

function parseCaption(value: unknown, path: string) {
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

export async function spanTranslationResponse(
  value: unknown,
  expectedRuntimeId: string,
): Promise<RuntimeHostSpanTranslationResponse> {
  const context = "Runtime host span translations";
  const item = object(value, context);
  exact(item, ["schema", "commandId", "runtimeId", "journalHead", "attempts", "results"], context);
  if (item.schema !== "studio.local-runtime-span-translations.v1") {
    fail(context, "schema is unsupported.");
  }
  const runtimeId = identity(item.runtimeId, `${context}.runtimeId`);
  if (runtimeId !== expectedRuntimeId) fail(context, "runtime identity changed.");
  if (!Array.isArray(item.attempts)) fail(`${context}.attempts`, "must be an array.");
  const attemptJobIds = new Set<string>();
  const attempts = item.attempts.map((candidate, index) => {
    const attemptPath = `${context}.attempts[${index}]`;
    const attempt = object(candidate, attemptPath);
    exact(attempt, ["jobId", "attempt", "caption", "lineId", "selection", "status", "failure"], attemptPath);
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
      caption: parseCaption(attempt.caption, `${attemptPath}.caption`),
      lineId: identity(attempt.lineId, `${attemptPath}.lineId`),
      selection: parseSelection(attempt.selection, `${attemptPath}.selection`),
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
      "lineId",
      "selection",
      "executor",
      "result",
    ], `${resultPath}.verification`);
    if (verification.integrity !== "stored_translation_and_receipt_with_verified_current_caption") {
      fail(`${resultPath}.verification.integrity`, "does not carry closed span-translation verification.");
    }
    const jobId = identity(verification.jobId, `${resultPath}.verification.jobId`);
    if (jobIds.has(jobId)) fail(`${resultPath}.verification.jobId`, "is duplicated.");
    jobIds.add(jobId);
    const artifact = validateSpanTranslationArtifact(
      result.artifact,
      context,
      `results[${index}].artifact`,
    );
    const receipt = validateSpanTranslationReceipt(
      result.receipt,
      context,
      `results[${index}].receipt`,
    );
    const captionIdentity = parseCaption(verification.caption, `${resultPath}.verification.caption`);
    const selectionValue = parseSelection(verification.selection, `${resultPath}.verification.selection`);
    const executor = parseExecutor(verification.executor, `${resultPath}.verification.executor`);
    const verifiedResult = object(verification.result, `${resultPath}.verification.result`);
    exact(verifiedResult, ["status"], `${resultPath}.verification.result`);
    if (!["completed", "withheld", "unavailable"].includes(verifiedResult.status as string)) {
      fail(`${resultPath}.verification.result.status`, "is unsupported.");
    }
    const resultValue = { status: verifiedResult.status as "completed" | "withheld" | "unavailable" };
    const artifactId = identity(verification.artifactId, `${resultPath}.verification.artifactId`);
    const verifiedContentId = contentId(verification.contentId, `${resultPath}.verification.contentId`);
    const receiptArtifactId = identity(verification.receiptArtifactId, `${resultPath}.verification.receiptArtifactId`);
    const receiptContentId = contentId(verification.receiptContentId, `${resultPath}.verification.receiptContentId`);
    const lineId = identity(verification.lineId, `${resultPath}.verification.lineId`);
    if (
      artifact.runId !== runtimeId || artifact.jobId !== jobId ||
      artifact.input.line.lineId !== lineId ||
      JSON.stringify(artifact.input.caption) !== JSON.stringify(captionIdentity) ||
      JSON.stringify(artifact.input.selection) !== JSON.stringify(selectionValue) ||
      JSON.stringify(artifact.executor) !== JSON.stringify(executor) ||
      JSON.stringify(artifact.result) !== JSON.stringify(resultValue) ||
      artifactId !== `artifact:${canonicalSha256({
        runId: runtimeId,
        jobId,
        kind: "span-translation-output",
        contentId: verifiedContentId,
      })}` ||
      receiptArtifactId !== `artifact:${canonicalSha256({
        runId: runtimeId,
        jobId,
        kind: "span-translation-receipt",
        contentId: receiptContentId,
      })}`
    ) fail(resultPath, "verification identities, selection, executor, or result do not match the artifact.");
    const measured = await identifyUtf8(canonicalJsonLine(artifact));
    if (measured.contentId !== verifiedContentId) {
      fail(resultPath, "artifact bytes do not match the verified span-translation content identity.");
    }
    const measuredReceipt = await identifyUtf8(canonicalJsonLine(receipt));
    const receiptBody = structuredClone(receipt) as unknown as Record<string, unknown>;
    delete receiptBody.schema;
    delete receiptBody.receiptId;
    if (
      measuredReceipt.contentId !== receiptContentId ||
      receipt.receiptId !== identity(verification.receiptId, `${resultPath}.verification.receiptId`) ||
      receipt.receiptId !== `span-translation-receipt:${canonicalSha256(receiptBody)}` ||
      receipt.jobId !== jobId ||
      JSON.stringify(receipt.grant) !== JSON.stringify(artifact.grant) ||
      JSON.stringify(receipt.input) !== JSON.stringify(artifact.input) ||
      JSON.stringify(receipt.producer.executor) !== JSON.stringify(artifact.executor) ||
      receipt.result.artifactId !== artifactId ||
      receipt.result.contentId !== verifiedContentId ||
      receipt.result.bytes !== measured.bytes ||
      receipt.result.status !== artifact.result.status ||
      receipt.result.availability !== artifact.translation.availability ||
      receipt.result.reasonCode !== artifact.translation.reasonCode
    ) fail(resultPath, "receipt bytes or closure do not match the verified span translation.");
    return {
      verification: {
        integrity: "stored_translation_and_receipt_with_verified_current_caption" as const,
        jobId,
        artifactId,
        contentId: verifiedContentId,
        receiptArtifactId,
        receiptId: identity(verification.receiptId, `${resultPath}.verification.receiptId`),
        receiptContentId,
        caption: captionIdentity,
        lineId,
        selection: selectionValue,
        executor,
        result: resultValue,
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
      result.verification.lineId !== attempt.lineId ||
      canonicalSha256(result.verification.caption) !== canonicalSha256(attempt.caption) ||
      canonicalSha256(result.verification.selection) !== canonicalSha256(attempt.selection)
    )) fail(context, "a completed attempt does not match its verified result.");
  }
  if (results.some((result) => !attempts.some((attempt) =>
    attempt.status === "completed" && attempt.jobId === result.verification.jobId))) {
    fail(context, "a verified result has no completed attempt.");
  }
  return {
    schema: "studio.local-runtime-span-translations.v1",
    commandId: identity(item.commandId, `${context}.commandId`),
    runtimeId,
    journalHead: integer(item.journalHead, `${context}.journalHead`),
    attempts,
    results,
  };
}
