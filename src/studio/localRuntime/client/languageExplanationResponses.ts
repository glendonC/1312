import { canonicalJsonLine, identifyUtf8 } from "../../runtime/production/observability/hash.ts";
import { canonicalSha256 } from "../../runtime/production/canonicalIdentity.ts";
import type { RuntimeHostLanguageExplanationResponse } from "../../runtime/production/runtimeHost/model.ts";
import {
  validateLanguageExplanationArtifact,
  validateLanguageExplanationExecutorDescriptor,
  validateLanguageExplanationReceipt,
} from "../../runtime/production/validation/languageExplanations.ts";
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
    return validateLanguageExplanationExecutorDescriptor(value, "Runtime host language explanations", path);
  } catch (error) {
    fail(path, `executor descriptor is invalid: ${error instanceof Error ? error.message : "validation failed"}`);
  }
}

export async function languageExplanationResponse(
  value: unknown,
  expectedRuntimeId: string,
): Promise<RuntimeHostLanguageExplanationResponse> {
  const context = "Runtime host language explanations";
  const item = object(value, context);
  exact(item, ["schema", "commandId", "runtimeId", "journalHead", "attempts", "results"], context);
  if (item.schema !== "studio.local-runtime-language-explanations.v1") {
    fail(context, "schema is unsupported.");
  }
  const runtimeId = identity(item.runtimeId, `${context}.runtimeId`);
  if (runtimeId !== expectedRuntimeId) fail(context, "runtime identity changed.");
  if (!Array.isArray(item.attempts)) fail(`${context}.attempts`, "must be an array.");
  const attemptJobIds = new Set<string>();
  const attempts = item.attempts.map((candidate, index) => {
    const attemptPath = `${context}.attempts[${index}]`;
    const attempt = object(candidate, attemptPath);
    exact(attempt, ["jobId", "attempt", "caption", "lineId", "selection", "facetKinds", "status", "failure"], attemptPath);
    const jobId = identity(attempt.jobId, `${attemptPath}.jobId`);
    if (attemptJobIds.has(jobId)) fail(`${attemptPath}.jobId`, "is duplicated.");
    attemptJobIds.add(jobId);
    const caption = object(attempt.caption, `${attemptPath}.caption`);
    exact(caption, ["jobId", "artifactId", "contentId", "receiptArtifactId", "receiptId", "receiptContentId"], `${attemptPath}.caption`);
    const selection = object(attempt.selection, `${attemptPath}.selection`);
    exact(selection, ["side", "unit", "start", "end", "text"], `${attemptPath}.selection`);
    if ((selection.side !== "source" && selection.side !== "target") || selection.unit !== "unicode_code_point" || typeof selection.text !== "string") {
      fail(`${attemptPath}.selection`, "is not a closed code-point span.");
    }
    const selectionValue = {
      side: selection.side as "source" | "target",
      unit: "unicode_code_point" as const,
      start: integer(selection.start, `${attemptPath}.selection.start`),
      end: integer(selection.end, `${attemptPath}.selection.end`, 1),
      text: selection.text,
    };
    if (selectionValue.end <= selectionValue.start || Array.from(selectionValue.text).length !== selectionValue.end - selectionValue.start) {
      fail(`${attemptPath}.selection`, "does not close its exact code-point count.");
    }
    if (!Array.isArray(attempt.facetKinds) || attempt.facetKinds.length === 0 ||
        attempt.facetKinds.some((kind) => !["meaning", "word", "phrase", "grammar", "translation_choice"].includes(kind as string)) ||
        new Set(attempt.facetKinds).size !== attempt.facetKinds.length) {
      fail(`${attemptPath}.facetKinds`, "must contain unique closed facet kinds.");
    }
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
      caption: {
        jobId: identity(caption.jobId, `${attemptPath}.caption.jobId`),
        artifactId: identity(caption.artifactId, `${attemptPath}.caption.artifactId`),
        contentId: contentId(caption.contentId, `${attemptPath}.caption.contentId`),
        receiptArtifactId: identity(caption.receiptArtifactId, `${attemptPath}.caption.receiptArtifactId`),
        receiptId: identity(caption.receiptId, `${attemptPath}.caption.receiptId`),
        receiptContentId: contentId(caption.receiptContentId, `${attemptPath}.caption.receiptContentId`),
      },
      lineId: identity(attempt.lineId, `${attemptPath}.lineId`),
      selection: selectionValue,
      facetKinds: attempt.facetKinds as Array<"meaning" | "word" | "phrase" | "grammar" | "translation_choice">,
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
    if (verification.integrity !== "stored_explanation_and_receipt_with_verified_current_caption") {
      fail(`${resultPath}.verification.integrity`, "does not carry closed language-explanation verification.");
    }
    const jobId = identity(verification.jobId, `${resultPath}.verification.jobId`);
    if (jobIds.has(jobId)) fail(`${resultPath}.verification.jobId`, "is duplicated.");
    jobIds.add(jobId);
    const artifact = validateLanguageExplanationArtifact(
      result.artifact,
      context,
      `results[${index}].artifact`,
    );
    const receipt = validateLanguageExplanationReceipt(
      result.receipt,
      context,
      `results[${index}].receipt`,
    );
    const caption = object(verification.caption, `${resultPath}.verification.caption`);
    exact(caption, ["jobId", "artifactId", "contentId", "receiptArtifactId", "receiptId", "receiptContentId"], `${resultPath}.verification.caption`);
    const captionIdentity = {
      jobId: identity(caption.jobId, `${resultPath}.verification.caption.jobId`),
      artifactId: identity(caption.artifactId, `${resultPath}.verification.caption.artifactId`),
      contentId: contentId(caption.contentId, `${resultPath}.verification.caption.contentId`),
      receiptArtifactId: identity(caption.receiptArtifactId, `${resultPath}.verification.caption.receiptArtifactId`),
      receiptId: identity(caption.receiptId, `${resultPath}.verification.caption.receiptId`),
      receiptContentId: contentId(caption.receiptContentId, `${resultPath}.verification.caption.receiptContentId`),
    };
    const selection = object(verification.selection, `${resultPath}.verification.selection`);
    exact(selection, ["side", "unit", "start", "end", "text"], `${resultPath}.verification.selection`);
    if (
      (selection.side !== "source" && selection.side !== "target") ||
      selection.unit !== "unicode_code_point" ||
      typeof selection.text !== "string"
    ) fail(`${resultPath}.verification.selection`, "is not a closed code-point span.");
    const selectionValue = {
      side: selection.side as "source" | "target",
      unit: "unicode_code_point" as const,
      start: integer(selection.start, `${resultPath}.verification.selection.start`),
      end: integer(selection.end, `${resultPath}.verification.selection.end`, 1),
      text: selection.text,
    };
    if (selectionValue.end <= selectionValue.start || Array.from(selectionValue.text).length !== selectionValue.end - selectionValue.start) {
      fail(`${resultPath}.verification.selection`, "does not close its exact code-point count.");
    }
    const executor = parseExecutor(verification.executor, `${resultPath}.verification.executor`);
    const verifiedResult = object(verification.result, `${resultPath}.verification.result`);
    exact(verifiedResult, ["status", "requestedFacetCount", "availableFacetCount", "withheldFacetCount", "unavailableFacetCount"], `${resultPath}.verification.result`);
    if (!["completed", "partial", "unavailable"].includes(verifiedResult.status as string)) {
      fail(`${resultPath}.verification.result.status`, "is unsupported.");
    }
    const resultCounts = {
      status: verifiedResult.status as "completed" | "partial" | "unavailable",
      requestedFacetCount: integer(verifiedResult.requestedFacetCount, `${resultPath}.verification.result.requestedFacetCount`, 1),
      availableFacetCount: integer(verifiedResult.availableFacetCount, `${resultPath}.verification.result.availableFacetCount`),
      withheldFacetCount: integer(verifiedResult.withheldFacetCount, `${resultPath}.verification.result.withheldFacetCount`),
      unavailableFacetCount: integer(verifiedResult.unavailableFacetCount, `${resultPath}.verification.result.unavailableFacetCount`),
    };
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
      JSON.stringify(artifact.result) !== JSON.stringify(resultCounts) ||
      artifactId !== `artifact:${canonicalSha256({
        runId: runtimeId,
        jobId,
        kind: "language-explanation-output",
        contentId: verifiedContentId,
      })}` ||
      receiptArtifactId !== `artifact:${canonicalSha256({
        runId: runtimeId,
        jobId,
        kind: "language-explanation-receipt",
        contentId: receiptContentId,
      })}`
    ) fail(resultPath, "verification identities, selection, executor, or counts do not match the artifact.");
    const measured = await identifyUtf8(canonicalJsonLine(artifact));
    if (measured.contentId !== verifiedContentId) {
      fail(resultPath, "artifact bytes do not match the verified language-explanation content identity.");
    }
    const measuredReceipt = await identifyUtf8(canonicalJsonLine(receipt));
    const receiptBody = structuredClone(receipt) as unknown as Record<string, unknown>;
    delete receiptBody.schema;
    delete receiptBody.receiptId;
    if (
      measuredReceipt.contentId !== receiptContentId ||
      receipt.receiptId !== identity(verification.receiptId, `${resultPath}.verification.receiptId`) ||
      receipt.receiptId !== `language-explanation-receipt:${canonicalSha256(receiptBody)}` ||
      receipt.jobId !== jobId ||
      JSON.stringify(receipt.grant) !== JSON.stringify(artifact.grant) ||
      JSON.stringify(receipt.input) !== JSON.stringify(artifact.input) ||
      JSON.stringify(receipt.producer.executor) !== JSON.stringify(artifact.executor) ||
      receipt.result.artifactId !== artifactId ||
      receipt.result.contentId !== verifiedContentId ||
      receipt.result.bytes !== measured.bytes ||
      canonicalSha256({
        status: receipt.result.status,
        requestedFacetCount: receipt.result.requestedFacetCount,
        availableFacetCount: receipt.result.availableFacetCount,
        withheldFacetCount: receipt.result.withheldFacetCount,
        unavailableFacetCount: receipt.result.unavailableFacetCount,
      }) !== canonicalSha256(artifact.result) ||
      canonicalSha256(receipt.result.facets) !== canonicalSha256(artifact.facets.map((facet) => ({
        kind: facet.kind,
        availability: facet.availability,
        reasonCode: facet.reasonCode,
      })))
    ) fail(resultPath, "receipt bytes or closure do not match the verified language explanation.");
    return {
      verification: {
        integrity: "stored_explanation_and_receipt_with_verified_current_caption" as const,
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
      result.verification.lineId !== attempt.lineId ||
      canonicalSha256(result.verification.caption) !== canonicalSha256(attempt.caption) ||
      canonicalSha256(result.verification.selection) !== canonicalSha256(attempt.selection) ||
      canonicalSha256(result.artifact.grant.facetKinds) !== canonicalSha256(attempt.facetKinds)
    )) fail(context, "a completed attempt does not match its verified result.");
  }
  if (results.some((result) => !attempts.some((attempt) =>
    attempt.status === "completed" && attempt.jobId === result.verification.jobId))) {
    fail(context, "a verified result has no completed attempt.");
  }
  return {
    schema: "studio.local-runtime-language-explanations.v1",
    commandId: identity(item.commandId, `${context}.commandId`),
    runtimeId,
    journalHead: integer(item.journalHead, `${context}.journalHead`),
    attempts,
    results,
  };
}
