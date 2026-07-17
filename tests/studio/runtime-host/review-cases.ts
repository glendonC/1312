import assert from "node:assert/strict";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { adaptProductionRuntime } from "../../../src/studio/runtime/production/studioProjection.ts";
import {
  DeterministicRuntimeExecutor,
  RuntimeStartService,
  readValidatedRuntimeJournal,
} from "../../../src/studio/runtime/production/runtimeHost/index.ts";
import { cleanup, hostHarness, waitForLifecycle } from "./harness.ts";

test("verified queued intake can be approved once and revoked only by a separate immutable receipt", async () => {
  const runtime = await hostHarness();
  try {
    const acknowledgement = await runtime.service.start(runtime.request);
    await waitForLifecycle(runtime.service, acknowledgement.commandId, "terminal");
    const intakeResponse = await runtime.service.publishReviewIntakes(acknowledgement.runtimeId);
    const intake = intakeResponse.intakes[0];
    assert.ok(intake);
    const empty = await runtime.service.publishReviewDecisions(acknowledgement.runtimeId);
    assert.deepEqual(empty.reviews, []);
    assert.deepEqual(empty.reviewer, {
      id: "reviewer:local-operator",
      label: "Local review operator",
      decisionAttestation: "I attest that I am the named reviewer and made this review decision.",
      revocationAttestation: "I attest that I am the named reviewer and made this revocation decision.",
    });

    const approved = await runtime.service.createPublishReviewDecision(acknowledgement.runtimeId, {
      intake: {
        intakeId: intake.intakeId,
        artifactId: intake.artifactId,
        receiptId: intake.receiptId,
        receiptContentId: intake.receiptContentId,
      },
      reviewer: {
        id: empty.reviewer.id,
        attestation: empty.reviewer.decisionAttestation,
      },
      decision: {
        outcome: "approve_for_caption_production",
        reasonCodes: ["reviewer_attested_caption_production_may_proceed"],
        note: "Ready for a future bounded caption producer.",
      },
    });
    assert.equal(approved.reviews.length, 1);
    assert.equal(approved.reviews[0].state, "approved_for_caption_production");
    assert.equal(approved.reviews[0].outcome, "approve_for_caption_production");
    assert.equal(approved.reviews[0].reviewer.id, empty.reviewer.id);
    assert.equal(approved.reviews[0].revocation, null);

    const approval = approved.reviews[0];
    const revoked = await runtime.service.createPublishReviewRevocation(acknowledgement.runtimeId, {
      approval: {
        reviewId: approval.reviewId,
        artifactId: approval.artifactId,
        receiptId: approval.receiptId,
        receiptContentId: approval.receiptContentId,
      },
      reviewer: {
        id: approved.reviewer.id,
        attestation: approved.reviewer.revocationAttestation,
      },
      revocation: {
        reasonCodes: ["new_review_required"],
        note: "New review is required before any caption producer may consume approval.",
      },
    });
    assert.equal(revoked.reviews[0].state, "approval_revoked");
    assert.equal(revoked.reviews[0].revocation?.integrity, "stored_revocation_and_verified_approval");
    assert.deepEqual(revoked.reviews[0].revocation?.reasonCodes, ["new_review_required"]);

    const journal = await readValidatedRuntimeJournal(
      runtime.store.paths(acknowledgement.runtimeId).journalPath,
      acknowledgement.runtimeId,
    );
    assert.equal(Object.keys(journal.state.publishReviewDecisions).length, 1);
    assert.equal(Object.keys(journal.state.publishReviewRevocations).length, 1);
    assert.equal(Object.values(journal.state.publishReviewDecisions)[0].status, "completed");
    assert.equal(Object.values(journal.state.publishReviewRevocations)[0].status, "completed");
    assert.equal(journal.events.filter((event) => event.type === "publish.review.decision_started").length, 1);
    assert.equal(journal.events.filter((event) => event.type === "publish.review.decision_completed").length, 1);
    assert.equal(journal.events.filter((event) => event.type === "publish.review.revocation_started").length, 1);
    assert.equal(journal.events.filter((event) => event.type === "publish.review.revocation_completed").length, 1);
    const productProjection = adaptProductionRuntime(journal.state);
    assert.equal(productProjection.publishReviewDecisions[0].outcome, "approve_for_caption_production");
    assert.equal(productProjection.publishReviewRevocations[0].status, "completed");
    assert.equal(productProjection.publishReviewDecisionArtifacts.length, 1);
    assert.equal(productProjection.publishReviewRevocationArtifacts.length, 1);
  } finally {
    await cleanup(runtime);
  }
});
test("rejected review cannot be replaced by approval and forged reviewer or open input is rejected", async () => {
  const runtime = await hostHarness();
  try {
    const acknowledgement = await runtime.service.start(runtime.request);
    await waitForLifecycle(runtime.service, acknowledgement.commandId, "terminal");
    const intake = (await runtime.service.publishReviewIntakes(acknowledgement.runtimeId)).intakes[0];
    const authority = (await runtime.service.publishReviewDecisions(acknowledgement.runtimeId)).reviewer;
    const identity = {
      intakeId: intake.intakeId,
      artifactId: intake.artifactId,
      receiptId: intake.receiptId,
      receiptContentId: intake.receiptContentId,
    };

    await assert.rejects(
      runtime.service.createPublishReviewDecision(acknowledgement.runtimeId, {
        intake: identity,
        reviewer: { id: "reviewer:forged", attestation: authority.decisionAttestation },
        decision: {
          outcome: "reject_with_reasons",
          reasonCodes: ["evidence_requires_additional_review"],
          note: null,
        },
      }),
      /does not match this host's configured review operator/,
    );
    await assert.rejects(
      runtime.service.createPublishReviewDecision(acknowledgement.runtimeId, {
        intake: identity,
        reviewer: { id: authority.id, attestation: authority.decisionAttestation },
        decision: {
          outcome: "reject_with_reasons",
          reasonCodes: ["evidence_requires_additional_review"],
          note: null,
        },
        captions: "caller-authored output is forbidden",
      }),
      /invalid or contains open fields/,
    );

    const rejected = await runtime.service.createPublishReviewDecision(acknowledgement.runtimeId, {
      intake: identity,
      reviewer: { id: authority.id, attestation: authority.decisionAttestation },
      decision: {
        outcome: "reject_with_reasons",
        reasonCodes: ["evidence_requires_additional_review"],
        note: "The rejection remains visible.",
      },
    });
    assert.equal(rejected.reviews[0].state, "rejected");
    await assert.rejects(
      runtime.service.createPublishReviewDecision(acknowledgement.runtimeId, {
        intake: identity,
        reviewer: { id: authority.id, attestation: authority.decisionAttestation },
        decision: {
          outcome: "approve_for_caption_production",
          reasonCodes: ["reviewer_attested_caption_production_may_proceed"],
          note: null,
        },
      }),
      /already has immutable review decision lineage/,
    );
    assert.equal((await runtime.service.publishReviewDecisions(acknowledgement.runtimeId)).reviews[0].state, "rejected");
  } finally {
    await cleanup(runtime);
  }
});

test("publish-review read fails closed when stored human decision bytes are tampered", async () => {
  const runtime = await hostHarness();
  try {
    const acknowledgement = await runtime.service.start(runtime.request);
    await waitForLifecycle(runtime.service, acknowledgement.commandId, "terminal");
    const intake = (await runtime.service.publishReviewIntakes(acknowledgement.runtimeId)).intakes[0];
    const authority = (await runtime.service.publishReviewDecisions(acknowledgement.runtimeId)).reviewer;
    const reviewed = await runtime.service.createPublishReviewDecision(acknowledgement.runtimeId, {
      intake: {
        intakeId: intake.intakeId,
        artifactId: intake.artifactId,
        receiptId: intake.receiptId,
        receiptContentId: intake.receiptContentId,
      },
      reviewer: { id: authority.id, attestation: authority.decisionAttestation },
      decision: {
        outcome: "approve_for_caption_production",
        reasonCodes: ["reviewer_attested_caption_production_may_proceed"],
        note: null,
      },
    });
    const digest = reviewed.reviews[0].receiptContentId.replace("sha256:", "");
    const objectPath = join(
      runtime.store.paths(acknowledgement.runtimeId).artifactStoreRoot,
      "objects",
      "sha256",
      digest.slice(0, 2),
      digest,
    );
    await writeFile(objectPath, "{}\n", "utf8");
    await assert.rejects(
      runtime.service.publishReviewDecisions(acknowledgement.runtimeId),
      /failed closed validation/,
    );
  } finally {
    await cleanup(runtime);
  }
});

test.skip("assessment audit fails closed after restart for stored-byte, content, receipt-lineage, or journal drift", async () => {
  const runtime = await hostHarness();
  try {
    const ack = await runtime.service.start(runtime.request);
    await waitForLifecycle(runtime.service, ack.commandId, "terminal");
    const paths = runtime.store.paths(ack.runtimeId);
    const journal = await readValidatedRuntimeJournal(paths.journalPath, ack.runtimeId);
    const healthy = await runtime.service.assessmentAudits(ack.runtimeId);
    assert.equal(healthy.audits.length, 1);
    const healthyDecision = await runtime.service.decisionReceipts(ack.runtimeId);
    assert.equal(healthyDecision.decisions.length, 1);
    const healthyIntake = await runtime.service.publishReviewIntakes(ack.runtimeId);
    assert.equal(healthyIntake.intakes.length, 1);
    const receiptContentId = healthy.audits[0].receiptContentId;
    const receiptDigest = receiptContentId.slice("sha256:".length);
    const receiptPath = join(
      paths.artifactStoreRoot,
      "objects",
      "sha256",
      receiptDigest.slice(0, 2),
      receiptDigest,
    );
    const originalReceiptBytes = await readFile(receiptPath);

    await appendFile(receiptPath, "tampered");
    const reopenedAfterTamper = await RuntimeStartService.open({
      store: runtime.store,
      sources: runtime.sources,
      launcherFactory: new DeterministicRuntimeExecutor().factory(),
      recoverOnOpen: true,
    });
    await assert.rejects(
      reopenedAfterTamper.assessmentAudits(ack.runtimeId),
      (error: unknown) => (error as { code?: string }).code === "stored_content_inconsistent",
    );
    await assert.rejects(
      reopenedAfterTamper.decisionReceipts(ack.runtimeId),
      (error: unknown) => (error as { code?: string }).code === "stored_content_inconsistent",
    );
    await assert.rejects(
      reopenedAfterTamper.publishReviewIntakes(ack.runtimeId),
      (error: unknown) => (error as { code?: string }).code === "stored_content_inconsistent",
    );
    await writeFile(receiptPath, originalReceiptBytes);
    assert.equal((await reopenedAfterTamper.assessmentAudits(ack.runtimeId)).audits.length, 1);

    const decisionContentId = healthyDecision.decisions[0].receiptContentId;
    const decisionDigest = decisionContentId.slice("sha256:".length);
    const decisionPath = join(
      paths.artifactStoreRoot,
      "objects",
      "sha256",
      decisionDigest.slice(0, 2),
      decisionDigest,
    );
    const originalDecisionBytes = await readFile(decisionPath);
    await appendFile(decisionPath, "tampered");
    await assert.rejects(
      reopenedAfterTamper.decisionReceipts(ack.runtimeId),
      (error: unknown) => (error as { code?: string }).code === "stored_content_inconsistent",
    );
    await assert.rejects(
      reopenedAfterTamper.publishReviewIntakes(ack.runtimeId),
      (error: unknown) => (error as { code?: string }).code === "stored_content_inconsistent",
    );
    await writeFile(decisionPath, originalDecisionBytes);
    assert.equal((await reopenedAfterTamper.decisionReceipts(ack.runtimeId)).decisions.length, 1);

    const intakeContentId = healthyIntake.intakes[0].receiptContentId;
    const intakeDigest = intakeContentId.slice("sha256:".length);
    const intakePath = join(
      paths.artifactStoreRoot,
      "objects",
      "sha256",
      intakeDigest.slice(0, 2),
      intakeDigest,
    );
    const originalIntakeBytes = await readFile(intakePath);
    await appendFile(intakePath, "tampered");
    await assert.rejects(
      reopenedAfterTamper.publishReviewIntakes(ack.runtimeId),
      (error: unknown) => (error as { code?: string }).code === "stored_content_inconsistent",
    );
    await writeFile(intakePath, originalIntakeBytes);
    assert.equal((await reopenedAfterTamper.publishReviewIntakes(ack.runtimeId)).intakes.length, 1);

    const originalJournal = await readFile(paths.journalPath, "utf8");
    const assessmentArtifactEvent = journal.events.find((event) =>
      event.type === "artifact.recorded" && event.data.artifact.origin.kind === "evidence_assessment");
    const assessmentCompletion = journal.events.find((event) =>
      event.type === "analysis.evidence.assessment_completed");
    const readCompletion = journal.events.find((event) => event.type === "evidence.read_completed");
    assert.ok(assessmentArtifactEvent?.type === "artifact.recorded");
    assert.ok(assessmentCompletion?.type === "analysis.evidence.assessment_completed");
    assert.ok(readCompletion?.type === "evidence.read_completed");

    const expectJournalAuditFailure = async (
      mutate: (events: Array<Record<string, unknown>>) => void,
    ): Promise<void> => {
      const events = structuredClone(journal.events) as unknown as Array<Record<string, unknown>>;
      mutate(events);
      await writeFile(paths.journalPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
      await assert.rejects(
        runtime.service.assessmentAudits(ack.runtimeId),
        (error: unknown) => ["stored_content_inconsistent", "invalid_journal_chain"].includes(
          (error as { code?: string }).code ?? "",
        ),
      );
      await writeFile(paths.journalPath, originalJournal);
      assert.equal((await runtime.service.assessmentAudits(ack.runtimeId)).audits.length, 1);
    };

    await expectJournalAuditFailure((events) => {
      const artifactEvent = events.find((event) => event.type === "artifact.recorded" &&
        (event.data as { artifact?: { origin?: { kind?: string } } }).artifact?.origin?.kind === "evidence_assessment") as {
          data: { artifact: { content: { digest: string; contentId: string; bytes: number }; storageKey: string; origin: { receiptContentId: string } } };
        };
      const completion = events.find((event) => event.type === "analysis.evidence.assessment_completed") as {
        data: { receiptContentId: string };
      };
      const read = readCompletion.data.receiptContentId;
      const digest = read.slice("sha256:".length);
      artifactEvent.data.artifact.content.digest = digest;
      artifactEvent.data.artifact.content.contentId = read;
      artifactEvent.data.artifact.content.bytes = Buffer.byteLength(JSON.stringify(readCompletion.data.receipt));
      artifactEvent.data.artifact.storageKey = `objects/sha256/${digest.slice(0, 2)}/${digest}`;
      artifactEvent.data.artifact.origin.receiptContentId = read;
      completion.data.receiptContentId = read;
    });

    await expectJournalAuditFailure((events) => {
      const artifactEvent = events.find((event) => event.type === "artifact.recorded" &&
        (event.data as { artifact?: { origin?: { kind?: string } } }).artifact?.origin?.kind === "evidence_assessment") as {
          data: { artifact: { origin: { readReceiptIds: string[] } } };
        };
      artifactEvent.data.artifact.origin.readReceiptIds[0] = "evidence-read:out-of-lineage";
    });

    await expectJournalAuditFailure((events) => {
      const completion = events.find((event) => event.type === "analysis.evidence.assessment_completed") as {
        data: { receipt: { claims: Array<{ range: { startMs: number } }> } };
      };
      completion.data.receipt.claims[0].range.startMs += 1;
    });
  } finally {
    await cleanup(runtime);
  }
});
