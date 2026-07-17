import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { projectRuntimeEvents } from "../../../src/studio/runtime/production/projection.ts";
import { loadRuntimeInspectorJournal } from "../../../src/studio/runtime/production/runtimeInspector/journalLoader.ts";
import {
  DeterministicExecutionControl,
  DeterministicRuntimeExecutor,
  RuntimeStartService,
  readValidatedRuntimeJournal,
} from "../../../src/studio/runtime/production/runtimeHost/index.ts";
import { cleanup, hostHarness, waitForLifecycle } from "./harness.ts";

test.skip("legacy slice-2 polling assertions await study-first projection replacement", async () => {
  const control = new DeterministicExecutionControl({ pauseBeforeFirstEvent: true });
  const runtime = await hostHarness({ control });
  try {
    const ack = await runtime.service.start(runtime.request);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const first = await runtime.service.poll(ack.runtimeId, 0, 2);
    assert.equal(first.requestedCursor, 0);
    assert.ok(first.events.length > 0 && first.events.length <= 2);
    assert.equal(first.nextCursor, first.events.at(-1)?.seq);
    assert.equal(first.events[0].seq, 1);
    await assert.rejects(runtime.service.poll(ack.runtimeId, Number.MAX_SAFE_INTEGER, 1), /cursor is beyond/);

    control.releaseBeforeFirstEvent();
    const terminalStatus = await waitForLifecycle(runtime.service, ack.commandId, "terminal");
    const collected = [];
    let cursor = 0;
    while (true) {
      const batch = await runtime.service.poll(ack.runtimeId, cursor, 3);
      collected.push(...batch.events);
      cursor = batch.nextCursor;
      if (batch.reachedHead) {
        assert.equal(batch.terminal, true);
        break;
      }
    }
    const atHead = await runtime.service.poll(ack.runtimeId, cursor, 3);
    assert.deepEqual(atHead.events, []);
    assert.equal(atHead.nextCursor, cursor);
    assert.equal(atHead.reachedHead, true);
    assert.equal(cursor, terminalStatus.journalHead);
    assert.equal(await runtime.store.hasLaunchClaim(ack.commandId), true);
    const direct = await readValidatedRuntimeJournal(runtime.store.paths(ack.runtimeId).journalPath, ack.runtimeId);
    assert.deepEqual(collected, direct.events);
    assert.deepEqual(projectRuntimeEvents(ack.runtimeId, collected), direct.state);
    const roundTripTypes = [
      "spawn.requested",
      "spawn.decided",
      "executor.finished",
      "report.submitted",
      "report.decided",
      "root.output_disposition_recorded",
    ];
    const roundTripIndexes = roundTripTypes.map((type) =>
      direct.events.findIndex((event) => event.type === type));
    assert.ok(roundTripIndexes.every((index) => index >= 0));
    assert.deepEqual(roundTripIndexes, [...roundTripIndexes].sort((left, right) => left - right));
    const rootDispositionEvent = direct.events.find((event) =>
      event.type === "root.output_disposition_recorded");
    assert.ok(rootDispositionEvent?.type === "root.output_disposition_recorded");
    const rootDisposition = rootDispositionEvent.data.receipt;
    const childRegisteredIndex = direct.events.findIndex((event) =>
      event.type === "agent.registered" &&
      event.data.agent.id === rootDisposition.delegation.childAgentId);
    assert.ok(childRegisteredIndex > roundTripIndexes[1] && childRegisteredIndex < roundTripIndexes[2]);
    assert.equal(rootDisposition.schema, "studio.root-output-disposition.receipt.v1");
    assert.equal(rootDisposition.decision.outcome, "promoted_to_root");
    assert.equal(rootDisposition.delegation.workerKind, "analysis");
    assert.deepEqual(
      rootDisposition.delegation.grants,
      direct.state.tasks[rootDisposition.delegation.childTaskId].grants,
    );
    assert.deepEqual(
      rootDisposition.delegation.mediaScope,
      direct.state.tasks[rootDisposition.delegation.childTaskId].mediaScope,
    );
    assert.equal(rootDisposition.input.artifactId, direct.state.reports[rootDisposition.report.reportId].outputArtifactIds[0]);
    assert.equal(Object.keys(direct.state.rootOutputDispositions).length, 1);
    assert.equal(
      direct.state.rootOutputDispositions[rootDisposition.dispositionId].outputArtifactId,
      rootDispositionEvent.data.outputArtifactId,
    );
    const rootDispositionArtifact = direct.state.artifacts[rootDispositionEvent.data.outputArtifactId];
    assert.equal(rootDispositionArtifact.origin.kind, "root_output_disposition");
    assert.deepEqual(rootDispositionArtifact.sourceArtifactIds, [rootDisposition.input.artifactId]);
    assert.equal(rootDispositionArtifact.producerTaskId, rootDisposition.authority.rootTaskId);
    assert.equal(rootDispositionArtifact.producerAgentId, rootDisposition.authority.rootAgentId);
    const changedGrant = structuredClone(direct.events);
    const changedGrantEvent = changedGrant.find((event) =>
      event.type === "root.output_disposition_recorded");
    assert.ok(changedGrantEvent?.type === "root.output_disposition_recorded");
    const mediaGrant = changedGrantEvent.data.receipt.delegation.grants.find((grant) =>
      grant.capability === "media.seek");
    assert.ok(mediaGrant?.mediaScope[0]);
    mediaGrant.mediaScope[0].startMs += 1;
    assert.throws(
      () => projectRuntimeEvents(ack.runtimeId, changedGrant),
      /changed spawn, scope, or grant lineage/,
    );
    const changedArtifactIdentity = structuredClone(direct.events);
    const changedArtifactEvent = changedArtifactIdentity.find((event) =>
      event.type === "root.output_disposition_recorded");
    assert.ok(changedArtifactEvent?.type === "root.output_disposition_recorded");
    changedArtifactEvent.data.receipt.input.contentId = `sha256:${"0".repeat(64)}`;
    assert.throws(
      () => projectRuntimeEvents(ack.runtimeId, changedArtifactIdentity),
      /changed child output identity/,
    );
    const inspector = await loadRuntimeInspectorJournal(
      await readFile(runtime.store.paths(ack.runtimeId).journalPath, "utf8"),
    );
    assert.equal(inspector.projection.runId, ack.runtimeId);
    assert.equal(inspector.projection.lastSeq, cursor);
    assert.equal(inspector.projection.tasks.length, 2);
    assert.equal(inspector.projection.workers.length, 2);
    assert.deepEqual(
      inspector.projection.grants.map((grant) => grant.capability).sort(),
      ["analysis.evidence.assess", "analysis.evidence.decide", "evidence.read", "media.seek", "report.submit", "task.reports.wait", "task.spawn.request"],
    );
    assert.equal(inspector.projection.reports.length, 1);
    assert.equal(inspector.projection.reports[0].status, "accepted");
    assert.equal(inspector.projection.spawnRequests.length, 1);
    assert.equal(inspector.projection.spawnRequests[0].decision, "accepted");
    assert.equal(inspector.projection.spawnRequests[0].requestedByTaskId, inspector.projection.tasks[0].taskId);
    assert.deepEqual(
      inspector.projection.spawnRequests[0].requiredCapabilities,
      ["analysis.evidence.assess", "analysis.evidence.decide", "evidence.read", "media.seek", "report.submit"],
    );
    assert.equal(inspector.projection.operations.length, 1);
    assert.equal(inspector.projection.operations[0].capability, "media.seek");
    assert.equal(inspector.projection.operations[0].status, "completed");
    assert.equal(inspector.projection.operations[0].observation?.kind, "audio_activity");
    assert.equal(inspector.projection.operations[0].observation?.value, "signal");
    assert.deepEqual(inspector.projection.operations[0].observation?.range, { startMs: 0, endMs: 1_000 });
    assert.equal(inspector.projection.evidenceArtifacts.length, 2);
    assert.deepEqual(
      inspector.projection.evidenceArtifacts.map((artifact) => artifact.evidenceKind).sort(),
      ["language_ranges", "speech_activity"],
    );
    assert.equal(inspector.projection.evidenceReads.length, 2);
    assert.ok(inspector.projection.evidenceReads.every((read) =>
      read.status === "completed" &&
      read.returnedItems !== null &&
      read.returnedFactBytes !== null &&
      read.returnedFactBytes <= read.maxBytes &&
      read.returnedItems <= read.maxItems &&
      read.receiptId !== null &&
      read.receiptContentId !== null));
    const evidenceGrant = inspector.projection.grants.find((grant) => grant.capability === "evidence.read");
    assert.ok(evidenceGrant);
    assert.equal(evidenceGrant.evidenceScope.length, 2);
    assert.ok(evidenceGrant.evidenceScope.every((scope) =>
      scope.sourceArtifactId === inspector.projection.sourceArtifacts[0].artifactId &&
      scope.startMs === 0 &&
      scope.endMs === 1_000 &&
      scope.maxBytes === 32 * 1024 &&
      scope.maxItems === 64));
    const completedReads = direct.events.filter((event) => event.type === "evidence.read_completed");
    assert.equal(completedReads.length, 2);
    assert.ok(completedReads.every((event) =>
      event.data.receipt.authorization.startMs === 0 &&
      event.data.receipt.authorization.endMs === 1_000 &&
      event.data.receipt.facts.every((fact) => fact.startMs >= 0 && fact.endMs <= 1_000)));
    assert.equal(inspector.projection.evidenceAssessments.length, 1);
    const assessment = inspector.projection.evidenceAssessments[0];
    assert.equal(assessment.status, "completed");
    assert.equal(assessment.readReceiptIds.length, 2);
    assert.equal(assessment.claimCount, 2);
    assert.ok(assessment.citationCount !== null && assessment.citationCount <= assessment.maxCitations);
    assert.ok(assessment.tokenCount !== null && assessment.tokenCount <= assessment.maxTokens);
    const assessmentGrant = inspector.projection.grants.find((grant) => grant.capability === "analysis.evidence.assess");
    assert.ok(assessmentGrant?.assessmentScope);
    assert.equal(assessmentGrant.assessmentScope.maxAssessments, 1);
    assert.equal(assessmentGrant.assessmentScope.maxClaims, 8);
    assert.equal(assessmentGrant.assessmentScope.maxCitations, 32);
    assert.equal(assessmentGrant.assessmentScope.maxTokens, 512);
    assert.equal(inspector.projection.assessmentArtifacts.length, 1);
    assert.equal(inspector.projection.assessmentArtifacts[0].receiptId, assessment.receiptId);
    assert.equal(inspector.projection.evidenceDecisions.length, 1);
    const decision = inspector.projection.evidenceDecisions[0];
    assert.equal(decision.status, "completed");
    assert.deepEqual(decision.assessmentOperationIds, [assessment.operationId]);
    assert.equal(decision.outcome === "withheld" || decision.outcome === "proceed_to_publish_review", true);
    assert.ok(decision.reasonCodes.length > 0);
    const decisionGrant = inspector.projection.grants.find((grant) => grant.capability === "analysis.evidence.decide");
    assert.ok(decisionGrant?.decisionScope);
    assert.equal(decisionGrant.decisionScope.maxDecisions, 1);
    assert.equal(decisionGrant.decisionScope.maxAuditedAssessments, 4);
    assert.equal(inspector.projection.decisionArtifacts.length, 1);
    assert.equal(inspector.projection.decisionArtifacts[0].receiptId, decision.receiptId);
    assert.equal(inspector.projection.publishReviewIntakes.length, 1);
    assert.equal(inspector.projection.publishReviewIntakes[0].status, "completed");
    assert.equal(inspector.projection.publishReviewIntakes[0].outcome, "queued");
    assert.deepEqual(inspector.projection.publishReviewIntakes[0].reasonCodes, [
      "all_audited_claims_supported",
    ]);
    assert.equal(inspector.projection.publishReviewIntakeArtifacts.length, 1);
    assert.equal(
      inspector.projection.publishReviewIntakeArtifacts[0].readinessArtifactId,
      inspector.projection.studyReadiness[0].artifactId,
    );
    assert.equal(inspector.projection.outputArtifacts.length, 2);
    const workerOutput = inspector.projection.outputArtifacts.find((artifact) => artifact.origin.kind === "worker_output");
    const seekObservation = inspector.projection.outputArtifacts.find((artifact) => artifact.origin.kind === "media_observation");
    assert.ok(workerOutput);
    assert.ok(seekObservation);
    assert.equal(workerOutput.kind, "worker-execution-report");
    assert.deepEqual(workerOutput.sourceArtifactIds, []);
    assert.deepEqual(seekObservation.sourceArtifactIds, [inspector.projection.sourceArtifacts[0].artifactId]);
    assert.deepEqual(
      workerOutput.reportIds,
      [inspector.projection.reports[0].reportId],
    );
    assert.deepEqual(seekObservation.reportIds, []);

    const assessmentAudit = await runtime.service.assessmentAudits(ack.runtimeId);
    assert.equal(assessmentAudit.schema, "studio.local-runtime-assessment-audits.v1");
    assert.equal(assessmentAudit.commandId, ack.commandId);
    assert.equal(assessmentAudit.journalHead, cursor);
    assert.equal(assessmentAudit.audits.length, 1);
    assert.equal(assessmentAudit.audits[0].integrity, "stored_receipt_and_citations_verified");
    assert.equal(assessmentAudit.audits[0].claims.length, 2);
    assert.ok(assessmentAudit.audits[0].claims.every((claim) =>
      claim.range.endMs > claim.range.startMs &&
      claim.states.length > 0 &&
      claim.citations.length > 0 &&
      claim.citations.every((citation) =>
        citation.receiptId.startsWith("evidence-read:") &&
        citation.receiptContentId.startsWith("sha256:") &&
        citation.factIndexes.length > 0)));
    const completedAssessmentEvent = direct.events.find((event) =>
      event.type === "analysis.evidence.assessment_completed");
    assert.ok(completedAssessmentEvent?.type === "analysis.evidence.assessment_completed");
    assert.deepEqual(
      assessmentAudit.audits[0].claims.map((claim) => ({
        claimIndex: claim.claimIndex,
        kind: claim.kind,
        value: claim.value,
        range: claim.range,
        states: claim.states,
        citations: claim.citations.map(({ receiptId, receiptContentId, factIndexes }) => ({
          receiptId,
          receiptContentId,
          factIndexes,
        })),
      })),
      completedAssessmentEvent.data.receipt.claims,
    );
    const decisionReceipts = await runtime.service.decisionReceipts(ack.runtimeId);
    assert.equal(decisionReceipts.schema, "studio.local-runtime-decision-receipts.v1");
    assert.equal(decisionReceipts.commandId, ack.commandId);
    assert.equal(decisionReceipts.journalHead, cursor);
    assert.equal(decisionReceipts.decisions.length, 1);
    assert.equal(decisionReceipts.decisions[0].integrity, "stored_decision_and_audited_inputs_verified");
    assert.equal(decisionReceipts.decisions[0].producer, "deterministic_audit_state_gate_v1");
    assert.equal(decisionReceipts.decisions[0].outcome, decision.outcome);
    assert.deepEqual(decisionReceipts.decisions[0].reasonCodes, decision.reasonCodes);
    assert.deepEqual(decisionReceipts.decisions[0].inputs, [{
      operationId: assessment.operationId,
      artifactId: assessment.outputArtifactId,
      receiptId: assessment.receiptId,
      receiptContentId: assessment.receiptContentId,
    }]);
    const publishReviewIntakes = await runtime.service.publishReviewIntakes(ack.runtimeId);
    assert.equal(publishReviewIntakes.schema, "studio.local-runtime-publish-review-intakes.v1");
    assert.equal(publishReviewIntakes.commandId, ack.commandId);
    assert.equal(publishReviewIntakes.journalHead, cursor);
    assert.equal(publishReviewIntakes.intakes.length, 1);
    assert.equal(publishReviewIntakes.intakes[0].integrity, "stored_intake_and_verified_study_readiness");
    assert.equal(publishReviewIntakes.intakes[0].producer, "host_publish_review_intake_v1");
    assert.equal(publishReviewIntakes.intakes[0].outcome, "queued");
    assert.deepEqual(publishReviewIntakes.intakes[0].reasonCodes, []);
    assert.deepEqual(publishReviewIntakes.intakes[0].readiness, {
      readinessId: inspector.projection.studyReadiness[0].readinessId,
      artifactId: inspector.projection.studyReadiness[0].artifactId,
      receiptId: inspector.projection.studyReadiness[0].receiptId,
      receiptContentId: inspector.projection.studyReadiness[0].receiptContentId,
    });

    const reopened = await RuntimeStartService.open({
      store: runtime.store,
      sources: runtime.sources,
      launcherFactory: new DeterministicRuntimeExecutor().factory(),
      recoverOnOpen: true,
    });
    const continued = await reopened.poll(ack.runtimeId, cursor, 3);
    assert.deepEqual(continued.events, []);
    assert.equal(continued.nextCursor, cursor);
    assert.deepEqual(await reopened.assessmentAudits(ack.runtimeId), assessmentAudit);
    assert.deepEqual(await reopened.decisionReceipts(ack.runtimeId), decisionReceipts);
    assert.deepEqual(await reopened.publishReviewIntakes(ack.runtimeId), publishReviewIntakes);
  } finally {
    await cleanup(runtime);
  }
});
