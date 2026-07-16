import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  DurableRuntimeCommandStore,
  DeterministicRuntimeExecutor,
  RuntimeSourceRegistry,
  RuntimeStartService,
} from "../src/studio/runtime/production/runtimeHost/index.ts";
import type {
  RuntimeHostCaptionProductionRequest,
  RuntimeHostPublishReviewDecisionResponse,
  RuntimeHostStartRequest,
} from "../src/studio/runtime/production/runtimeHost/model.ts";
import { readValidatedRuntimeJournal } from "../src/studio/runtime/production/runtimeHost/journalPolling.ts";
import { validateCaptionProductionArtifact } from "../src/studio/runtime/production/validation/captionProduction.ts";
import { LocalRuntimeHostClient } from "../src/studio/localRuntime/client.ts";
import { adaptProductionRuntime } from "../src/studio/runtime/production/studioProjection.ts";
import { buildRuntimeObservabilityIndex } from "../src/studio/runtime/production/observability/indexer.ts";

const FIXTURE = resolve("public/demo/runs/run-005");

interface Harness {
  directory: string;
  store: DurableRuntimeCommandStore;
  service: RuntimeStartService;
  request: RuntimeHostStartRequest;
}

async function harness(): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), "studio-caption-production-test-"));
  const sources = await RuntimeSourceRegistry.open({ sourceDirectories: [FIXTURE] });
  const store = await DurableRuntimeCommandStore.open(join(directory, "host"));
  const service = await RuntimeStartService.open({
    store,
    sources,
    launcherFactory: new DeterministicRuntimeExecutor().factory(),
    recoverOnOpen: false,
  });
  const source = sources.list()[0];
  return {
    directory,
    store,
    service,
    request: {
      sourceSessionId: source.sourceSessionId,
      sourceRevisionId: source.sourceRevisionId,
      range: { startMs: 0, endMs: 47_200 },
      requestedSourceLanguage: { mode: "declared", languages: ["ko"], reason: null },
      targetLanguage: "en",
      selectedLanguagePackId: "ko-v3",
      outputDepth: "captions",
    },
  };
}

async function terminal(service: RuntimeStartService, commandId: string): Promise<void> {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    if ((await service.statusByCommand(commandId)).terminal) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  assert.fail("runtime did not become terminal");
}

async function approved(
  runtime: Harness,
): Promise<{ runtimeId: string; response: RuntimeHostPublishReviewDecisionResponse; request: RuntimeHostCaptionProductionRequest }> {
  const acknowledgement = await runtime.service.start(runtime.request);
  await terminal(runtime.service, acknowledgement.commandId);
  const intake = (await runtime.service.publishReviewIntakes(acknowledgement.runtimeId)).intakes[0];
  assert.ok(intake);
  const authority = await runtime.service.publishReviewDecisions(acknowledgement.runtimeId);
  const response = await runtime.service.createPublishReviewDecision(acknowledgement.runtimeId, {
    intake: {
      intakeId: intake.intakeId,
      artifactId: intake.artifactId,
      receiptId: intake.receiptId,
      receiptContentId: intake.receiptContentId,
    },
    reviewer: { id: authority.reviewer.id, attestation: authority.reviewer.decisionAttestation },
    decision: {
      outcome: "approve_for_caption_production",
      reasonCodes: ["reviewer_attested_caption_production_may_proceed"],
      note: null,
    },
  });
  const approval = response.reviews[0];
  return {
    runtimeId: acknowledgement.runtimeId,
    response,
    request: {
      approval: {
        reviewId: approval.reviewId,
        artifactId: approval.artifactId,
        receiptId: approval.receiptId,
        receiptContentId: approval.receiptContentId,
      },
    },
  };
}

test("V1 and an unapproved run expose no captions; raw bytes, paths, and final prose are rejected", async () => {
  const runtime = await harness();
  try {
    const acknowledgement = await runtime.service.start(runtime.request);
    await terminal(runtime.service, acknowledgement.commandId);
    assert.deepEqual((await runtime.service.captionProductions(acknowledgement.runtimeId)).captions, []);
    assert.deepEqual((await runtime.service.captionProductionResults(acknowledgement.runtimeId)).results, []);
    const fake = {
      approval: {
        reviewId: "publish-review:unapproved",
        artifactId: "artifact:unapproved",
        receiptId: "publish-review-decision-receipt:unapproved",
        receiptContentId: `sha256:${"a".repeat(64)}`,
      },
    };
    await assert.rejects(
      runtime.service.createCaptionProduction(acknowledgement.runtimeId, fake),
      /exact recursively verified unrevoked approval/,
    );
    for (const open of [
      { ...fake, reviewBytes: "already reviewed" },
      { ...fake, sourcePath: "/tmp/media" },
      { ...fake, captions: [{ ko: "caller", en: "final" }] },
    ]) {
      await assert.rejects(
        runtime.service.createCaptionProduction(acknowledgement.runtimeId, open),
        /invalid or contains open fields/,
      );
    }
    const journal = await readValidatedRuntimeJournal(
      runtime.store.paths(acknowledgement.runtimeId).journalPath,
      acknowledgement.runtimeId,
    );
    assert.equal(Object.keys(journal.state.captionProductions).length, 0);
    assert.equal(journal.events.some((event) => event.type.startsWith("caption.production_")), false);
  } finally {
    await rm(runtime.directory, { recursive: true, force: true });
  }
});

test("exact approval produces immutable timed KO+EN artifacts with honest withheld counts", async () => {
  const runtime = await harness();
  try {
    const approval = await approved(runtime);
    const result = await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
    assert.equal(result.schema, "studio.local-runtime-caption-productions.v1");
    assert.equal(result.captions.length, 1);
    const caption = result.captions[0];
    assert.equal(caption.integrity, "stored_caption_and_receipt_with_verified_approval");
    assert.equal(caption.authorityState, "unrevoked");
    assert.equal(caption.executor.classification, "recorded_real_pipeline_fixture");
    assert.deepEqual(caption.result, {
      status: "partial",
      lineCount: 16,
      sourceAvailableCount: 15,
      targetAvailableCount: 13,
      withheldCount: 2,
      unavailableCount: 1,
    });
    const productionResults = await runtime.service.captionProductionResults(approval.runtimeId);
    assert.equal(productionResults.schema, "studio.local-runtime-caption-production-results.v1");
    assert.equal(productionResults.results.length, 1);
    assert.deepEqual(productionResults.results[0].verification, caption);
    assert.equal(productionResults.results[0].artifact.runId, approval.runtimeId);
    assert.equal(productionResults.results[0].artifact.lines.length, 16);
    assert.deepEqual(
      productionResults.results[0].artifact.lines.map((line) => [line.source.language, line.target.language]),
      Array.from({ length: 16 }, () => ["ko", "en"]),
    );
    const digest = caption.captionContentId.replace("sha256:", "");
    const value = JSON.parse(await readFile(join(
      runtime.store.paths(approval.runtimeId).artifactStoreRoot,
      "objects",
      "sha256",
      digest.slice(0, 2),
      digest,
    ), "utf8")) as unknown;
    const artifact = validateCaptionProductionArtifact(value);
    assert.deepEqual(artifact.lines.map((line) => [line.source.language, line.target.language]),
      Array.from({ length: 16 }, () => ["ko", "en"]));
    assert.equal(artifact.lines.filter((line) => line.target.state === "withheld").length, 2);
    assert.ok(artifact.lines.filter((line) => line.target.state === "withheld")
      .every((line) => line.target.text === null && line.target.reasonCode === "recorded_quality_gate_withheld"));

    const journal = await readValidatedRuntimeJournal(
      runtime.store.paths(approval.runtimeId).journalPath,
      approval.runtimeId,
    );
    assert.equal(journal.events.filter((event) => event.type === "caption.production_started").length, 1);
    assert.equal(journal.events.filter((event) => event.type === "caption.production_completed").length, 1);
    assert.equal(Object.values(journal.state.captionProductions)[0].status, "completed");
    const projection = adaptProductionRuntime(journal.state);
    assert.equal(projection.captionProductions.length, 1);
    assert.equal(projection.captionProductions[0].lineCount, 16);
    assert.equal(projection.captionProductions[0].withheldCount, 2);
    assert.equal(projection.captionArtifacts.length, 2);
    const observability = await buildRuntimeObservabilityIndex(await readFile(
      runtime.store.paths(approval.runtimeId).journalPath,
      "utf8",
    ));
    assert.equal(observability.sources.receipts.filter((source) =>
      source.kind === "caption_production").length, 1);
    assert.equal(observability.sources.artifacts.filter((source) =>
      source.kind.startsWith("caption-production-")).length, 2);

    let requestedPath = "";
    let requestedBody = "";
    const client = new LocalRuntimeHostClient({
      baseUrl: "http://127.0.0.1:4312",
      token: "caption-test-token",
      fetch: async (input, init) => {
        requestedPath = String(input);
        requestedBody = String(init?.body ?? "");
        return new Response(JSON.stringify(result), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    assert.deepEqual(await client.createCaptionProduction(approval.runtimeId, approval.request), result);
    assert.match(requestedPath, /\/caption-productions$/);
    assert.deepEqual(JSON.parse(requestedBody), approval.request);
    const resultsClient = new LocalRuntimeHostClient({
      baseUrl: "http://127.0.0.1:4312",
      token: "caption-test-token",
      fetch: async () => new Response(JSON.stringify(productionResults), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    });
    assert.deepEqual(await resultsClient.captionProductionResults(approval.runtimeId), productionResults);
    const mismatchedResults = structuredClone(productionResults);
    mismatchedResults.results[0].artifact.jobId = "caption-production:mismatched";
    const mismatchedClient = new LocalRuntimeHostClient({
      baseUrl: "http://127.0.0.1:4312",
      token: "caption-test-token",
      fetch: async () => new Response(JSON.stringify(mismatchedResults), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    });
    await assert.rejects(
      mismatchedClient.captionProductionResults(approval.runtimeId),
      /verified identities, executor, or result counts do not match the artifact/,
    );
    const tamperedResults = structuredClone(productionResults);
    const originalSourceText = tamperedResults.results[0].artifact.lines[0].source.text;
    assert.notEqual(originalSourceText, null);
    tamperedResults.results[0].artifact.lines[0].source.text = `${originalSourceText} tampered`;
    const tamperedClient = new LocalRuntimeHostClient({
      baseUrl: "http://127.0.0.1:4312",
      token: "caption-test-token",
      fetch: async () => new Response(JSON.stringify(tamperedResults), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    });
    await assert.rejects(
      tamperedClient.captionProductionResults(approval.runtimeId),
      /artifact bytes do not match the verified caption content identity/,
    );
    const tamperedResponse = structuredClone(result) as unknown as {
      captions: Array<{ result: { lineCount: number } }>;
    };
    tamperedResponse.captions[0].result.lineCount = 65;
    const rejectingClient = new LocalRuntimeHostClient({
      baseUrl: "http://127.0.0.1:4312",
      token: "caption-test-token",
      fetch: async () => new Response(JSON.stringify(tamperedResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    });
    await assert.rejects(
      rejectingClient.captionProductions(approval.runtimeId),
      /counts exceed the closed line ceiling/,
    );
  } finally {
    await rm(runtime.directory, { recursive: true, force: true });
  }
});

test("revocation blocks new starts and later revocation supersedes authority without deleting prior artifacts", async () => {
  const blocked = await harness();
  try {
    const approval = await approved(blocked);
    await blocked.service.createPublishReviewRevocation(approval.runtimeId, {
      approval: approval.request.approval,
      reviewer: {
        id: approval.response.reviewer.id,
        attestation: approval.response.reviewer.revocationAttestation,
      },
      revocation: { reasonCodes: ["new_review_required"], note: null },
    });
    await assert.rejects(
      blocked.service.createCaptionProduction(approval.runtimeId, approval.request),
      /exact recursively verified unrevoked approval/,
    );
    assert.deepEqual((await blocked.service.captionProductions(approval.runtimeId)).captions, []);
    assert.deepEqual((await blocked.service.captionProductionResults(approval.runtimeId)).results, []);
  } finally {
    await rm(blocked.directory, { recursive: true, force: true });
  }

  const completed = await harness();
  try {
    const approval = await approved(completed);
    const produced = await completed.service.createCaptionProduction(approval.runtimeId, approval.request);
    const identities = produced.captions[0];
    await completed.service.createPublishReviewRevocation(approval.runtimeId, {
      approval: approval.request.approval,
      reviewer: {
        id: approval.response.reviewer.id,
        attestation: approval.response.reviewer.revocationAttestation,
      },
      revocation: { reasonCodes: ["new_review_required"], note: null },
    });
    const retained = (await completed.service.captionProductions(approval.runtimeId)).captions[0];
    const retainedResult = (await completed.service.captionProductionResults(approval.runtimeId)).results[0];
    assert.equal(retained.authorityState, "revoked_after_completion");
    assert.equal(retainedResult.verification.authorityState, "revoked_after_completion");
    assert.equal(retained.captionArtifactId, identities.captionArtifactId);
    assert.equal(retained.receiptArtifactId, identities.receiptArtifactId);
  } finally {
    await rm(completed.directory, { recursive: true, force: true });
  }
});

test("caption read fails closed when content-addressed timed output is tampered", async () => {
  const runtime = await harness();
  try {
    const approval = await approved(runtime);
    const produced = await runtime.service.createCaptionProduction(approval.runtimeId, approval.request);
    const digest = produced.captions[0].captionContentId.replace("sha256:", "");
    await writeFile(join(
      runtime.store.paths(approval.runtimeId).artifactStoreRoot,
      "objects",
      "sha256",
      digest.slice(0, 2),
      digest,
    ), "{}\n", "utf8");
    await assert.rejects(
      runtime.service.captionProductions(approval.runtimeId),
      /failed closed validation/,
    );
    await assert.rejects(
      runtime.service.captionProductionResults(approval.runtimeId),
      /failed closed validation/,
    );
  } finally {
    await rm(runtime.directory, { recursive: true, force: true });
  }
});
